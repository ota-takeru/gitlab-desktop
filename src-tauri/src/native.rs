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
        ));
    }
    Ok(format!(
        "{}:{}",
        project.trim_start_matches('0'),
        iid.trim_start_matches('0')
    ))
}

fn validate_receipt_id(receipt_id: &str) -> Result<(), AppError> {
    let parsed = uuid::Uuid::parse_str(receipt_id)
        .map_err(|_| AppError::new("INVALID_INPUT", "送信記録の識別子が正しくありません。"))?;
    if receipt_id.len() != 36 || parsed.hyphenated().to_string() != receipt_id {
        return Err(AppError::new(
            "INVALID_INPUT",
            "送信記録の識別子が正しくありません。",
        ));
    }
    Ok(())
}

fn cancelled() -> AppError {
    AppError::new(
        "CANCELLED",
        "接続またはデータが変わりました。再読み込みしてください。",
    )
}
fn auth_required() -> AppError {
    AppError::new(
        "AUTH_REQUIRED",
        "GitLabに接続されていません。再接続してください。",
    )
}
/// A token rejected while the user is entering one on the connection form.
fn invalid_token(from_glab: bool) -> AppError {
    AppError::new(
        "AUTH_REQUIRED",
        if from_glab {
            "glabのアクセストークンが無効か期限切れです。glab側で認証を更新するか、トークンを直接入力してください。"
        } else {
            "アクセストークンが無効か期限切れです。新しいトークンを入力してください。"
        },
    )
}

pub fn normalize_instance(input: &str) -> Result<Url, AppError> {
    let invalid = || {
        AppError::new(
            "INVALID_INPUT",
            "HTTPSのGitLab URLを指定してください。資格情報・クエリ・フラグメントは指定できません。",
        )
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
    format!("{:x}", Sha256::digest(format!("{instance}\n{user}")))
}

fn credential_entry(key: &str) -> Result<keyring::Entry, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::new(
            "UNSUPPORTED",
            "このビルドの資格情報保存はWindowsのみ対応しています。",
        ));
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
        ));
    }
    let mut headers = HeaderMap::new();
    let header = if bearer {
        format!("Bearer {token}")
    } else {
        token.into()
    };
    let mut value = HeaderValue::from_str(&header)
        .map_err(|_| AppError::new("INVALID_INPUT", "トークンの形式が正しくありません。"))?;
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
        .map_err(|_| AppError::new("NETWORK", "HTTPSクライアントを初期化できませんでした。"))
}

async fn small_json(client: &reqwest::Client, url: Url) -> Result<serde_json::Value, AppError> {
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_timeout() { AppError::new("TIMEOUT", "接続がタイムアウトしました。") }
        else { AppError::new("NETWORK", "GitLabに接続できません。ネットワーク・プロキシ・信頼済み証明書を確認してください。") }
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
            ))
        }
        404 => {
            return Err(AppError::new(
                "NOT_FOUND",
                "GitLab APIが見つかりません。URLのベースパスを確認してください。",
            ))
        }
        300..=399 => return Err(AppError::new(
            "UNSUPPORTED",
            "認証ページへの転送を検出しました。GitLab APIのURLとトークン方式を確認してください。",
        )),
        _ => return Err(AppError::new("NETWORK", "GitLabが接続確認に失敗しました。")),
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::new("NETWORK", "接続確認の応答を受信できませんでした。"))?
    {
        if body.len() + chunk.len() > 64 * 1024 {
            return Err(AppError::new("TOO_LARGE", "接続確認の応答が大きすぎます。"));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLab APIのJSON応答ではありません。URLや組織の認証方式を確認してください。",
        )
    })
}

async fn identify(client: &reqwest::Client, api: &Url) -> Result<User, AppError> {
    let body = small_json(client, api.join("user").map_err(|_| cancelled())?).await?;
    let id = body["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .ok_or_else(|| AppError::new("UNSUPPORTED", "本人情報の形式が対応していません。"))?;
    let username = body["username"]
        .as_str()
        .ok_or_else(|| AppError::new("UNSUPPORTED", "本人情報の形式が対応していません。"))?;
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
            ));
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
                        ));
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
                    ));
                }
                return Err(AppError::new(
                    "STORAGE",
                    "Windows資格情報ストアへ保存できません。接続は保存されませんでした。",
                ));
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
                    ));
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
            inner.store.delete_setting("connection")?;
            match credential_entry(&clear_session.account)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(AppError::new("STORAGE", "データを削除しましたが、Windows資格情報の削除に失敗しました。資格情報マネージャーでGitLabDesktopを削除してください。")),
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
        let _pending = session
            .pending
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::new("RATE_LIMITED", "処理待ちが多すぎます。"))?;
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
        let _pending = session
            .pending
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::new("RATE_LIMITED", "処理待ちが多すぎます。"))?;
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
            return Err(AppError::new("INVALID_INPUT", "検索条件が長すぎます。"));
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
            return Err(AppError::new("INVALID_INPUT", "添付データが必要です。"));
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
                ))
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
        let _pending = session
            .pending
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::new("RATE_LIMITED", "処理待ちが多すぎます。"))?;
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
                        })?;
                    if draft.body.trim() != submitted_body {
                        return Err(AppError::new(
                            "INVALID_INPUT",
                            "未送信コメントが変更されています。保存後に再試行してください。",
                        ));
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
                    return Err(AppError::new("UNKNOWN_OUTCOME", "送信後の保存データを更新できませんでした。再送せずGitLabで結果を確認してください。"));
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
                    return Err(AppError::new("UNKNOWN_OUTCOME", "操作の確認記録を更新できませんでした。再送せずGitLabで結果を確認してください。"));
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
    pub async fn markdown_image(&self, id: String, input: String) -> Result<Option<String>, AppError> {
        let session = self.active(&id)?;
        let Some(url) = instance_markdown_image_url(&session.public.instance_url, &input) else {
            return Ok(None);
        };
        let key = url.to_string();
        if let Some(hit) = session.images.lock().map_err(|_| storage_error())?.get(&key) {
            return Ok(hit.clone());
        }
        if check_cooldown(&session).is_err() {
            return Ok(None);
        }
        let fetched = tokio::select! {
            fetched = async {
                let _slot = session.slots.clone().acquire_owned().await.ok()?;
                fetch_image_data(&session.client, url, MARKDOWN_IMAGE_MAX_BYTES).await
            } => fetched,
            _ = session.cancelled.cancelled() => return Err(cancelled()),
        };
        if let Some(image) = &fetched {
            let mut images = session.images.lock().map_err(|_| storage_error())?;
            if images.len() >= MARKDOWN_IMAGE_CACHE_LIMIT { images.clear(); }
            images.insert(key, image.clone());
        }
        Ok(fetched.flatten())
    }

    pub fn open_url(&self, id: &str, input: &str) -> Result<(), AppError> {
        let session = self.active(id)?;
        let base = normalize_instance(&session.public.instance_url)?;
        let url = Url::parse(input)
            .map_err(|_| AppError::new("INVALID_INPUT", "URLが正しくありません。"))?;
        if url.origin() != base.origin()
            || url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || !url.path().starts_with(base.path())
        {
            return Err(AppError::new(
                "INVALID_INPUT",
                "接続先GitLabのURLだけを開けます。",
            ));
        }
        open::that_detached(url.as_str())
            .map_err(|_| AppError::new("NETWORK", "既定のブラウザーで開けませんでした。"))
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
            })?
            .to_owned();
        let instance = normalize_instance(&session.public.instance_url)?;
        if !remotes
            .iter()
            .any(|remote| local_git::remote_matches(remote, &instance, &project_path))
        {
            return Err(AppError::new("INVALID_INPUT", &format!("このフォルダのgitリモートは {project_path} を指していません。このプロジェクトをcloneしたフォルダを指定してください（SSHの別名ホストは照合できないため、HTTPSかホスト名どおりのリモートが必要です）。")));
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
                ));
            }
            repositories.insert(project, saved);
            inner
                .store
                .set_setting(&local_repositories_key(&session.account), &repositories)
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
            repositories.remove(&project);
            inner
                .store
                .set_setting(&local_repositories_key(&session.account), &repositories)
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
        let linked = self
            .local_repository(id.clone(), project)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    "NOT_FOUND",
                    "このプロジェクトにはローカルリポジトリが紐付けられていません。",
                )
            })?;
        let session = self.active(&id)?;
        let _pending = session
            .pending
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::new("RATE_LIMITED", "処理待ちが多すぎます。"))?;
        let root = PathBuf::from(&linked.path);
        // The folder may have been re-pointed since it was linked.
        let instance = normalize_instance(&session.public.instance_url)?;
        let remotes = local_git::remote_urls(&root).await?;
        if !remotes
            .iter()
            .any(|remote| local_git::remote_matches(remote, &instance, &linked.project_path))
        {
            return Err(AppError::new("INVALID_INPUT", &format!("紐付けたフォルダのgitリモートが {} を指していません。紐付けをやり直してください。", linked.project_path)));
        }
        tokio::select! {
            result = local_git::local_changes(&root, &head_sha) => result,
            _ = session.cancelled.cancelled() => Err(cancelled()),
        }
    }
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
            })?;
        let session = self.active(&id)?;
        let _pending = session
            .pending
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::new("RATE_LIMITED", "処理待ちが多すぎます。"))?;
        let file = tauri::async_runtime::spawn_blocking(move || {
            local_git::read_worktree_file(Path::new(&linked.path), &path)
        })
        .await
        .map_err(|_| storage_error())??;
        match file {
            local_git::WorktreeFile::Text(content) => Ok(serde_json::json!({ "content": content })),
            local_git::WorktreeFile::Binary => Err(AppError::new(
                "UNSUPPORTED",
                "このファイルはUTF-8またはShift_JISのテキストではないため表示できません。",
            )),
            local_git::WorktreeFile::TooLarge => Err(AppError::new(
                "TOO_LARGE",
                "1MiBを超えるファイルは表示できません。",
            )),
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

fn validate_project_id(project: &str) -> Result<(), AppError> {
    if project.is_empty()
        || project.len() > 20
        || !project.bytes().all(|byte| byte.is_ascii_digit())
        || project.bytes().all(|byte| byte == b'0')
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "有効なプロジェクトIDを指定してください。",
        ));
    }
    Ok(())
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
        .map_err(|_| AppError::new("INVALID_INPUT", "GitLab URLが正しくありません。"))
}

pub fn open_token_creation_page(instance_url: &str) -> Result<(), AppError> {
    let url = token_creation_url(instance_url)?;
    open::that_detached(url.as_str())
        .map_err(|_| AppError::new("NETWORK", "既定のブラウザーで開けませんでした。"))
}

/// A web link from a comment or description, checked before the default
/// browser opens it: only http(s) without embedded credentials.
pub fn external_url(input: &str) -> Result<Url, AppError> {
    let url = Url::parse(input.trim())
        .map_err(|_| AppError::new("INVALID_INPUT", "URLが正しくありません。"))?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "http/httpsのリンクだけを開けます。",
        ));
    }
    Ok(url)
}

pub fn open_external_url(input: &str) -> Result<(), AppError> {
    let url = external_url(input)?;
    open::that_detached(url.as_str())
        .map_err(|_| AppError::new("NETWORK", "既定のブラウザーで開けませんでした。"))
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

/// Markdown previews may only read upload paths under the current instance.
fn instance_markdown_image_url(instance_url: &str, input: &str) -> Option<Url> {
    let base = normalize_instance(instance_url).ok()?;
    let url = Url::parse(input.trim()).ok()?;
    let path = url.path().to_ascii_lowercase();
    (url.origin() == base.origin()
        && url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && path.starts_with(&base.path().to_ascii_lowercase())
        && path.contains("/uploads/")
        && !path.contains("%2f")
        && !path.contains("%5c")
        && !path.contains("%2e"))
    .then_some(url)
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
        .map_err(|_| AppError::new("NETWORK", "HTTPSクライアントを初期化できませんでした。"))?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

/// `Some(None)`: the server answered with something that is not a small
/// image. `None`: the request failed and may be retried later.
async fn fetch_avatar(client: &reqwest::Client, url: Url) -> Option<Option<String>> {
    fetch_image_data(client, url, AVATAR_MAX_BYTES).await
}

async fn fetch_image_data(client: &reqwest::Client, url: Url, max_bytes: usize) -> Option<Option<String>> {
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
    if !matches!(
        content_type.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Some(None);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > max_bytes {
            return Some(None);
        }
        body.extend_from_slice(&chunk);
    }
    Some(Some(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(body)
    )))
}

fn write_busy() -> AppError {
    AppError::new(
        "BUSY",
        "投稿処理中は接続を変更できません。処理結果を確認してから操作してください。",
    )
}

fn unknown_write() -> AppError {
    AppError::new(
        "UNKNOWN_OUTCOME",
        "送信の確認を中断しました。GitLabで結果を確認してください。",
    )
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
        let mut error = AppError::new(
            "RATE_LIMITED",
            &gitlab_api::rate_limited_message(Some(wait)),
        );
        error.retry_after_ms = Some(wait);
        Err(error)
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
            return Err(AppError::new("INVALID_INPUT", "要求IDが正しくありません。"));
        }
        let token = session.cancelled.child_token();
        {
            let mut requests = session.requests.lock().map_err(|_| storage_error())?;
            if requests.contains_key(&id) {
                return Err(AppError::new("INVALID_INPUT", "要求IDが重複しています。"));
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
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn imported_bearer_headers_are_sensitive_and_old_connections_remain_compatible() {
        let headers = credential_headers("fake-token-only", true).unwrap();
        assert_eq!(headers["Authorization"], "Bearer fake-token-only");
        assert!(headers["Authorization"].is_sensitive());
        assert!(!headers.contains_key("PRIVATE-TOKEN"));
        let headers = credential_headers("fake-token-only", false).unwrap();
        assert_eq!(headers["PRIVATE-TOKEN"], "fake-token-only");
        assert!(headers["PRIVATE-TOKEN"].is_sensitive());
        assert!(!headers.contains_key("Authorization"));
        let saved: SavedConnection = serde_json::from_value(serde_json::json!({
            "instanceUrl": "https://gitlab.com/", "user": { "id": "1", "name": "One", "username": "one" },
            "serverVersion": null, "credentialKey": "fixture"
        })).unwrap();
        assert!(!saved.bearer);
        let mut imported = saved;
        imported.bearer = true;
        let restored: SavedConnection =
            serde_json::from_value(serde_json::to_value(imported).unwrap()).unwrap();
        assert!(restored.bearer);
    }

    #[tokio::test]
    #[ignore = "Explicit read-only authentication check; set GLAB_TEST_URL to the intended saved instance"]
    async fn imported_glab_token_authenticates_selected_instance() {
        let url = std::env::var("GLAB_TEST_URL")
            .expect("Set GLAB_TEST_URL for the intended saved glab instance");
        let instance = normalize_instance(&url).unwrap();
        let token = crate::glab::read_token(&instance, &std::env::temp_dir())
            .await
            .unwrap();
        let client = http_client(&token, true).unwrap();
        let user = identify(&client, &instance.join("api/v4/").unwrap())
            .await
            .unwrap();
        assert!(!user.id.is_empty());
    }

    #[test]
    #[ignore = "Explicit Windows OS credential storage integration check"]
    fn windows_credentials_roundtrip() {
        let entry = credential_entry(&format!("fixture-{}", uuid::Uuid::new_v4())).unwrap();
        entry.set_password("non-secret-fixture-value").unwrap();
        let value = entry.get_password();
        let deletion = entry.delete_credential();
        assert_eq!(value.unwrap(), "non-secret-fixture-value");
        deletion.unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }

    fn test_state(api: Url) -> (Arc<NativeState>, Arc<LiveSession>) {
        let saved = SavedConnection {
            instance_url: "https://fixture.invalid/".into(),
            user: User {
                id: "1".into(),
                username: "fixture".into(),
                name: "Fixture".into(),
                avatar_url: None,
            },
            server_version: None,
            credential_key: uuid::Uuid::new_v4().to_string(),
            bearer: false,
        };
        let mut live = make_session(
            saved,
            reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
        )
        .unwrap();
        Arc::get_mut(&mut live).unwrap().api_base = api;
        let state = Arc::new(NativeState {
            inner: Arc::new(Mutex::new(Inner {
                active: Some(live.clone()),
                store: Store::memory(),
            })),
            lifecycle: AsyncMutex::new(()),
            directory: std::env::temp_dir(),
        });
        (state, live)
    }

    fn same_account_session(account: &str, source: &LiveSession, api: Url) -> Arc<LiveSession> {
        let saved = SavedConnection {
            instance_url: source.public.instance_url.clone(),
            user: source.public.user.clone(),
            server_version: source.public.server_version.clone(),
            credential_key: account.to_owned(),
            bearer: false,
        };
        let mut live = make_session(
            saved,
            reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
        )
        .unwrap();
        Arc::get_mut(&mut live).unwrap().api_base = api;
        live
    }

    fn spawn_http_response(
        status: &str,
        body: &str,
    ) -> (
        Url,
        tokio::sync::oneshot::Receiver<()>,
        std::sync::mpsc::Sender<()>,
        std::thread::JoinHandle<()>,
    ) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 16 * 1024];
            let _ = socket.read(&mut buffer);
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let _ = socket.write_all(response.as_bytes());
        });
        (
            Url::parse(&format!("http://{address}/api/v4/")).unwrap(),
            started_rx,
            release_tx,
            server,
        )
    }

    fn spawn_transport_failure() -> (
        Url,
        tokio::sync::oneshot::Receiver<()>,
        std::thread::JoinHandle<()>,
    ) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 16 * 1024];
            let _ = socket.read(&mut buffer);
            started_tx.send(()).unwrap();
            drop(socket);
        });
        (
            Url::parse(&format!("http://{address}/api/v4/")).unwrap(),
            started_rx,
            server,
        )
    }

    fn upload_input(session: &LiveSession) -> UploadInput {
        UploadInput {
            session_id: session.public.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            project_id: "7".into(),
            iid: "1".into(),
            file_name: "test.txt".into(),
            data_base64: "YWJj".into(),
        }
    }

    #[tokio::test]
    async fn upload_uses_durable_receipt_and_preserves_local_input() {
        let (api, started, release, server) = spawn_http_response(
            "201 Created",
            r#"{"url":"/uploads/abc/test.txt","full_path":"/-/project/7/uploads/abc/test.txt","markdown":"[test](/uploads/abc/test.txt)"}"#,
        );
        let (state, session) = test_state(api);
        state
            .save_local_draft(
                session.public.id.clone(),
                "composer".into(),
                "keep input".into(),
            )
            .await
            .unwrap();
        let worker = state.clone();
        let input = upload_input(&session);
        let pending = tokio::spawn(async move { worker.upload_attachment(input).await });
        started.await.unwrap();
        let receipt = state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(receipt.action, Action::UploadAttachment { .. }));
        let wire = serde_json::to_value(receipt).unwrap();
        assert!(wire["action"].get("dataBase64").is_none());
        release.send(()).unwrap();
        let markdown = pending.await.unwrap().unwrap();
        assert!(markdown.contains("/-/project/7/uploads/abc/test.txt"));
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            state
                .local_draft(session.public.id.clone(), "composer".into())
                .await
                .unwrap()
                .unwrap()
                .body,
            "keep input"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn ambiguous_upload_keeps_receipt_and_blocks_resend() {
        let (api, started, release, server) =
            spawn_http_response("500 Internal Server Error", "{}");
        let (state, session) = test_state(api);
        let worker = state.clone();
        let input = upload_input(&session);
        let pending = tokio::spawn(async move { worker.upload_attachment(input).await });
        started.await.unwrap();
        release.send(()).unwrap();
        assert_eq!(pending.await.unwrap().unwrap_err().code, "UNKNOWN_OUTCOME");
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_some());
        assert_eq!(
            state
                .upload_attachment(upload_input(&session))
                .await
                .unwrap_err()
                .code,
            "UNKNOWN_OUTCOME"
        );
        server.join().unwrap();
    }

    fn comment_action() -> Action {
        Action::Comment {
            project_id: "7".into(),
            iid: "1".into(),
            body: "テストコメント".into(),
            thread: false,
            position: None,
        }
    }

    #[tokio::test]
    async fn mutation_persists_receipt_before_write_and_clears_after_known_success() {
        let (api, started, release, server) = spawn_http_response("200 OK", r#"{"id":1}"#);
        let (state, session) = test_state(api);
        let request_id = uuid::Uuid::new_v4().to_string();
        let input = MutationInput {
            session_id: session.public.id.clone(),
            request_id,
            action: comment_action(),
            local_draft_key: None,
        };
        let worker = state.clone();
        let pending = tokio::spawn(async move { worker.mutate(input).await });
        tokio::time::timeout(Duration::from_secs(5), started)
            .await
            .unwrap()
            .unwrap();
        let receipt = state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .expect("receipt must be committed before the HTTP request");
        assert!(!receipt.id.is_empty());
        release.send(()).unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(5), pending)
            .await
            .unwrap()
            .unwrap()
            .is_ok());
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_none());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn successful_mutation_atomically_removes_matching_local_draft() {
        let (api, started, release, server) = spawn_http_response("200 OK", r#"{"id":1}"#);
        let (state, session) = test_state(api);
        state
            .save_local_draft(
                session.public.id.clone(),
                "composer".into(),
                "  テストコメント\n".into(),
            )
            .await
            .unwrap();
        let worker = state.clone();
        let session_id = session.public.id.clone();
        let pending = tokio::spawn(async move {
            worker
                .mutate(MutationInput {
                    session_id,
                    request_id: uuid::Uuid::new_v4().to_string(),
                    action: comment_action(),
                    local_draft_key: Some("composer".into()),
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(5), started)
            .await
            .unwrap()
            .unwrap();
        release.send(()).unwrap();
        assert!(pending.await.unwrap().is_ok());
        assert!(state
            .local_draft(session.public.id.clone(), "composer".into())
            .await
            .unwrap()
            .is_none());
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_none());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn mutation_rejects_changed_local_draft_before_network_or_receipt() {
        let (state, session) = test_state(Url::parse("http://127.0.0.1:1/api/v4/").unwrap());
        state
            .save_local_draft(
                session.public.id.clone(),
                "composer".into(),
                "different text".into(),
            )
            .await
            .unwrap();
        let error = state
            .mutate(MutationInput {
                session_id: session.public.id.clone(),
                request_id: uuid::Uuid::new_v4().to_string(),
                action: comment_action(),
                local_draft_key: Some("composer".into()),
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            state
                .local_draft(session.public.id.clone(), "composer".into())
                .await
                .unwrap()
                .unwrap()
                .body,
            "different text"
        );
    }

    #[tokio::test]
    async fn cancellation_after_network_start_keeps_receipt_and_blocks_connection_changes() {
        let (api, started, release, server) = spawn_http_response("200 OK", r#"{"id":1}"#);
        let (state, session) = test_state(api);
        state
            .save_local_draft(
                session.public.id.clone(),
                "composer".into(),
                "テストコメント".into(),
            )
            .await
            .unwrap();
        let request_id = uuid::Uuid::new_v4().to_string();
        let worker = state.clone();
        let worker_request_id = request_id.clone();
        let session_id = session.public.id.clone();
        let pending = tokio::spawn(async move {
            worker
                .mutate(MutationInput {
                    session_id,
                    request_id: worker_request_id,
                    action: comment_action(),
                    local_draft_key: Some("composer".into()),
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(5), started)
            .await
            .unwrap()
            .unwrap();
        let receipt = state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(
            state
                .disconnect(session.public.id.clone())
                .await
                .unwrap_err()
                .code,
            "BUSY"
        );
        assert_eq!(
            state
                .connect(ConnectInput {
                    url: "not-a-url".into(),
                    token: String::new(),
                })
                .await
                .unwrap_err()
                .code,
            "BUSY"
        );

        state
            .cancel_request(&session.public.id, &request_id)
            .unwrap();
        let error = tokio::time::timeout(Duration::from_secs(5), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(error.code, "UNKNOWN_OUTCOME");
        let retained = state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(retained.id, receipt.id);
        assert_eq!(
            state
                .local_draft(session.public.id.clone(), "composer".into())
                .await
                .unwrap()
                .unwrap()
                .body,
            "テストコメント"
        );
        release.send(()).unwrap();
        server.join().unwrap();
    }

    #[tokio::test]
    async fn server_error_keeps_receipt_and_refuses_same_mr_before_second_network_send() {
        let (api, started, release, server) =
            spawn_http_response("500 Internal Server Error", "{}");
        let (state, session) = test_state(api);
        let first = MutationInput {
            session_id: session.public.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            action: comment_action(),
            local_draft_key: None,
        };
        let worker = state.clone();
        let pending = tokio::spawn(async move { worker.mutate(first).await });
        tokio::time::timeout(Duration::from_secs(5), started)
            .await
            .unwrap()
            .unwrap();
        release.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(result.code, "UNKNOWN_OUTCOME");
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_some());

        let second = state
            .mutate(MutationInput {
                session_id: session.public.id.clone(),
                request_id: uuid::Uuid::new_v4().to_string(),
                action: comment_action(),
                local_draft_key: None,
            })
            .await
            .unwrap_err();
        assert_eq!(second.code, "UNKNOWN_OUTCOME");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn transport_failure_keeps_receipt_for_restart_recovery() {
        let (api, started, server) = spawn_transport_failure();
        let (state, session) = test_state(api);
        let session_id = session.public.id.clone();
        let worker_session_id = session_id.clone();
        let worker = state.clone();
        let pending = tokio::spawn(async move {
            worker
                .mutate(MutationInput {
                    session_id: worker_session_id,
                    request_id: uuid::Uuid::new_v4().to_string(),
                    action: comment_action(),
                    local_draft_key: None,
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(5), started)
            .await
            .unwrap()
            .unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(result.code, "UNKNOWN_OUTCOME");
        assert!(state
            .pending_operation(session_id, "7".into(), "1".into())
            .await
            .unwrap()
            .is_some());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn pending_acknowledgement_requires_current_receipt_id() {
        let (state, session) = test_state(Url::parse("http://127.0.0.1:1/api/v4/").unwrap());
        let action = serde_json::to_value(comment_action()).unwrap();
        let receipt_id = uuid::Uuid::new_v4().to_string();
        let receipt_for_store = receipt_id.clone();
        let account = session.account.clone();
        state
            .blocking(move |inner| {
                inner.store.begin_operation(
                    &account,
                    "7:1",
                    &serde_json::json!({"id":receipt_for_store,"action":action,"startedAt":now_ms()}),
                )
            })
            .await
            .unwrap();
        let stale = state
            .acknowledge_pending_operation(
                session.public.id.clone(),
                "7".into(),
                "1".into(),
                uuid::Uuid::new_v4().to_string(),
            )
            .await
            .unwrap_err();
        assert_eq!(stale.code, "CANCELLED");
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_some());
        let malformed = state
            .acknowledge_pending_operation(
                session.public.id.clone(),
                "7".into(),
                "1".into(),
                "stale-receipt".into(),
            )
            .await
            .unwrap_err();
        assert_eq!(malformed.code, "INVALID_INPUT");
        state
            .acknowledge_pending_operation(
                session.public.id.clone(),
                "7".into(),
                "1".into(),
                receipt_id,
            )
            .await
            .unwrap();
        assert!(state
            .pending_operation(session.public.id.clone(), "7".into(), "1".into())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn local_drafts_deny_invalid_sessions_survive_auth_deactivation_and_clear_privately() {
        let (state, session) = test_state(Url::parse("http://127.0.0.1:1/api/v4/").unwrap());
        let invalid = state
            .save_local_draft("invalid-session".into(), "composer".into(), "本文".into())
            .await
            .unwrap_err();
        assert_eq!(invalid.code, "AUTH_REQUIRED");

        state
            .save_local_draft(session.public.id.clone(), "composer".into(), "本文".into())
            .await
            .unwrap();
        let account = session.account.clone();
        state
            .record_error(&session, &auth_required(), None)
            .await
            .unwrap();
        let restored = same_account_session(
            &account,
            &session,
            Url::parse("http://127.0.0.1:1/api/v4/").unwrap(),
        );
        let restored_id = restored.public.id.clone();
        state
            .blocking(move |inner| {
                inner.active = Some(restored);
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(
            state
                .local_draft(restored_id.clone(), "composer".into())
                .await
                .unwrap()
                .unwrap()
                .body,
            "本文"
        );

        let account = account.clone();
        state
            .blocking(move |inner| inner.store.clear_private_account(&account))
            .await
            .unwrap();
        assert!(state
            .local_draft(restored_id, "composer".into())
            .await
            .unwrap()
            .is_none());
    }

    fn projects_input(session: &LiveSession, mode: ReadMode) -> QueryInput {
        QueryInput {
            session_id: session.public.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            mode,
            query: Query::Projects {
                search: String::new(),
                membership: false,
                include_archived: true,
                page: 1,
            },
        }
    }

    #[tokio::test]
    async fn late_network_response_cannot_recreate_logged_out_cache() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 4096];
            let _ = socket.read(&mut buffer);
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let _=socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]");
        });
        let (state, session) =
            test_state(Url::parse(&format!("http://{address}/api/v4/")).unwrap());
        let input = projects_input(&session, ReadMode::NetworkOnly);
        let worker = state.clone();
        let pending = tokio::spawn(async move { worker.query(input).await });
        started_rx.await.unwrap();
        session.cancelled.cancel();
        let account = session.account.clone();
        state
            .blocking(move |inner| {
                inner.active = None;
                inner.store.clear_account(&account)
            })
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        assert_eq!(pending.await.unwrap().unwrap_err().code, "CANCELLED");
        let account = session.account.clone();
        let key =
            serde_json::to_string(&projects_input(&session, ReadMode::CacheOnly).query).unwrap();
        assert!(state
            .blocking(move |inner| inner.store.get(&account, &key))
            .await
            .unwrap()
            .is_none());
        server.join().unwrap();
    }

    #[test]
    fn a_write_clears_only_what_it_can_change() {
        let kinds = |action: Action| {
            queries_changed_by(&action, "7", "120").map(|rules| {
                rules
                    .into_iter()
                    .map(|rule| {
                        format!(
                            "{}:{}:{}:{}",
                            rule.kind,
                            rule.project_id.unwrap_or_default(),
                            rule.iid.unwrap_or_default(),
                            rule.pipeline_id.unwrap_or_default()
                        )
                    })
                    .collect::<Vec<_>>()
            })
        };
        let comment = kinds(Action::Comment {
            project_id: "7".into(),
            iid: "120".into(),
            body: "LGTM".into(),
            thread: false,
            position: None,
        })
        .unwrap();
        for expected in [
            "discussions:7:120:",
            "mr:7:120:",
            "noteAwards::120:",
            "mrs:::",
            "todos:::",
        ] {
            assert!(comment.contains(&expected.to_owned()), "{expected}");
        }
        // The MR's diffs and other kinds of saved data stay.
        assert!(!comment
            .iter()
            .any(|rule| rule.starts_with("diffs:") || rule.starts_with("projects:")));

        assert_eq!(
            kinds(Action::AddAward {
                project_id: "7".into(),
                iid: "120".into(),
                note_id: Some("9".into()),
                name: "tada".into(),
            }),
            Some(vec![
                "mrAwards:7:120:".to_owned(),
                "noteAwards::120:".to_owned()
            ])
        );
        let retry = kinds(Action::RetryPipeline {
            project_id: "7".into(),
            iid: "120".into(),
            pipeline_project_id: "8".into(),
            pipeline_id: "55".into(),
        })
        .unwrap();
        assert!(retry.contains(&"pipeline:8::55".to_owned()));
        assert!(retry.contains(&"mrPipelines:7:120:".to_owned()));
        // Branch and code changes still clear everything.
        assert_eq!(
            kinds(Action::Rebase {
                project_id: "7".into(),
                iid: "120".into(),
                sha: "a".repeat(40),
            }),
            None
        );
    }

    #[tokio::test]
    async fn job_logs_are_returned_but_never_saved_to_the_cache() {
        let (api, started, release, server) = spawn_http_response("200 OK", "secret=1\n");
        let (state, session) = test_state(api);
        let input = QueryInput {
            session_id: session.public.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            mode: ReadMode::NetworkOnly,
            query: Query::JobTrace {
                project_id: "7".into(),
                job_id: "900".into(),
            },
        };
        let key = serde_json::to_string(&input.query).unwrap();
        let worker = state.clone();
        let pending = tokio::spawn(async move { worker.query(input).await });
        started.await.unwrap();
        release.send(()).unwrap();
        let snapshot = pending.await.unwrap().unwrap().unwrap();
        assert_eq!(
            snapshot.data["lines"],
            serde_json::json!([[{"text": "secret=1"}]])
        );
        let account = session.account.clone();
        assert!(state
            .blocking(move |inner| inner.store.get(&account, &key))
            .await
            .unwrap()
            .is_none());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn a_job_without_a_log_keeps_the_account_cache() {
        let (api, started, release, server) = spawn_http_response("404 Not Found", "{}");
        let (state, session) = test_state(api);
        let account = session.account.clone();
        state
            .blocking(move |inner| {
                inner.store.put(
                    &account,
                    "cached",
                    &Snapshot {
                        data: serde_json::json!([]),
                        fetched_at: now_ms(),
                        source: "network".into(),
                        next_page: None,
                        total_pages: None,
                        completeness: "complete".into(),
                    },
                )
            })
            .await
            .unwrap();
        let input = QueryInput {
            session_id: session.public.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            mode: ReadMode::NetworkOnly,
            query: Query::JobTrace {
                project_id: "7".into(),
                job_id: "900".into(),
            },
        };
        let worker = state.clone();
        let pending = tokio::spawn(async move { worker.query(input).await });
        started.await.unwrap();
        release.send(()).unwrap();
        assert_eq!(pending.await.unwrap().unwrap_err().code, "NOT_FOUND");
        let account = session.account.clone();
        assert!(state
            .blocking(move |inner| inner.store.get(&account, "cached"))
            .await
            .unwrap()
            .is_some());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn cancelled_requests_release_queue_and_deny_invalid_session() {
        let (state, session) = test_state(Url::parse("http://127.0.0.1:1/api/v4/").unwrap());
        let mut input = projects_input(&session, ReadMode::CacheOnly);
        input.session_id = "another-session".into();
        assert_eq!(state.query(input).await.unwrap_err().code, "AUTH_REQUIRED");
        let registration = RequestRegistration::new(session.clone(), "request".into()).unwrap();
        state.cancel_request(&session.public.id, "request").unwrap();
        assert!(registration.token.is_cancelled());
        assert!(RequestRegistration::new(session.clone(), "request".into()).is_err());
        drop(registration);
        assert!(session.requests.lock().unwrap().is_empty());
        let _permits = session
            .pending
            .clone()
            .acquire_many_owned(16)
            .await
            .unwrap();
        assert_eq!(
            state
                .query(projects_input(&session, ReadMode::NetworkOnly))
                .await
                .unwrap_err()
                .code,
            "RATE_LIMITED"
        );
    }

    #[tokio::test]
    #[ignore = "Explicit live GitLab.com public API check; no token required"]
    async fn gitlab_com_public_projects() {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap();
        let response = gitlab_api::fetch(
            &client,
            &Url::parse("https://gitlab.com/api/v4/").unwrap(),
            &Query::Projects {
                search: "gitlab".into(),
                membership: false,
                include_archived: true,
                page: 1,
            },
        )
        .await
        .unwrap();
        let projects = response.data.as_array().unwrap();
        assert!(!projects.is_empty());
        assert!(projects
            .iter()
            .all(|project| project["id"].as_str().is_some()
                && project["pathWithNamespace"].as_str().is_some()));
    }
    #[test]
    fn normalizes_cloud_and_self_managed_subpath_and_rejects_secrets() {
        assert_eq!(
            normalize_instance("https://gitlab.com").unwrap().as_str(),
            "https://gitlab.com/"
        );
        assert_eq!(
            normalize_instance("https://git.local:443/gitlab")
                .unwrap()
                .as_str(),
            "https://git.local/gitlab/"
        );
        for invalid in [
            "http://git.local",
            "https://user:secret@git.local",
            "https://git.local/?token=secret",
            "https://git.local/#secret",
            "https://git.local/git%2flab",
        ] {
            assert!(normalize_instance(invalid).is_err());
        }
        assert_ne!(
            account_key("https://a/", "1"),
            account_key("https://b/", "1")
        );
        assert_ne!(
            account_key("https://a/", "1"),
            account_key("https://a/", "2")
        );
    }

    #[test]
    fn external_links_are_web_urls_without_credentials() {
        assert_eq!(
            external_url(" https://docs.gitlab.com/ee/api/ ")
                .unwrap()
                .as_str(),
            "https://docs.gitlab.com/ee/api/"
        );
        assert!(external_url("http://intranet.example/page?q=1#top").is_ok());
        for invalid in [
            "",
            "docs.gitlab.com",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "mailto:someone@example.com",
            "ms-settings:privacy",
            "https://user:secret@example.com/",
        ] {
            assert_eq!(
                external_url(invalid).unwrap_err().code,
                "INVALID_INPUT",
                "{invalid}"
            );
        }
    }

    #[test]
    fn token_creation_page_is_a_fixed_path_on_a_validated_instance() {
        assert_eq!(
            token_creation_url("https://gitlab.com").unwrap().as_str(),
            "https://gitlab.com/-/user_settings/personal_access_tokens?name=GitLab%20Desktop&scopes=api"
        );
        assert_eq!(
            token_creation_url(" https://Git.Local:443/gitlab/ ")
                .unwrap()
                .as_str(),
            "https://git.local/gitlab/-/user_settings/personal_access_tokens?name=GitLab%20Desktop&scopes=api"
        );
        for invalid in [
            "",
            "gitlab.com",
            "http://git.local",
            "javascript:alert(1)",
            "file:///C:/Windows",
            "https://user:secret@git.local",
            "https://git.local/?token=secret",
            "https://git.local/#secret",
            "https://git.local/git%2flab",
        ] {
            assert_eq!(
                token_creation_url(invalid).unwrap_err().code,
                "INVALID_INPUT",
                "{invalid}"
            );
        }
    }

    #[test]
    fn avatar_urls_are_limited_to_instance_uploads() {
        let instance = "https://gitlab.example/GitLab/";
        let accepted = instance_avatar_url(
            instance,
            "https://gitlab.example/GitLab/uploads/-/system/user/avatar/7/avatar.png?width=64",
        )
        .unwrap();
        assert_eq!(
            accepted.path(),
            "/GitLab/uploads/-/system/user/avatar/7/avatar.png"
        );
        assert!(
            instance_avatar_url(instance, "/GitLab/uploads/-/system/user/avatar/7/a.png").is_some()
        );
        for rejected in [
            "http://gitlab.example/GitLab/uploads/-/system/user/avatar/7/a.png",
            "https://gitlab.example/GitLab/api/v4/user",
            "https://gitlab.example/other/uploads/a.png",
            "https://user:pass@gitlab.example/GitLab/uploads/a.png",
            "https://gitlab.example.evil/GitLab/uploads/a.png",
        ] {
            assert!(
                instance_avatar_url(instance, rejected).is_none(),
                "{rejected}"
            );
        }
        assert!(
            instance_avatar_url(instance, "https://secure.gravatar.com/avatar/abc?s=80").is_none()
        );
    }

    #[tokio::test]
    async fn reauthentication_needs_a_saved_connection_and_keeps_local_drafts_on_failure() {
        let (state, session) = test_state(Url::parse("http://127.0.0.1:1/api/v4/").unwrap());
        let missing = state.reauthenticate("token".into()).await.unwrap_err();
        assert_eq!(missing.code, "AUTH_REQUIRED");

        let saved = SavedConnection {
            instance_url: "https://127.0.0.1:1/".into(),
            user: session.public.user.clone(),
            server_version: None,
            credential_key: session.account.clone(),
            bearer: false,
        };
        state
            .blocking(move |inner| inner.store.set_setting("connection", &saved))
            .await
            .unwrap();
        state
            .save_local_draft(session.public.id.clone(), "composer".into(), "本文".into())
            .await
            .unwrap();
        let unreachable = state.reauthenticate("token".into()).await.unwrap_err();
        assert!(matches!(unreachable.code.as_str(), "NETWORK" | "TIMEOUT"));
        let draft = state
            .local_draft(session.public.id.clone(), "composer".into())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(draft.body, "本文");
    }

    #[test]
    fn markdown_images_only_allow_same_instance_uploads() {
        let base = "https://gitlab.example/GitLab/";
        assert!(instance_markdown_image_url(base, "https://gitlab.example/GitLab/group/repo/uploads/ab/photo.png").is_some());
        assert!(instance_markdown_image_url(base, "https://gitlab.example/GitLab/uploads/a.png").is_some());
        for bad in [
            "https://other.example/GitLab/group/repo/uploads/a.png",
            "http://gitlab.example/GitLab/uploads/a.png",
            "https://gitlab.example/GitLab/api/v4/user",
            "https://gitlab.example/GitLab/group/repo/-/raw/main/secrets.txt",
            "https://gitlab.example/GitLab/uploads/%2e%2e/api/v4/user",
        ] {
            assert!(instance_markdown_image_url(base, bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn gravatar_urls_are_accepted_only_over_https_from_gravatar() {
        assert!(gravatar_url("https://secure.gravatar.com/avatar/abc?s=80&d=identicon").is_some());
        assert!(gravatar_url("https://www.gravatar.com/avatar/abc?s=80&d=identicon").is_some());
        for rejected in [
            "http://www.gravatar.com/avatar/abc?s=80",
            "https://secure.gravatar.com/profile/abc",
            "https://secure.gravatar.com:8443/avatar/abc",
            "https://user@secure.gravatar.com/avatar/abc",
            "https://secure.gravatar.com.evil/avatar/abc",
            "/avatar/abc",
        ] {
            assert!(gravatar_url(rejected).is_none(), "{rejected}");
        }
    }
}
