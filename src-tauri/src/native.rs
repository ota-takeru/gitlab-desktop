use crate::dto::{Action, AppError, Query, Session, User};
use crate::gitlab_api;
use crate::local_git;
use crate::storage::{now_ms, storage_error, CacheRule, LocalDraft, Snapshot, Store};
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedConnection {
    instance_url: String,
    user: User,
    server_version: Option<String>,
    credential_key: String,
    #[serde(default)]
    bearer: bool,
}

pub struct LiveSession {
    pub public: Session,
    account: String,
    client: reqwest::Client,
    api_base: Url,
    cancelled: CancellationToken,
    requests: Mutex<HashMap<String, CancellationToken>>,
    query_locks: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    slots: Arc<Semaphore>,
    /// Gravatar fetches use their own slots so an unreachable external host
    /// (common on internal networks) cannot delay GitLab queries and writes.
    external_avatar_slots: Arc<Semaphore>,
    pending: Arc<Semaphore>,
    mutation_lock: AsyncMutex<()>,
    revision: AtomicU64,
    retry_at: AtomicU64,
    /// Avatar images already fetched for this session, as data URLs. `None`
    /// records an avatar URL that did not yield a small image.
    avatars: Mutex<HashMap<String, Option<String>>>,
    /// Session-local cache for bounded, authenticated Markdown uploads.
    images: Mutex<HashMap<String, Option<String>>>,
}

const AVATAR_CACHE_LIMIT: usize = 512;
const AVATAR_MAX_BYTES: usize = 256 * 1024;
const MARKDOWN_IMAGE_MAX_BYTES: usize = 3 * 1024 * 1024;
const MARKDOWN_IMAGE_CACHE_LIMIT: usize = 12;

struct Inner {
    active: Option<Arc<LiveSession>>,
    store: Store,
}

pub struct NativeState {
    inner: Arc<Mutex<Inner>>,
    lifecycle: AsyncMutex<()>,
    directory: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOperation {
    pub id: String,
    pub action: Action,
    pub started_at: u64,
}

fn operation_resource(project: &str, iid: &str) -> Result<String, AppError> {
    if [project, iid].iter().any(|value| {
        value.is_empty()
            || value.len() > 20
            || !value.bytes().all(|byte| byte.is_ascii_digit())
            || value.bytes().all(|byte| byte == b'0')
    }) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "有効なプロジェクトIDとMR番号を指定してください。",
        )
        .key("native.input.mergeRequest"));
    }
    Ok(format!(
        "{}:{}",
        project.trim_start_matches('0'),
        iid.trim_start_matches('0')
    ))
}

fn validate_receipt_id(receipt_id: &str) -> Result<(), AppError> {
    let parsed = uuid::Uuid::parse_str(receipt_id).map_err(|_| {
        AppError::new("INVALID_INPUT", "送信記録の識別子が正しくありません。")
            .key("native.input.receiptId")
    })?;
    if receipt_id.len() != 36 || parsed.hyphenated().to_string() != receipt_id {
        return Err(
            AppError::new("INVALID_INPUT", "送信記録の識別子が正しくありません。")
                .key("native.input.receiptId"),
        );
    }
    Ok(())
}

fn cancelled() -> AppError {
    AppError::new(
        "CANCELLED",
        "接続またはデータが変わりました。再読み込みしてください。",
    )
    .key("native.connection.changed")
}
fn auth_required() -> AppError {
    AppError::new(
        "AUTH_REQUIRED",
        "GitLabに接続されていません。再接続してください。",
    )
    .key("native.connection.notConnected")
}
/// A token rejected while the user is entering one on the connection form.
fn invalid_token(from_glab: bool) -> AppError {
    if from_glab {
        AppError::new(
            "AUTH_REQUIRED",
            "glabのアクセストークンが無効か期限切れです。glab側で認証を更新するか、トークンを直接入力してください。",
        )
        .key("native.connection.glabTokenInvalid")
    } else {
        AppError::new(
            "AUTH_REQUIRED",
            "アクセストークンが無効か期限切れです。新しいトークンを入力してください。",
        )
        .key("native.connection.tokenInvalid")
    }
}

pub fn normalize_instance(input: &str) -> Result<Url, AppError> {
    let invalid = || {
        AppError::new(
            "INVALID_INPUT",
            "HTTPSのGitLab URLを指定してください。資格情報・クエリ・フラグメントは指定できません。",
        )
        .key("native.connection.httpsUrl")
    };
    if input.len() > 2048 {
        return Err(invalid());
    }
    let mut url = Url::parse(input.trim()).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    // Reject encoded separators/dot segments to keep the registered base path unambiguous.
    let lower = url.path().to_ascii_lowercase();
    if lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("%2e")
        || lower.contains("//")
    {
        return Err(invalid());
    }
    let path = format!("{}/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url)
}

fn account_key(instance: &str, user: &str) -> String {
    // Lowercase hex, as before: the key names each account's saved cache and drafts.
    Sha256::digest(format!("{instance}\n{user}"))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn credential_entry(key: &str) -> Result<keyring::Entry, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::new(
            "UNSUPPORTED",
            "このビルドの資格情報保存はWindowsのみ対応しています。",
        )
        .key("native.connection.credentialsWindowsOnly"));
    }
    keyring::Entry::new("GitLabDesktop", key).map_err(|_| storage_error())
}

fn credential_password(key: &str) -> Result<Option<String>, AppError> {
    match credential_entry(key)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(storage_error()),
    }
}

fn restore_credential(key: &str, password: Option<&str>) -> Result<(), AppError> {
    let entry = credential_entry(key)?;
    match password {
        Some(password) => entry.set_password(password).map_err(|_| storage_error()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(storage_error()),
        },
    }
}

fn delete_credential(key: &str) -> Result<(), AppError> {
    match credential_entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(storage_error()),
    }
}

fn credential_headers(token: &str, bearer: bool) -> Result<HeaderMap, AppError> {
    if token.is_empty() || token.len() > 4096 {
        return Err(AppError::new(
            "INVALID_INPUT",
            "有効なアクセストークンを入力してください。",
        )
        .key("native.connection.tokenRequired"));
    }
    let mut headers = HeaderMap::new();
    let header = if bearer {
        format!("Bearer {token}")
    } else {
        token.into()
    };
    let mut value = HeaderValue::from_str(&header).map_err(|_| {
        AppError::new("INVALID_INPUT", "トークンの形式が正しくありません。")
            .key("native.connection.tokenFormat")
    })?;
    value.set_sensitive(true);
    headers.insert(
        if bearer {
            "Authorization"
        } else {
            "PRIVATE-TOKEN"
        },
        value,
    );
    Ok(headers)
}

fn http_client(token: &str, bearer: bool) -> Result<reqwest::Client, AppError> {
    let headers = credential_headers(token, bearer)?;
    reqwest::Client::builder()
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("gitlab-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| {
            AppError::new("NETWORK", "HTTPSクライアントを初期化できませんでした。")
                .key("native.connection.clientFailed")
        })
}

async fn small_json(client: &reqwest::Client, url: Url) -> Result<serde_json::Value, AppError> {
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_timeout() { AppError::new("TIMEOUT", "接続がタイムアウトしました。").key("native.connection.timeout") }
        else { AppError::new("NETWORK", "GitLabに接続できません。ネットワーク・プロキシ・信頼済み証明書を確認してください。").key("native.connection.cannotConnect") }
    })?;
    match response.status().as_u16() {
        200 => (),
        401 | 429 => {
            return Err(gitlab_api::status_error(
                response.status(),
                response.headers(),
                false,
            ))
        }
        403 => {
            return Err(AppError::new(
                "FORBIDDEN",
                "このトークンではGitLab APIを利用できません。api スコープ（閲覧のみなら read_api）のトークンを使用してください。",
            ).key("native.connection.tokenScope"))
        }
        404 => {
            return Err(AppError::new(
                "NOT_FOUND",
                "GitLab APIが見つかりません。URLのベースパスを確認してください。",
            ).key("native.connection.apiNotFound"))
        }
        300..=399 => return Err(AppError::new(
            "UNSUPPORTED",
            "認証ページへの転送を検出しました。GitLab APIのURLとトークン方式を確認してください。",
        ).key("native.connection.authRedirect")),
        _ => return Err(AppError::new("NETWORK", "GitLabが接続確認に失敗しました。").key("native.connection.checkFailed")),
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        AppError::new("NETWORK", "接続確認の応答を受信できませんでした。")
            .key("native.connection.checkUnreadable")
    })? {
        if body.len() + chunk.len() > 64 * 1024 {
            return Err(AppError::new("TOO_LARGE", "接続確認の応答が大きすぎます。")
                .key("native.connection.checkTooLarge"));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLab APIのJSON応答ではありません。URLや組織の認証方式を確認してください。",
        )
        .key("native.connection.notJson")
    })
}

async fn identify(client: &reqwest::Client, api: &Url) -> Result<User, AppError> {
    let body = small_json(client, api.join("user").map_err(|_| cancelled())?).await?;
    let id = body["id"].as_u64().filter(|id| *id > 0).ok_or_else(|| {
        AppError::new("UNSUPPORTED", "本人情報の形式が対応していません。")
            .key("native.connection.unsupportedUser")
    })?;
    let username = body["username"].as_str().ok_or_else(|| {
        AppError::new("UNSUPPORTED", "本人情報の形式が対応していません。")
            .key("native.connection.unsupportedUser")
    })?;
    Ok(User {
        id: id.to_string(),
        username: username.into(),
        name: body["name"].as_str().unwrap_or(username).into(),
        avatar_url: body["avatar_url"]
            .as_str()
            .filter(|avatar| !avatar.is_empty() && avatar.len() <= 2048)
            .map(Into::into),
    })
}

fn make_session(
    saved: SavedConnection,
    client: reqwest::Client,
) -> Result<Arc<LiveSession>, AppError> {
    let instance = normalize_instance(&saved.instance_url)?;
    Ok(Arc::new(LiveSession {
        public: Session {
            id: uuid::Uuid::new_v4().to_string(),
            instance_url: instance.to_string(),
            user: saved.user,
            server_version: saved.server_version,
        },
        account: saved.credential_key,
        client,
        api_base: instance.join("api/v4/").map_err(|_| cancelled())?,
        cancelled: CancellationToken::new(),
        requests: Mutex::new(HashMap::new()),
        query_locks: Mutex::new(HashMap::new()),
        slots: Arc::new(Semaphore::new(4)),
        external_avatar_slots: Arc::new(Semaphore::new(2)),
        pending: Arc::new(Semaphore::new(16)),
        mutation_lock: AsyncMutex::new(()),
        revision: AtomicU64::new(0),
        retry_at: AtomicU64::new(0),
        avatars: Mutex::new(HashMap::new()),
        images: Mutex::new(HashMap::new()),
    }))
}

impl NativeState {
    pub fn open(directory: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(directory).map_err(|_| storage_error())?;
        Ok(Self {
            inner: Arc::new(Mutex::new(Inner {
                active: None,
                store: Store::open(&directory.join("workspace.sqlite3"))?,
            })),
            lifecycle: AsyncMutex::new(()),
            directory: directory.to_path_buf(),
        })
    }

    async fn blocking<T: Send + 'static>(
        &self,
        job: impl FnOnce(&mut Inner) -> Result<T, AppError> + Send + 'static,
    ) -> Result<T, AppError> {
        let inner = self.inner.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut inner = inner.lock().map_err(|_| storage_error())?;
            job(&mut inner)
        })
        .await
        .map_err(|_| storage_error())?
    }

    fn active(&self, id: &str) -> Result<Arc<LiveSession>, AppError> {
        self.inner
            .lock()
            .map_err(|_| storage_error())?
            .active
            .as_ref()
            .filter(|session| session.public.id == id && !session.cancelled.is_cancelled())
            .cloned()
            .ok_or_else(auth_required)
    }

    pub async fn connect(&self, input: ConnectInput) -> Result<Session, AppError> {
        let _lifecycle = self.lifecycle.lock().await;
        self.connect_locked(input, false, None).await
    }

    /// Replaces the stored token of the saved connection without clearing its
    /// cache, local drafts or write receipts. The token must authenticate the
    /// same user on the same instance, so a token for another account cannot
    /// replace (and thereby erase) this account's private data.
    pub async fn reauthenticate(&self, token: String) -> Result<Session, AppError> {
        let _lifecycle = self.lifecycle.lock().await;
        let saved: Option<SavedConnection> = self
            .blocking(|inner| inner.store.setting("connection"))
            .await?;
        let saved = saved.ok_or_else(auth_required)?;
        let input = ConnectInput {
            url: saved.instance_url,
            token,
        };
        self.connect_locked(input, false, Some(saved.user)).await
    }

    pub async fn connect_from_glab(&self, url: String) -> Result<Session, AppError> {
        let _lifecycle = self.lifecycle.lock().await;
        let instance = normalize_instance(&url)?;
        let token = crate::glab::read_token(&instance, &self.directory).await?;
        // Bearer accepts both PAT and OAuth access tokens. No token enters IPC.
        self.connect_locked(ConnectInput { url, token }, true, None)
            .await
    }

    async fn connect_locked(
        &self,
        input: ConnectInput,
        bearer: bool,
        expected_user: Option<User>,
    ) -> Result<Session, AppError> {
        let previous = self
            .inner
            .lock()
            .map_err(|_| storage_error())?
            .active
            .clone();
        let _write = previous
            .as_ref()
            .map(|session| session.mutation_lock.try_lock().map_err(|_| write_busy()))
            .transpose()?;
        let instance = normalize_instance(&input.url)?;
        let client = http_client(&input.token, bearer)?;
        let api = instance.join("api/v4/").map_err(|_| cancelled())?;
        let user = identify(&client, &api).await.map_err(|error| {
            if error.code == "AUTH_REQUIRED" {
                invalid_token(bearer)
            } else {
                error
            }
        })?;
        if let Some(expected) = expected_user.filter(|expected| expected.id != user.id) {
            return Err(AppError::new(
                "INVALID_INPUT",
                &format!(
                    "このトークンは接続中のアカウント（@{}）のものではありません。同じアカウントのトークンを入力してください。",
                    expected.username
                ),
            )
            .key("native.connection.otherAccount")
            .value("username", &expected.username));
        }
        let version = small_json(&client, api.join("version").map_err(|_| cancelled())?)
            .await
            .ok()
            .and_then(|v| v["version"].as_str().map(str::to_owned));
        let saved = SavedConnection {
            credential_key: account_key(instance.as_str(), &user.id),
            instance_url: instance.to_string(),
            user,
            server_version: version,
            bearer,
        };
        let session = make_session(saved.clone(), client)?;
        let public = session.public.clone();
        self.blocking(move |inner| {
            let previous: Option<SavedConnection> = inner.store.setting("connection")?;
            let replacing = previous
                .as_ref()
                .filter(|previous| previous.credential_key != saved.credential_key);
            // Snapshot both entries before any destructive step. If installing
            // the new connection fails, the previously saved connection stays
            // truthful and restorable even though its private cache was cleared.
            let new_credential = credential_password(&saved.credential_key)?;
            let previous_credential = replacing
                .map(|previous| credential_password(&previous.credential_key))
                .transpose()?;

            if let Some(previous) = replacing {
                inner
                    .store
                    .clear_private_account(&previous.credential_key)?;
                if let Err(error) = delete_credential(&previous.credential_key) {
                    let rollback = previous_credential.as_ref().map_or(Ok(()), |password| {
                        restore_credential(&previous.credential_key, password.as_deref())
                    });
                    if rollback.is_err() {
                        return Err(AppError::new(
                            "STORAGE",
                            "以前のWindows資格情報を削除できず、復元にも失敗しました。資格情報マネージャーを確認してください。",
                        ).key("native.connection.oldCredentialRestoreFailed"));
                    }
                    return Err(error);
                }
            }

            if credential_entry(&saved.credential_key)?
                .set_password(&input.token)
                .is_err()
            {
                let new_rollback = restore_credential(
                    &saved.credential_key,
                    new_credential.as_deref(),
                );
                let previous_rollback = replacing
                    .zip(previous_credential.as_ref())
                    .map(|(previous, previous_credential)| {
                        restore_credential(
                            &previous.credential_key,
                            previous_credential.as_deref(),
                        )
                    })
                    .transpose();
                if new_rollback.is_err() || previous_rollback.is_err() {
                    return Err(AppError::new(
                        "STORAGE",
                        "接続を保存できず、Windows資格情報の復元にも失敗しました。資格情報マネージャーを確認してください。",
                    ).key("native.connection.saveRestoreFailed"));
                }
                return Err(AppError::new(
                    "STORAGE",
                    "Windows資格情報ストアへ保存できません。接続は保存されませんでした。",
                ).key("native.connection.credentialSaveFailed"));
            }
            if let Err(error) = inner.store.set_setting("connection", &saved) {
                let new_rollback =
                    restore_credential(&saved.credential_key, new_credential.as_deref());
                let previous_rollback = replacing
                    .zip(previous_credential.as_ref())
                    .map(|(previous, previous_credential)| {
                        restore_credential(
                            &previous.credential_key,
                            previous_credential.as_deref(),
                        )
                    })
                    .transpose();
                if new_rollback.is_err() || previous_rollback.is_err() {
                    return Err(AppError::new(
                        "STORAGE",
                        "接続設定を保存できず、Windows資格情報の復元にも失敗しました。資格情報マネージャーを確認してください。",
                    ).key("native.connection.settingsRestoreFailed"));
                }
                return Err(error);
            }
            if let Some(old) = inner.active.take() {
                old.cancelled.cancel();
            }
            inner.active = Some(session);
            Ok(())
        })
        .await?;
        Ok(public)
    }

    pub async fn restore(&self) -> Result<Option<Session>, AppError> {
        let _lifecycle = self.lifecycle.lock().await;
        if let Some(public) = self
            .blocking(|inner| Ok(inner.active.as_ref().map(|s| s.public.clone())))
            .await?
        {
            return Ok(Some(public));
        }
        let saved: Option<SavedConnection> = self
            .blocking(|inner| inner.store.setting("connection"))
            .await?;
        let Some(saved) = saved else {
            return Ok(None);
        };
        let key = saved.credential_key.clone();
        let token = tauri::async_runtime::spawn_blocking(move || {
            credential_entry(&key)?
                .get_password()
                .map_err(|_| auth_required())
        })
        .await
        .map_err(|_| storage_error())??;
        let client = http_client(&token, saved.bearer)?;
        let instance = normalize_instance(&saved.instance_url)?;
        let api = instance.join("api/v4/").map_err(|_| cancelled())?;
        match identify(&client, &api).await {
            Ok(user) if user.id == saved.user.id => (),
            Ok(_) => return Err(auth_required()),
            Err(error) if error.code == "NETWORK" || error.code == "TIMEOUT" => (), // cache-only navigation remains possible
            Err(error) => {
                let account = saved.credential_key.clone();
                self.blocking(move |inner| {
                    inner.store.clear_account(&account)?;
                    Ok(())
                })
                .await?;
                return Err(error);
            }
        }
        let session = make_session(saved, client)?;
        let public = session.public.clone();
        self.blocking(move |inner| {
            inner.active = Some(session);
            Ok(())
        })
        .await?;
        Ok(Some(public))
    }

    pub async fn disconnect(&self, id: String) -> Result<(), AppError> {
        let _lifecycle = self.lifecycle.lock().await;
        let session = self.active(&id)?;
        let _write = session.mutation_lock.try_lock().map_err(|_| write_busy())?;
        // Cancellation happens before credential/DB work; late responses cannot persist.
        session.cancelled.cancel();
        let clear_session = session.clone();
        self.blocking(move |inner| {
            inner.active = None;
            inner.store.clear_private_account(&clear_session.account)?;
            inner.store.delete_setting(&local_repositories_key(&clear_session.account))?;
            inner.store.delete_setting(&local_scan_folders_key(&clear_session.account))?;
            inner.store.delete_setting(&local_scan_declined_key(&clear_session.account))?;
            inner.store.delete_setting("connection")?;
            match credential_entry(&clear_session.account)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(AppError::new("STORAGE", "データを削除しましたが、Windows資格情報の削除に失敗しました。資格情報マネージャーでGitLabDesktopを削除してください。").key("native.connection.credentialDeleteFailed")),
            }
        }).await
    }

    pub async fn clear_cache(&self, id: String) -> Result<(), AppError> {
        let session = self.active(&id)?;
        session.revision.fetch_add(1, Ordering::SeqCst);
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            inner.store.clear_account(&session.account)
        })
        .await
    }

    pub async fn local_draft(
        &self,
        id: String,
        key: String,
    ) -> Result<Option<LocalDraft>, AppError> {
        let session = self.active(&id)?;
        let _pending = session.pending.clone().try_acquire_owned().map_err(|_| {
            AppError::new("RATE_LIMITED", "処理待ちが多すぎます。").key("native.queue.busy")
        })?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            inner.store.draft(&session.account, &key)
        })
        .await
    }

    pub async fn save_local_draft(
        &self,
        id: String,
        key: String,
        body: String,
    ) -> Result<(), AppError> {
        let session = self.active(&id)?;
        let _pending = session.pending.clone().try_acquire_owned().map_err(|_| {
            AppError::new("RATE_LIMITED", "処理待ちが多すぎます。").key("native.queue.busy")
        })?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            inner.store.save_draft(&session.account, &key, &body)
        })
        .await
    }

    pub async fn clear_local_drafts(&self, id: String) -> Result<(), AppError> {
        let session = self.active(&id)?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            inner.store.clear_drafts(&session.account)
        })
        .await
    }

    pub async fn pending_operation(
        &self,
        id: String,
        project: String,
        iid: String,
    ) -> Result<Option<PendingOperation>, AppError> {
        let session = self.active(&id)?;
        let resource = operation_resource(&project, &iid)?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            inner
                .store
                .pending_operation(&session.account, &resource)?
                .map(|value| serde_json::from_value(value).map_err(|_| storage_error()))
                .transpose()
        })
        .await
    }

    pub async fn acknowledge_pending_operation(
        &self,
        id: String,
        project: String,
        iid: String,
        receipt_id: String,
    ) -> Result<(), AppError> {
        validate_receipt_id(&receipt_id)?;
        let session = self.active(&id)?;
        let resource = operation_resource(&project, &iid)?;
        let _write = session.mutation_lock.lock().await;
        let target = session.clone();
        self.blocking(move |inner| {
            ensure_active(inner, &target)?;
            let receipt = inner
                .store
                .pending_operation(&target.account, &resource)?
                .ok_or_else(cancelled)?;
            if receipt["id"].as_str() != Some(receipt_id.as_str()) {
                return Err(cancelled());
            }
            inner.store.finish_operation(&target.account, &resource)
        })
        .await
    }

    pub fn cancel_request(&self, session_id: &str, request_id: &str) -> Result<(), AppError> {
        let session = self.active(session_id)?;
        if let Some(token) = session
            .requests
            .lock()
            .map_err(|_| storage_error())?
            .get(request_id)
        {
            token.cancel();
        }
        Ok(())
    }

    async fn record_error(
        &self,
        session: &Arc<LiveSession>,
        error: &AppError,
        key: Option<String>,
    ) -> Result<(), AppError> {
        if error.code == "RATE_LIMITED" {
            session.retry_at.fetch_max(
                now_ms().saturating_add(error.retry_after_ms.unwrap_or(60_000)),
                Ordering::SeqCst,
            );
        }
        if matches!(
            error.code.as_str(),
            "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND"
        ) {
            let session = session.clone();
            let revoke = error.code == "AUTH_REQUIRED";
            let _ = self
                .blocking(move |inner| {
                    ensure_active(inner, &session)?;
                    // A permission denial must never fall back to a previous private snapshot.
                    let deletion = inner.store.clear_account(&session.account);
                    if revoke || deletion.is_err() {
                        session.cancelled.cancel();
                        inner.active = None;
                    }
                    let _ = key;
                    deletion
                })
                .await;
        }
        Ok(())
    }

    pub async fn query(&self, input: QueryInput) -> Result<Option<Snapshot>, AppError> {
        let session = self.active(&input.session_id)?;
        let key = serde_json::to_string(&input.query).map_err(|_| cancelled())?;
        if key.len() > 8192 {
            return Err(AppError::new("INVALID_INPUT", "検索条件が長すぎます。")
                .key("native.query.searchTooLong"));
        }
        if input.mode == ReadMode::CacheOnly {
            return self
                .blocking(move |inner| {
                    ensure_active(inner, &session)?;
                    inner.store.get(&session.account, &key)
                })
                .await;
        }
        let _pending = session.pending.clone().try_acquire_owned().map_err(|_| {
            AppError::new(
                "RATE_LIMITED",
                "処理待ちが多すぎます。少し待って再試行してください。",
            )
            .key("native.queue.busyRetry")
        })?;
        let queued_at = now_ms();
        let registration = RequestRegistration::new(session.clone(), input.request_id)?;
        let query_lock = {
            let mut locks = session.query_locks.lock().map_err(|_| storage_error())?;
            locks.retain(|_, lock| lock.strong_count() > 0);
            let lock = locks
                .get(&key)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(AsyncMutex::new(())));
            locks.insert(key.clone(), Arc::downgrade(&lock));
            lock
        };
        let work = async {
            let _deduplicate = query_lock.lock().await;
            let dedup_session = session.clone();
            let dedup_key = key.clone();
            if let Some(mut snapshot) = self
                .blocking(move |inner| {
                    ensure_active(inner, &dedup_session)?;
                    Ok(inner
                        .store
                        .get(&dedup_session.account, &dedup_key)?
                        .filter(|snapshot| snapshot.fetched_at >= queued_at))
                })
                .await?
            {
                snapshot.source = "network".into();
                return Ok(Some(snapshot));
            }
            let _slot = session
                .slots
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| cancelled())?;
            check_cooldown(&session)?;
            let revision = session.revision.load(Ordering::SeqCst);
            let result = gitlab_api::fetch(&session.client, &session.api_base, &input.query).await;
            let mut result = match result {
                Ok(value) => value,
                Err(error) => {
                    // GitLab answers 404 for a job that has no log yet; that is
                    // not a lost permission, and job logs are never cached.
                    // An empty repository or a deleted branch or folder is 404
                    // too. The screen still hides a 404 answer's saved copy.
                    let expected_missing = error.code == "NOT_FOUND"
                        && matches!(input.query, Query::JobTrace { .. } | Query::Tree { .. });
                    if !expected_missing {
                        self.record_error(&session, &error, Some(key.clone()))
                            .await?;
                    }
                    return Err(error);
                }
            };
            if let Query::Approvals { .. } = input.query {
                let approved = result.data["approvedBy"].as_array().is_some_and(|users| {
                    users
                        .iter()
                        .any(|user| user["id"].as_str() == Some(&session.public.user.id))
                });
                result.data["approved"] = approved.into();
            }
            let snapshot = Snapshot {
                data: result.data,
                fetched_at: now_ms(),
                source: "network".into(),
                next_page: result.next_page,
                total_pages: result.total_pages,
                completeness: if result.truncated {
                    "truncated"
                } else if result.next_page.is_some() {
                    "page"
                } else {
                    "complete"
                }
                .into(),
            };
            // Job logs can hold secrets printed by CI scripts, so they stay in memory only.
            let persist = !matches!(input.query, Query::JobTrace { .. });
            let copy = snapshot.clone();
            let session = session.clone();
            self.blocking(move |inner| {
                ensure_active(inner, &session)?;
                if session.revision.load(Ordering::SeqCst) != revision {
                    return Err(cancelled());
                }
                if !persist {
                    return Ok(());
                }
                inner.store.put(&session.account, &key, &copy)
            })
            .await?;
            Ok(Some(snapshot))
        };
        tokio::select! { result = work => result, _ = session.cancelled.cancelled()=>Err(cancelled()), _ = registration.token.cancelled()=>Err(cancelled()) }
    }

    pub async fn mutate(&self, input: MutationInput) -> Result<(), AppError> {
        self.execute_mutation(input, None).await.map(|_| ())
    }

    pub async fn upload_attachment(&self, input: UploadInput) -> Result<String, AppError> {
        self.active(&input.session_id)?;
        gitlab_api::validate_id(&input.project_id, "projectId")?;
        gitlab_api::validate_id(&input.iid, "iid")?;
        let bytes = crate::attachments::decode_upload(&input.file_name, &input.data_base64)?;
        self.execute_mutation(
            MutationInput {
                session_id: input.session_id,
                request_id: input.request_id,
                local_draft_key: None,
                action: Action::UploadAttachment {
                    project_id: input.project_id,
                    iid: input.iid,
                    file_name: input.file_name,
                },
            },
            Some(bytes),
        )
        .await?
        .ok_or_else(unknown_write)
    }

    async fn execute_mutation(
        &self,
        input: MutationInput,
        upload: Option<Vec<u8>>,
    ) -> Result<Option<String>, AppError> {
        let session = self.active(&input.session_id)?;
        if matches!(input.action, Action::UploadAttachment { .. }) != upload.is_some() {
            return Err(AppError::new("INVALID_INPUT", "添付データが必要です。")
                .key("native.attachment.required"));
        }
        // An upload adds no MR, discussion or diff data, so it keeps the cache
        // and in-flight queries; the receipt still guards against a resend.
        let changes_cached_data = upload.is_none();
        let submitted_draft = match (&input.local_draft_key, &input.action) {
            (
                Some(key),
                Action::Comment { body, .. }
                | Action::Reply { body, .. }
                | Action::SaveDraft { body, .. },
            ) => Some((key.clone(), body.clone())),
            (Some(_), _) => {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "この操作に未送信コメントを関連付けることはできません。",
                )
                .key("native.draft.notAllowed"))
            }
            (None, _) => None,
        };
        let action_value = serde_json::to_value(&input.action).map_err(|_| storage_error())?;
        let changed_queries = queries_changed_by(
            &input.action,
            action_value["projectId"].as_str().unwrap_or_default(),
            action_value["iid"].as_str().unwrap_or_default(),
        );
        let resource = operation_resource(
            action_value["projectId"].as_str().unwrap_or_default(),
            action_value["iid"].as_str().unwrap_or_default(),
        )?;
        let _pending = session.pending.clone().try_acquire_owned().map_err(|_| {
            AppError::new("RATE_LIMITED", "処理待ちが多すぎます。").key("native.queue.busy")
        })?;
        let registration = RequestRegistration::new(session.clone(), input.request_id)?;
        let work = async {
            // Before a receipt exists, cancelling a queued operation is known
            // not to have sent anything. Once committed, only the HTTP phase
            // is cancellable; finalization must not race receipt deletion.
            let _write = tokio::select! {
                guard = session.mutation_lock.lock() => guard,
                _ = session.cancelled.cancelled() => return Err(cancelled()),
                _ = registration.token.cancelled() => return Err(cancelled()),
            };
            let _slot = tokio::select! {
                slot = session.slots.clone().acquire_owned() => slot.map_err(|_| cancelled())?,
                _ = session.cancelled.cancelled() => return Err(cancelled()),
                _ = registration.token.cancelled() => return Err(cancelled()),
            };
            check_cooldown(&session)?;
            let receipt_id = uuid::Uuid::new_v4().to_string();
            let record = serde_json::json!({"id": receipt_id, "action": action_value, "startedAt": now_ms()});
            let marker_session = session.clone();
            let marker_resource = resource.clone();
            let marker_draft = submitted_draft.clone();
            // Commit before any possible write. A crash or cancellation leaves
            // a receipt, so a restarted application cannot silently re-submit.
            self.blocking(move |inner| {
                ensure_active(inner, &marker_session)?;
                if let Some((key, submitted_body)) = marker_draft.as_ref() {
                    let draft = inner
                        .store
                        .draft(&marker_session.account, key)?
                        .ok_or_else(|| {
                            AppError::new(
                                "INVALID_INPUT",
                                "送信前の未送信コメントを確認できませんでした。",
                            )
                            .key("native.draft.checkFailed")
                        })?;
                    if draft.body.trim() != submitted_body {
                        return Err(AppError::new(
                            "INVALID_INPUT",
                            "未送信コメントが変更されています。保存後に再試行してください。",
                        )
                        .key("native.draft.changed"));
                    }
                }
                inner
                    .store
                    .begin_operation(&marker_session.account, &marker_resource, &record)
            })
            .await?;
            if changes_cached_data {
                session.revision.fetch_add(1, Ordering::SeqCst);
            }
            let send = async {
                if let (
                    Action::UploadAttachment {
                        project_id,
                        file_name,
                        ..
                    },
                    Some(data),
                ) = (&input.action, upload)
                {
                    crate::attachments::upload(
                        &session.client,
                        &session.api_base,
                        project_id,
                        file_name,
                        data,
                    )
                    .await
                    .map(Some)
                } else {
                    gitlab_api::mutate(
                        &session.client,
                        &session.api_base,
                        &input.action,
                        &session.public.user.id,
                    )
                    .await
                    .map(|_| None)
                }
            };
            let result = tokio::select! {
                result = send => result,
                _ = session.cancelled.cancelled() => Err(unknown_write()),
                _ = registration.token.cancelled() => Err(unknown_write()),
            };
            if changes_cached_data {
                session.revision.fetch_add(1, Ordering::SeqCst);
            }
            if let Err(error) = &result {
                self.record_error(&session, error, None).await?;
            }
            if changes_cached_data
                && (result.is_ok()
                    || result
                        .as_ref()
                        .is_err_and(|error| error.code == "UNKNOWN_OUTCOME"))
            {
                let cache_session = session.clone();
                // A write known to change only some answers keeps the rest of the
                // saved data; anything else, or an unknown outcome, clears it all.
                let changed_queries = changed_queries.filter(|_| result.is_ok());
                if self
                    .blocking(move |inner| {
                        ensure_active(inner, &cache_session)?;
                        match &changed_queries {
                            Some(rules) => inner
                                .store
                                .clear_account_queries(&cache_session.account, rules),
                            None => inner.store.clear_account(&cache_session.account),
                        }
                    })
                    .await
                    .is_err()
                {
                    session.cancelled.cancel();
                    return Err(AppError::new("UNKNOWN_OUTCOME", "送信後の保存データを更新できませんでした。再送せずGitLabで結果を確認してください。").key("native.receipt.saveAfterSendFailed"));
                }
            }
            if !result
                .as_ref()
                .is_err_and(|error| error.code == "UNKNOWN_OUTCOME")
            {
                let marker_session = session.clone();
                let marker_resource = resource.clone();
                let completed_draft = if result.is_ok() {
                    submitted_draft
                } else {
                    None
                };
                if self
                    .blocking(move |inner| {
                        inner.store.complete_operation(
                            &marker_session.account,
                            &marker_resource,
                            &receipt_id,
                            completed_draft
                                .as_ref()
                                .map(|(key, body)| (key.as_str(), body.as_str())),
                        )
                    })
                    .await
                    .is_err()
                {
                    return Err(AppError::new("UNKNOWN_OUTCOME", "操作の確認記録を更新できませんでした。再送せずGitLabで結果を確認してください。").key("native.receipt.updateFailed"));
                }
            }
            result
        };
        let outcome = work.await;
        if changes_cached_data
            && outcome
                .as_ref()
                .is_err_and(|error| error.code == "UNKNOWN_OUTCOME")
        {
            session.revision.fetch_add(1, Ordering::SeqCst);
            let cache_session = session.clone();
            if self
                .blocking(move |inner| {
                    if ensure_active(inner, &cache_session).is_ok() {
                        inner.store.clear_account(&cache_session.account)?;
                    }
                    Ok(())
                })
                .await
                .is_err()
            {
                session.cancelled.cancel();
            }
        }
        outcome
    }

    /// Returns an avatar as a `data:` URL so the webview keeps its strict
    /// `img-src`. Images uploaded to the connected instance are fetched with
    /// the session's credentials and Gravatar images, which GitLab shows for
    /// users without an upload, without any; other hosts and failures yield
    /// `None` and the UI falls back to initials.
    pub async fn avatar(&self, id: String, input: String) -> Result<Option<String>, AppError> {
        let session = self.active(&id)?;
        let (url, client, slots) =
            if let Some(url) = instance_avatar_url(&session.public.instance_url, &input) {
                (url, session.client.clone(), session.slots.clone())
            } else if let Some(url) = gravatar_url(&input) {
                (
                    url,
                    anonymous_client()?,
                    session.external_avatar_slots.clone(),
                )
            } else {
                return Ok(None);
            };
        let key = url.to_string();
        if let Some(hit) = session
            .avatars
            .lock()
            .map_err(|_| storage_error())?
            .get(&key)
        {
            return Ok(hit.clone());
        }
        if check_cooldown(&session).is_err() {
            return Ok(None);
        }
        let fetched = tokio::select! {
            fetched = async {
                let _slot = slots.acquire_owned().await.ok()?;
                fetch_avatar(&client, url).await
            } => fetched,
            _ = session.cancelled.cancelled() => return Err(cancelled()),
        };
        // Network failures are not cached so a later view can retry.
        if let Some(result) = &fetched {
            let mut avatars = session.avatars.lock().map_err(|_| storage_error())?;
            if avatars.len() >= AVATAR_CACHE_LIMIT {
                avatars.clear();
            }
            avatars.insert(key, result.clone());
        }
        Ok(fetched.flatten())
    }

    /// Only uploads served by the connected GitLab origin may be embedded.
    pub async fn markdown_image(
        &self,
        id: String,
        input: String,
    ) -> Result<Option<String>, AppError> {
        let session = self.active(&id)?;
        let Some(url) = instance_markdown_image_url(&session.public.instance_url, &input) else {
            return Ok(None);
        };
        let key = url.to_string();
        if let Some(hit) = session
            .images
            .lock()
            .map_err(|_| storage_error())?
            .get(&key)
        {
            return Ok(hit.clone());
        }
        if check_cooldown(&session).is_err() {
            return Ok(None);
        }
        let api_url = project_upload_api_url(&session.public.instance_url, &url);
        let fetched = tokio::select! {
            fetched = async {
                let _slot = session.slots.clone().acquire_owned().await.ok()?;
                // The web route of a project upload signs in through the browser and
                // ignores the token; GitLab 17.4+ serves the same file through the API.
                if let Some(api_url) = api_url {
                    if let Some(Some(image)) = fetch_image_data(&session.client, api_url, MARKDOWN_IMAGE_MAX_BYTES).await {
                        return Some(Some(image));
                    }
                }
                fetch_image_data(&session.client, url, MARKDOWN_IMAGE_MAX_BYTES).await
            } => fetched,
            _ = session.cancelled.cancelled() => return Err(cancelled()),
        };
        if let Some(image) = &fetched {
            let mut images = session.images.lock().map_err(|_| storage_error())?;
            if images.len() >= MARKDOWN_IMAGE_CACHE_LIMIT {
                images.clear();
            }
            images.insert(key, image.clone());
        }
        Ok(fetched.flatten())
    }

    pub fn open_url(&self, id: &str, input: &str) -> Result<(), AppError> {
        let session = self.active(id)?;
        let base = normalize_instance(&session.public.instance_url)?;
        let url = Url::parse(input).map_err(|_| {
            AppError::new("INVALID_INPUT", "URLが正しくありません。").key("native.link.invalidUrl")
        })?;
        if url.origin() != base.origin()
            || url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || !url.path().starts_with(base.path())
        {
            return Err(
                AppError::new("INVALID_INPUT", "接続先GitLabのURLだけを開けます。")
                    .key("native.link.otherInstance"),
            );
        }
        open::that_detached(url.as_str()).map_err(|_| {
            AppError::new("NETWORK", "既定のブラウザーで開けませんでした。")
                .key("native.link.browserFailed")
        })
    }

    pub async fn local_repository(
        &self,
        id: String,
        project: String,
    ) -> Result<Option<LocalRepository>, AppError> {
        validate_project_id(&project)?;
        let session = self.active(&id)?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            Ok(local_repositories(&inner.store, &session.account)?.remove(&project))
        })
        .await
    }

    /// Links a folder to a project after checking that it is a clone of that
    /// project on the connected instance. The folder is read, never changed.
    pub async fn link_local_repository(
        &self,
        id: String,
        project: String,
        project_path: String,
        path: String,
    ) -> Result<LocalRepository, AppError> {
        validate_project_id(&project)?;
        let session = self.active(&id)?;
        let root = local_git::repository_root(&path).await?;
        let remotes = local_git::remote_urls(&root).await?;
        // The project's path comes from GitLab, so a stale or wrong path from
        // the screen cannot link a clone of another project.
        let fetched = gitlab_api::fetch(
            &session.client,
            &session.api_base,
            &Query::Project { path: project_path },
        )
        .await?;
        let project_path = fetched.data["pathWithNamespace"]
            .as_str()
            .filter(|_| fetched.data["id"].as_str() == Some(project.as_str()))
            .ok_or_else(|| {
                AppError::new("NOT_FOUND", "プロジェクトをGitLabで確認できませんでした。")
                    .key("native.localGit.projectUnavailable")
            })?
            .to_owned();
        let instance = normalize_instance(&session.public.instance_url)?;
        if !remotes
            .iter()
            .any(|remote| local_git::remote_matches(remote, &instance, &project_path))
        {
            return Err(AppError::new("INVALID_INPUT", &format!("このフォルダのgitリモートは {project_path} を指していません。このプロジェクトをcloneしたフォルダを指定してください（SSHの別名ホストは照合できないため、HTTPSかホスト名どおりのリモートが必要です）。")).key("native.localGit.remoteMismatch").value("projectPath", &project_path));
        }
        let linked = LocalRepository {
            path: root.to_string_lossy().into_owned(),
            project_path,
        };
        let saved = linked.clone();
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            let mut repositories = local_repositories(&inner.store, &session.account)?;
            if !repositories.contains_key(&project) && repositories.len() >= MAX_LOCAL_REPOSITORIES
            {
                return Err(AppError::new(
                    "TOO_LARGE",
                    "紐付けたローカルリポジトリが多すぎます。使わない紐付けを解除してください。",
                )
                .key("native.localGit.tooManyLinks"));
            }
            let mut declined = local_scan_declined(&inner.store, &session.account)?;
            declined.retain(|known| known != &project);
            repositories.insert(project, saved);
            inner
                .store
                .set_setting(&local_repositories_key(&session.account), &repositories)?;
            inner
                .store
                .set_setting(&local_scan_declined_key(&session.account), &declined)
        })
        .await?;
        Ok(linked)
    }

    pub async fn unlink_local_repository(
        &self,
        id: String,
        project: String,
    ) -> Result<(), AppError> {
        validate_project_id(&project)?;
        let session = self.active(&id)?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            let mut repositories = local_repositories(&inner.store, &session.account)?;
            // A clone the user unlinked is not linked again by the folder search.
            let mut declined = local_scan_declined(&inner.store, &session.account)?;
            if repositories.remove(&project).is_some() && !declined.contains(&project) {
                if declined.len() >= MAX_LOCAL_REPOSITORIES {
                    declined.remove(0);
                }
                declined.push(project);
            }
            inner
                .store
                .set_setting(&local_repositories_key(&session.account), &repositories)?;
            inner
                .store
                .set_setting(&local_scan_declined_key(&session.account), &declined)
        })
        .await
    }

    /// The linked clone's working tree against the MR head. It is read fresh
    /// each time and never saved: it is the user's local source, not GitLab data.
    pub async fn local_changes(
        &self,
        id: String,
        project: String,
        head_sha: String,
    ) -> Result<serde_json::Value, AppError> {
        self.read_linked(id, project, head_sha, LocalRead::Changes)
            .await
    }

    /// A summary of the linked clone against the MR head (branch, unpushed
    /// commits, changed and untracked paths), read fresh like the changes.
    pub async fn local_status(
        &self,
        id: String,
        project: String,
        head_sha: String,
    ) -> Result<serde_json::Value, AppError> {
        self.read_linked(id, project, head_sha, LocalRead::Status)
            .await
    }

    async fn read_linked(
        &self,
        id: String,
        project: String,
        head_sha: String,
        read: LocalRead,
    ) -> Result<serde_json::Value, AppError> {
        let linked = self
            .local_repository(id.clone(), project)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    "NOT_FOUND",
                    "このプロジェクトにはローカルリポジトリが紐付けられていません。",
                )
                .key("native.localGit.notLinked")
            })?;
        let session = self.active(&id)?;
        let _pending = session.pending.clone().try_acquire_owned().map_err(|_| {
            AppError::new("RATE_LIMITED", "処理待ちが多すぎます。").key("native.queue.busy")
        })?;
        let root = PathBuf::from(&linked.path);
        // The folder may have been re-pointed since it was linked.
        let instance = normalize_instance(&session.public.instance_url)?;
        let remotes = local_git::remote_urls(&root).await?;
        if !remotes
            .iter()
            .any(|remote| local_git::remote_matches(remote, &instance, &linked.project_path))
        {
            return Err(AppError::new("INVALID_INPUT", &format!("紐付けたフォルダのgitリモートが {} を指していません。紐付けをやり直してください。", linked.project_path)).key("native.localGit.linkedRemoteMismatch").value("projectPath", &linked.project_path));
        }
        let result = async {
            match read {
                LocalRead::Changes => local_git::local_changes(&root, &head_sha).await,
                LocalRead::Status => local_git::local_status(&root, &head_sha).await,
            }
        };
        tokio::select! {
            result = result => result,
            _ = session.cancelled.cancelled() => Err(cancelled()),
        }
    }

    /// The folders searched for clones of projects that are not linked yet.
    pub async fn local_scan_folders(&self, id: String) -> Result<Vec<String>, AppError> {
        let session = self.active(&id)?;
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            local_scan_folders(&inner.store, &session.account)
        })
        .await
    }

    /// Replaces the folders searched for clones. Each must be an existing
    /// folder given by its absolute path.
    pub async fn set_local_scan_folders(
        &self,
        id: String,
        folders: Vec<String>,
    ) -> Result<Vec<String>, AppError> {
        let session = self.active(&id)?;
        let mut saved: Vec<String> = Vec::new();
        for folder in &folders {
            // Explorer's "Copy as path" wraps the path in quotes.
            let trimmed = folder.trim().trim_matches('"').trim();
            let path = Path::new(trimmed);
            if trimmed.is_empty() || trimmed.chars().any(char::is_control) || !path.is_absolute() {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "探すフォルダを絶対パスで指定してください。",
                )
                .key("native.localGit.scanAbsolutePath"));
            }
            if !path.is_dir() {
                return Err(AppError::new(
                    "NOT_FOUND",
                    &format!("フォルダが見つかりません: {trimmed}"),
                )
                .key("native.localGit.scanFolderMissing")
                .value("path", trimmed));
            }
            if !saved
                .iter()
                .any(|known| known.eq_ignore_ascii_case(trimmed))
            {
                saved.push(trimmed.to_owned());
            }
        }
        if saved.len() > MAX_LOCAL_SCAN_FOLDERS {
            return Err(AppError::new(
                "TOO_LARGE",
                &format!("探すフォルダは{MAX_LOCAL_SCAN_FOLDERS}件までです。"),
            )
            .key("native.localGit.tooManyScanFolders")
            .value("count", MAX_LOCAL_SCAN_FOLDERS));
        }
        let stored = saved.clone();
        self.blocking(move |inner| {
            ensure_active(inner, &session)?;
            inner
                .store
                .set_setting(&local_scan_folders_key(&session.account), &stored)
        })
        .await?;
        Ok(saved)
    }

    /// The project's clone: the linked one, or else the first clone of the
    /// project found below the scan folders, which is then linked after the
    /// same checks as a folder the user chose. A project the user unlinked is
    /// searched for only when `explicit`, as when the user asks for the search.
    pub async fn find_local_repository(
        &self,
        id: String,
        project: String,
        project_path: String,
        explicit: bool,
    ) -> Result<LocalRepositorySearch, AppError> {
        if let Some(linked) = self.local_repository(id.clone(), project.clone()).await? {
            return Ok(LocalRepositorySearch {
                repository: Some(linked),
                declined: false,
            });
        }
        validate_project_id(&project)?;
        let session = self.active(&id)?;
        let wanted_project = project.clone();
        let scanned = session.clone();
        let (folders, declined) = self
            .blocking(move |inner| {
                ensure_active(inner, &scanned)?;
                let declined =
                    local_scan_declined(&inner.store, &scanned.account)?.contains(&wanted_project);
                Ok((
                    local_scan_folders(&inner.store, &scanned.account)?,
                    declined,
                ))
            })
            .await?;
        if folders.is_empty() || (declined && !explicit) {
            return Ok(LocalRepositorySearch {
                repository: None,
                declined,
            });
        }
        let instance = normalize_instance(&session.public.instance_url)?;
        let wanted = project_path.clone();
        let found = tauri::async_runtime::spawn_blocking(move || {
            let roots: Vec<PathBuf> = folders.iter().map(PathBuf::from).collect();
            local_git::find_clone(&roots, &instance, &wanted)
        })
        .await
        .map_err(|_| storage_error())?;
        let repository = match found {
            Some(folder) => Some(
                self.link_local_repository(
                    id,
                    project,
                    project_path,
                    folder.to_string_lossy().into_owned(),
                )
                .await?,
            ),
            None => None,
        };
        Ok(LocalRepositorySearch {
            declined: declined && repository.is_none(),
            repository,
        })
    }
}

/// What is read from a linked clone.
enum LocalRead {
    Changes,
    Status,
}

impl NativeState {
    /// One file of the linked clone's working tree, for the whole-file view and
    /// for opening unchanged lines between hunks. Read fresh, never saved.
    pub async fn local_file(
        &self,
        id: String,
        project: String,
        path: String,
    ) -> Result<serde_json::Value, AppError> {
        let linked = self
            .local_repository(id.clone(), project)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    "NOT_FOUND",
                    "このプロジェクトにはローカルリポジトリが紐付けられていません。",
                )
                .key("native.localGit.notLinked")
            })?;
        let session = self.active(&id)?;
        let _pending = session.pending.clone().try_acquire_owned().map_err(|_| {
            AppError::new("RATE_LIMITED", "処理待ちが多すぎます。").key("native.queue.busy")
        })?;
        let file = tauri::async_runtime::spawn_blocking(move || {
            local_git::read_worktree_file(Path::new(&linked.path), &path)
        })
        .await
        .map_err(|_| storage_error())??;
        match file {
            local_git::WorktreeFile::Text(content) => Ok(serde_json::json!({ "content": content })),
            local_git::WorktreeFile::Binary => Err(AppError::new(
                "UNSUPPORTED",
                "このファイルはテキストではないため表示できません。",
            )
            .key("native.localGit.notText")),
            local_git::WorktreeFile::TooLarge => Err(AppError::new(
                "TOO_LARGE",
                "1MiBを超えるファイルは表示できません。",
            )
            .key("native.localGit.fileTooLarge")),
        }
    }
}

const MAX_LOCAL_REPOSITORIES: usize = 500;

/// A project's clone on this computer, as linked by the user.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepository {
    pub path: String,
    pub project_path: String,
}

/// The outcome of looking for a project's clone below the scan folders.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepositorySearch {
    pub repository: Option<LocalRepository>,
    /// The user unlinked the project, so it is not linked automatically.
    pub declined: bool,
}

fn validate_project_id(project: &str) -> Result<(), AppError> {
    if project.is_empty()
        || project.len() > 20
        || !project.bytes().all(|byte| byte.is_ascii_digit())
        || project.bytes().all(|byte| byte == b'0')
    {
        return Err(
            AppError::new("INVALID_INPUT", "有効なプロジェクトIDを指定してください。")
                .key("native.input.projectId"),
        );
    }
    Ok(())
}

const MAX_LOCAL_SCAN_FOLDERS: usize = 10;

fn local_scan_folders_key(account: &str) -> String {
    format!("local_scan_folders:{account}")
}

fn local_scan_folders(store: &Store, account: &str) -> Result<Vec<String>, AppError> {
    Ok(store
        .setting(&local_scan_folders_key(account))?
        .unwrap_or_default())
}

/// Projects whose clone the user unlinked, which the folder search leaves alone.
fn local_scan_declined_key(account: &str) -> String {
    format!("local_scan_declined:{account}")
}

fn local_scan_declined(store: &Store, account: &str) -> Result<Vec<String>, AppError> {
    Ok(store
        .setting(&local_scan_declined_key(account))?
        .unwrap_or_default())
}

fn local_repositories_key(account: &str) -> String {
    format!("local_repositories:{account}")
}

fn local_repositories(
    store: &Store,
    account: &str,
) -> Result<HashMap<String, LocalRepository>, AppError> {
    Ok(store
        .setting(&local_repositories_key(account))?
        .unwrap_or_default())
}

/// GitLab's page for a new token on the instance being connected, with this
/// app's name and the api scope filled in. The instance is validated like a
/// connection URL, so only a fixed path on an HTTPS GitLab is ever opened.
pub fn token_creation_url(instance_url: &str) -> Result<Url, AppError> {
    let base = normalize_instance(instance_url)?;
    base.join("-/user_settings/personal_access_tokens?name=GitLab%20Desktop&scopes=api")
        .map_err(|_| {
            AppError::new("INVALID_INPUT", "GitLab URLが正しくありません。")
                .key("native.link.invalidInstanceUrl")
        })
}

pub fn open_token_creation_page(instance_url: &str) -> Result<(), AppError> {
    let url = token_creation_url(instance_url)?;
    open::that_detached(url.as_str()).map_err(|_| {
        AppError::new("NETWORK", "既定のブラウザーで開けませんでした。")
            .key("native.link.browserFailed")
    })
}

/// A web link from a comment or description, checked before the default
/// browser opens it: only http(s) without embedded credentials.
pub fn external_url(input: &str) -> Result<Url, AppError> {
    let url = Url::parse(input.trim()).map_err(|_| {
        AppError::new("INVALID_INPUT", "URLが正しくありません。").key("native.link.invalidUrl")
    })?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(
            AppError::new("INVALID_INPUT", "http/httpsのリンクだけを開けます。")
                .key("native.link.httpOnly"),
        );
    }
    Ok(url)
}

pub fn open_external_url(input: &str) -> Result<(), AppError> {
    let url = external_url(input)?;
    open::that_detached(url.as_str()).map_err(|_| {
        AppError::new("NETWORK", "既定のブラウザーで開けませんでした。")
            .key("native.link.browserFailed")
    })
}

/// Accepts only uploads served by the connected instance (relative URLs are
/// resolved against it). Credentials are sent to that origin only.
fn instance_avatar_url(instance_url: &str, input: &str) -> Option<Url> {
    let base = normalize_instance(instance_url).ok()?;
    let url = base.join(input.trim()).ok()?;
    let uploads = format!("{}uploads/", base.path());
    (url.origin() == base.origin()
        && url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path().starts_with(&uploads)
        && !url.path().contains("/../"))
    .then_some(url)
}

/// Markdown previews may only read upload paths under the current instance,
/// or a repository file's raw content, which a Markdown file's relative image names.
fn instance_markdown_image_url(instance_url: &str, input: &str) -> Option<Url> {
    let base = normalize_instance(instance_url).ok()?;
    let url = Url::parse(input.trim()).ok()?;
    let path = url.path().to_ascii_lowercase();
    let base_path = base.path().to_ascii_lowercase();
    (url.origin() == base.origin()
        && url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && path.starts_with(&base_path)
        && !path.contains("%5c")
        && !path.contains("%2e")
        && ((path.contains("/uploads/") && !path.contains("%2f"))
            || is_repository_raw_file(&path[base_path.len()..], url.query())))
    .then_some(url)
}

/// `<project path>/uploads/<secret>/<file>` or `-/project/<id>/uploads/<secret>/<file>`
/// as `api/v4/projects/<id or encoded path>/uploads/<secret>/<file>`.
fn project_upload_api_url(instance_url: &str, url: &Url) -> Option<Url> {
    let base = normalize_instance(instance_url).ok()?;
    let rest = url.path().get(base.path().len()..)?;
    let segments: Vec<&str> = rest.split('/').collect();
    let [project @ .., "uploads", secret, file] = segments.as_slice() else {
        return None;
    };
    let project = match project {
        ["-", "project", id] if id.bytes().all(|byte| byte.is_ascii_digit()) => (*id).to_owned(),
        [first, _, ..]
            if *first != "-"
                && project
                    .iter()
                    .all(|segment| !segment.is_empty() && *segment != "-") =>
        {
            project.join("%2F")
        }
        _ => return None,
    };
    if secret.is_empty()
        || !secret.bytes().all(|byte| byte.is_ascii_alphanumeric())
        || file.is_empty()
        || url.query().is_some()
    {
        return None;
    }
    base.join(&format!(
        "api/v4/projects/{project}/uploads/{secret}/{file}"
    ))
    .ok()
}

/// `api/v4/projects/<id>/repository/files/<encoded path>/raw?ref=<ref>`: the
/// file path is one encoded segment, so no other API route can be reached.
fn is_repository_raw_file(path: &str, query: Option<&str>) -> bool {
    let Some(rest) = path.strip_prefix("api/v4/projects/") else {
        return false;
    };
    let segments: Vec<&str> = rest.split('/').collect();
    matches!(
        segments.as_slice(),
        [project, "repository", "files", file, "raw"]
            if !project.is_empty() && project.bytes().all(|byte| byte.is_ascii_digit()) && !file.is_empty()
    ) && query
        .is_some_and(|query| query.starts_with("ref=") && query.len() > 4 && !query.contains('&'))
}

/// Accepts Gravatar images, which GitLab returns as `avatar_url` for users
/// without an uploaded avatar.
fn gravatar_url(input: &str) -> Option<Url> {
    let url = Url::parse(input.trim()).ok()?;
    (url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("secure.gravatar.com" | "www.gravatar.com" | "gravatar.com")
        )
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path().starts_with("/avatar/"))
    .then_some(url)
}

/// A client without credentials for avatars hosted outside the instance.
fn anonymous_client() -> Result<reqwest::Client, AppError> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("gitlab-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| {
            AppError::new("NETWORK", "HTTPSクライアントを初期化できませんでした。")
                .key("native.connection.clientFailed")
        })?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

/// `Some(None)`: the server answered with something that is not a small
/// image. `None`: the request failed and may be retried later.
async fn fetch_avatar(client: &reqwest::Client, url: Url) -> Option<Option<String>> {
    fetch_image_data(client, url, AVATAR_MAX_BYTES).await
}

async fn fetch_image_data(
    client: &reqwest::Client,
    url: Url,
    max_bytes: usize,
) -> Option<Option<String>> {
    use base64::Engine as _;
    let mut response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return Some(None);
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .unwrap_or_default();
    // Repository files are served as raw bytes, so their type is read from the content.
    let sniff = matches!(
        content_type.as_str(),
        "application/octet-stream" | "text/plain"
    );
    if !sniff
        && !matches!(
            content_type.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml"
        )
    {
        return Some(None);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > max_bytes {
            return Some(None);
        }
        body.extend_from_slice(&chunk);
    }
    let content_type = if sniff {
        match sniff_image_type(&body) {
            Some(sniffed) => sniffed.to_owned(),
            None => return Some(None),
        }
    } else {
        content_type
    };
    Some(Some(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(body)
    )))
}

/// SVG is text: an `<svg` root, optionally after a BOM, an XML declaration, comments
/// or a doctype. Shown through `<img>`, its scripts and external references never run.
fn looks_like_svg(body: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&body[..body.len().min(1024)]).to_ascii_lowercase();
    let head = head.trim_start_matches('\u{feff}').trim_start();
    head.starts_with("<svg")
        || ((head.starts_with("<?xml")
            || head.starts_with("<!--")
            || head.starts_with("<!doctype svg"))
            && head.contains("<svg"))
}

fn sniff_image_type(body: &[u8]) -> Option<&'static str> {
    if body.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if body.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if body.len() >= 12 && &body[..4] == b"RIFF" && &body[8..12] == b"WEBP" {
        Some("image/webp")
    } else if looks_like_svg(body) {
        Some("image/svg+xml")
    } else {
        None
    }
}

fn write_busy() -> AppError {
    AppError::new(
        "BUSY",
        "投稿処理中は接続を変更できません。処理結果を確認してから操作してください。",
    )
    .key("native.connection.writeBusy")
}

fn unknown_write() -> AppError {
    AppError::new(
        "UNKNOWN_OUTCOME",
        "送信の確認を中断しました。GitLabで結果を確認してください。",
    )
    .key("native.receipt.cancelled")
}

/// The saved query answers a successful write to the merge request
/// `project_id`!`iid` can change, when they are known; `None` means the write
/// may change anything saved, and the account's whole cache is cleared.
///
/// A saved answer is only shown until the network refresh that always follows
/// it, so these rules keep the written change from flashing back to its old
/// state; other merge requests mentioned in a comment refresh as usual.
fn queries_changed_by(action: &Action, project_id: &str, iid: &str) -> Option<Vec<CacheRule>> {
    let rule = |kind: &'static str, project_id: Option<&str>, iid: Option<&str>| CacheRule {
        kind,
        project_id: project_id.map(str::to_owned),
        iid: iid.map(str::to_owned),
        pipeline_id: None,
    };
    // The merge request itself and every list that summarizes it: its title,
    // state, people, labels, update time, approvals or To-Dos.
    let merge_request = || {
        let mut rules: Vec<CacheRule> = ["mr", "notes", "discussions", "drafts", "approvals"]
            .into_iter()
            .map(|kind| rule(kind, Some(project_id), Some(iid)))
            .collect();
        // Comment reactions are addressed by the project's path, which the write does not carry.
        rules.push(rule("noteAwards", None, Some(iid)));
        rules.extend(["mrs", "mrApprovals", "todos"].map(|kind| rule(kind, None, None)));
        rules
    };
    match action {
        Action::AddAward { .. } | Action::RemoveAward { .. } => Some(vec![
            rule("mrAwards", Some(project_id), Some(iid)),
            rule("noteAwards", None, Some(iid)),
        ]),
        Action::MarkTodoDone { .. } => Some(vec![rule("todos", None, None)]),
        Action::Comment { .. }
        | Action::Reply { .. }
        | Action::EditNote { .. }
        | Action::DeleteNote { .. }
        | Action::Resolve { .. }
        | Action::SaveDraft { .. }
        | Action::EditDraft { .. }
        | Action::DeleteDraft { .. }
        | Action::PublishDraft { .. }
        | Action::Approve { .. }
        | Action::Unapprove { .. }
        | Action::SetAssignees { .. }
        | Action::SetReviewers { .. }
        | Action::SetDescription { .. }
        | Action::CancelAutoMerge { .. }
        | Action::SetState { .. }
        | Action::SetTitle { .. }
        | Action::SetMilestone { .. }
        | Action::RequestChanges { .. }
        | Action::RerequestReview { .. } => Some(merge_request()),
        // A label given by name that the project lacks is created with it.
        Action::SetLabels { .. } => {
            let mut rules = merge_request();
            rules.push(rule("labels", Some(project_id), None));
            Some(rules)
        }
        Action::RetryJob {
            pipeline_project_id,
            ..
        }
        | Action::CancelJob {
            pipeline_project_id,
            ..
        }
        | Action::PlayJob {
            pipeline_project_id,
            ..
        }
        | Action::RetryPipeline {
            pipeline_project_id,
            ..
        }
        | Action::CancelPipeline {
            pipeline_project_id,
            ..
        } => {
            let pipeline_id = match action {
                Action::RetryPipeline { pipeline_id, .. }
                | Action::CancelPipeline { pipeline_id, .. } => Some(pipeline_id.clone()),
                // A job's pipeline is not part of the write, so all of the project's pipelines go.
                _ => None,
            };
            let mut rules = merge_request();
            rules.push(rule("mrPipelines", Some(project_id), Some(iid)));
            rules.extend(["pipeline", "pipelineJobs"].map(|kind| CacheRule {
                pipeline_id: pipeline_id.clone(),
                ..rule(kind, Some(pipeline_project_id), None)
            }));
            Some(rules)
        }
        // Merging, rebasing and applying suggestions change branches, commits
        // and diffs; an upload changes nothing saved and is not cleared at all.
        Action::Merge { .. }
        | Action::Rebase { .. }
        | Action::ApplySuggestions { .. }
        | Action::UploadAttachment { .. } => None,
    }
}

fn ensure_active(inner: &Inner, session: &LiveSession) -> Result<(), AppError> {
    if session.cancelled.is_cancelled()
        || !inner
            .active
            .as_ref()
            .is_some_and(|active| active.public.id == session.public.id)
    {
        Err(cancelled())
    } else {
        Ok(())
    }
}

fn check_cooldown(session: &LiveSession) -> Result<(), AppError> {
    let retry_at = session.retry_at.load(Ordering::SeqCst);
    let now = now_ms();
    if retry_at > now {
        let wait = retry_at - now;
        Err(gitlab_api::rate_limited(Some(wait)))
    } else {
        Ok(())
    }
}

struct RequestRegistration {
    session: Arc<LiveSession>,
    id: String,
    token: CancellationToken,
}
impl RequestRegistration {
    fn new(session: Arc<LiveSession>, id: String) -> Result<Self, AppError> {
        if id.is_empty() || id.len() > 128 {
            return Err(AppError::new("INVALID_INPUT", "要求IDが正しくありません。")
                .key("native.input.requestId"));
        }
        let token = session.cancelled.child_token();
        {
            let mut requests = session.requests.lock().map_err(|_| storage_error())?;
            if requests.contains_key(&id) {
                return Err(AppError::new("INVALID_INPUT", "要求IDが重複しています。")
                    .key("native.input.duplicateRequestId"));
            }
            requests.insert(id.clone(), token.clone());
        }
        Ok(Self { session, id, token })
    }
}
impl Drop for RequestRegistration {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.session.requests.lock() {
            requests.remove(&self.id);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectInput {
    pub url: String,
    pub token: String,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReadMode {
    #[serde(rename = "cache", alias = "cacheOnly")]
    CacheOnly,
    #[serde(rename = "network", alias = "networkOnly")]
    NetworkOnly,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryInput {
    pub session_id: String,
    pub request_id: String,
    pub mode: ReadMode,
    pub query: Query,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationInput {
    pub session_id: String,
    pub request_id: String,
    pub action: Action,
    #[serde(default)]
    pub local_draft_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadInput {
    pub session_id: String,
    pub request_id: String,
    pub project_id: String,
    pub iid: String,
    pub file_name: String,
    pub data_base64: String,
}

#[cfg(test)]
mod tests;
