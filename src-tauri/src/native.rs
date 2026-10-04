use crate::dto::{Action, AppError, Query, Session, User};
use crate::gitlab_api;
use crate::storage::{now_ms, storage_error, Snapshot, Store};
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
    pending: Arc<Semaphore>,
    mutation_lock: AsyncMutex<()>,
    revision: AtomicU64,
    retry_at: AtomicU64,
}

struct Inner {
    active: Option<Arc<LiveSession>>,
    store: Store,
}

pub struct NativeState {
    inner: Arc<Mutex<Inner>>,
    lifecycle: AsyncMutex<()>,
    directory: PathBuf,
}

fn cancelled() -> AppError {
    AppError::new(
        "CANCELLED",
        "接続またはデータが変わりました。再読み込みしてください。",
    )
}
fn auth_required() -> AppError {
    AppError::new("AUTH_REQUIRED", "接続設定から認証してください。")
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
        401 => return Err(auth_required()),
        403 => {
            return Err(AppError::new(
                "FORBIDDEN",
                "このトークンではAPIを利用できません。権限を確認してください。",
            ))
        }
        404 => {
            return Err(AppError::new(
                "NOT_FOUND",
                "GitLab APIが見つかりません。URLのベースパスを確認してください。",
            ))
        }
        429 => {
            return Err(AppError::new(
                "RATE_LIMITED",
                "GitLabの要求制限に達しました。時間をおいて再試行してください。",
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
        pending: Arc::new(Semaphore::new(16)),
        mutation_lock: AsyncMutex::new(()),
        revision: AtomicU64::new(0),
        retry_at: AtomicU64::new(0),
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
        self.connect_locked(input, false).await
    }

    pub async fn connect_from_glab(&self, url: String) -> Result<Session, AppError> {
        let _lifecycle = self.lifecycle.lock().await;
        let instance = normalize_instance(&url)?;
        let token = crate::glab::read_token(&instance, &self.directory).await?;
        // Bearer accepts both PAT and OAuth access tokens. No token enters IPC.
        self.connect_locked(ConnectInput { url, token }, true).await
    }

    async fn connect_locked(&self, input: ConnectInput, bearer: bool) -> Result<Session, AppError> {
        let instance = normalize_instance(&input.url)?;
        let client = http_client(&input.token, bearer)?;
        let api = instance.join("api/v4/").map_err(|_| cancelled())?;
        let user = identify(&client, &api).await?;
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
            let entry = credential_entry(&saved.credential_key)?;
            entry.set_password(&input.token).map_err(|_| {
                AppError::new(
                    "STORAGE",
                    "Windows資格情報ストアへ保存できません。接続は保存されませんでした。",
                )
            })?;
            if let Err(error) = inner.store.set_setting("connection", &saved) {
                let _ = entry.delete_credential();
                return Err(error);
            }
            if let Some(old) = inner.active.take() {
                old.cancelled.cancel();
            }
            inner.active = Some(session);
            if let Some(previous) =
                previous.filter(|previous| previous.credential_key != saved.credential_key)
            {
                inner.store.clear_account(&previous.credential_key)?;
                match credential_entry(&previous.credential_key)?.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => (),
                    Err(_) => return Err(storage_error()),
                }
            }
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
        // Cancellation happens before credential/DB work; late responses cannot persist.
        session.cancelled.cancel();
        self.blocking(move |inner| {
            inner.active = None;
            inner.store.clear_account(&session.account)?;
            inner.store.delete_setting("connection")?;
            match credential_entry(&session.account)?.delete_credential() {
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
                    self.record_error(&session, &error, Some(key.clone()))
                        .await?;
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
                completeness: if result.truncated {
                    "truncated"
                } else if result.next_page.is_some() {
                    "page"
                } else {
                    "complete"
                }
                .into(),
            };
            let copy = snapshot.clone();
            let session = session.clone();
            self.blocking(move |inner| {
                ensure_active(inner, &session)?;
                if session.revision.load(Ordering::SeqCst) != revision {
                    return Err(cancelled());
                }
                inner.store.put(&session.account, &key, &copy)
            })
            .await?;
            Ok(Some(snapshot))
        };
        tokio::select! { result = work => result, _ = session.cancelled.cancelled()=>Err(cancelled()), _ = registration.token.cancelled()=>Err(cancelled()) }
    }

    pub async fn mutate(&self, input: MutationInput) -> Result<(), AppError> {
        let session = self.active(&input.session_id)?;
        let _pending = session
            .pending
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::new("RATE_LIMITED", "処理待ちが多すぎます。"))?;
        let registration = RequestRegistration::new(session.clone(), input.request_id)?;
        let work = async {
            let _write = session.mutation_lock.lock().await;
            let _slot = session
                .slots
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| cancelled())?;
            check_cooldown(&session)?;
            session.revision.fetch_add(1, Ordering::SeqCst);
            let result = gitlab_api::mutate(
                &session.client,
                &session.api_base,
                &input.action,
                &session.public.user.id,
            )
            .await;
            session.revision.fetch_add(1, Ordering::SeqCst);
            if let Err(error) = &result {
                self.record_error(&session, error, None).await?;
            }
            if result.is_ok()
                || result
                    .as_ref()
                    .is_err_and(|error| error.code == "UNKNOWN_OUTCOME")
            {
                let cache_session = session.clone();
                if self
                    .blocking(move |inner| {
                        ensure_active(inner, &cache_session)?;
                        inner.store.clear_account(&cache_session.account)
                    })
                    .await
                    .is_err()
                {
                    session.cancelled.cancel();
                    return Err(AppError::new("UNKNOWN_OUTCOME", "送信後の保存データを更新できませんでした。再送せずGitLabで結果を確認してください。"));
                }
            }
            result
        };
        // Cancelling a write may occur after GitLab accepted it: never imply safe re-send.
        let outcome = tokio::select! { result = work => result, _ = session.cancelled.cancelled()=>Err(AppError::new("UNKNOWN_OUTCOME", "接続が切り替わりました。GitLabで投稿結果を確認してください。")), _ = registration.token.cancelled()=>Err(AppError::new("UNKNOWN_OUTCOME", "送信の確認を中断しました。GitLabで結果を確認してください。")) };
        if outcome
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
    if retry_at > now_ms() {
        let mut error = AppError::new(
            "RATE_LIMITED",
            "GitLabの要求制限が解除されるまでお待ちください。",
        );
        error.retry_after_ms = Some(retry_at - now_ms());
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
    #[ignore = "Explicit read-only GitLab.com authentication check with existing glab credentials"]
    async fn imported_glab_token_authenticates_gitlab_com() {
        let instance = normalize_instance("https://gitlab.com").unwrap();
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
}
