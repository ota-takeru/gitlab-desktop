use crate::dto::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CACHE_BYTES: i64 = 128 * 1024 * 1024;
const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const STORAGE_SCHEMA_VERSION: u32 = 2;
const MAX_LOCAL_DRAFTS: i64 = 100;
const MAX_LOCAL_DRAFT_KEY_BYTES: usize = 4096;
const MAX_LOCAL_DRAFT_BODY_BYTES: usize = 64 * 1024;
const MAX_PENDING_OPERATIONS: i64 = 100;
const MAX_PENDING_RESOURCE_BYTES: usize = 256;
const MAX_PENDING_ACTION_BYTES: usize = 256 * 1024;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn storage_error() -> AppError {
    AppError::new(
        "STORAGE",
        "ローカル保存に失敗しました。ディスクの空き容量とアクセス権を確認してください。",
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub data: Value,
    pub fetched_at: u64,
    pub source: String,
    pub next_page: Option<u32>,
    /// Total pages reported by GitLab; absent in snapshots cached before it was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_pages: Option<u32>,
    pub completeness: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDraft {
    pub body: String,
    pub updated_at: u64,
}

pub struct Store(Connection);

impl Store {
    #[cfg(test)]
    pub fn memory() -> Self {
        Self::init(Connection::open_in_memory().unwrap()).unwrap()
    }
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let connection = Connection::open(path).map_err(|_| storage_error())?;
        Self::init(connection)
    }

    fn init(mut connection: Connection) -> Result<Self, AppError> {
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|_| storage_error())?;
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| storage_error())?;
        if version > STORAGE_SCHEMA_VERSION {
            return Err(AppError::new("STORAGE", "この保存データは新しいアプリで作成されています。新しいバージョンを使用してください。"));
        }
        let quick_check: String = connection
            .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
            .map_err(|_| storage_error())?;
        if quick_check != "ok" {
            return Err(storage_error());
        }
        connection
            .execute_batch("PRAGMA secure_delete = ON; PRAGMA auto_vacuum = FULL; PRAGMA max_page_count = 65536;")
            .map_err(|_| storage_error())?;
        {
            let migration = connection.transaction().map_err(|_| storage_error())?;
            migration
                .execute_batch("CREATE TABLE IF NOT EXISTS cache (account TEXT NOT NULL, key TEXT NOT NULL, snapshot TEXT NOT NULL, fetched INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS local_drafts (account TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS pending_operations (account TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(account,resource)); PRAGMA user_version = 2;")
                .map_err(|_| storage_error())?;
            migration.commit().map_err(|_| storage_error())?;
        }
        let mut store = Self(connection);
        store.prune()?;
        Ok(store)
    }

    pub fn setting<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Result<Option<T>, AppError> {
        let text: Option<String> = self
            .0
            .query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| storage_error())?;
        text.map(|text| serde_json::from_str(&text).map_err(|_| storage_error()))
            .transpose()
    }

    pub fn set_setting<T: Serialize>(&mut self, key: &str, value: &T) -> Result<(), AppError> {
        let text = serde_json::to_string(value).map_err(|_| storage_error())?;
        self.0
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                params![key, text],
            )
            .map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn delete_setting(&mut self, key: &str) -> Result<(), AppError> {
        self.0
            .execute("DELETE FROM settings WHERE key=?", [key])
            .map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn get(&mut self, account: &str, key: &str) -> Result<Option<Snapshot>, AppError> {
        self.prune()?;
        let text: Option<String> = self
            .0
            .query_row(
                "SELECT snapshot FROM cache WHERE account=? AND key=?",
                params![account, key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| storage_error())?;
        text.map(|text| {
            let mut snapshot: Snapshot =
                serde_json::from_str(&text).map_err(|_| storage_error())?;
            snapshot.source = "cache".into();
            Ok(snapshot)
        })
        .transpose()
    }

    pub fn put(&mut self, account: &str, key: &str, snapshot: &Snapshot) -> Result<(), AppError> {
        let text = serde_json::to_string(snapshot).map_err(|_| storage_error())?;
        if text.len() > 8 * 1024 * 1024 {
            return Err(AppError::new(
                "TOO_LARGE",
                "保存するデータが上限を超えました。",
            ));
        }
        self.0
            .execute(
                "INSERT OR REPLACE INTO cache(account,key,snapshot,fetched,size) VALUES(?,?,?,?,?)",
                params![
                    account,
                    key,
                    text,
                    snapshot.fetched_at as i64,
                    (text.len() + key.len() + account.len() + 256) as i64
                ],
            )
            .map_err(|_| storage_error())?;
        self.prune()
    }

    fn prune(&mut self) -> Result<(), AppError> {
        self.0
            .execute(
                "DELETE FROM cache WHERE fetched < ?",
                [(now_ms() as i64).saturating_sub(RETENTION_MS)],
            )
            .map_err(|_| storage_error())?;
        loop {
            let size: i64 = self
                .0
                .query_row("SELECT COALESCE(SUM(size),0) FROM cache", [], |row| {
                    row.get(0)
                })
                .map_err(|_| storage_error())?;
            let count: i64 = self
                .0
                .query_row("SELECT COUNT(*) FROM cache", [], |row| row.get(0))
                .map_err(|_| storage_error())?;
            if size <= MAX_CACHE_BYTES && count <= 10_000 {
                break;
            }
            self.0.execute("DELETE FROM cache WHERE rowid IN (SELECT rowid FROM cache ORDER BY fetched LIMIT 1)", []).map_err(|_| storage_error())?;
        }
        Ok(())
    }

    pub fn clear_account(&mut self, account: &str) -> Result<(), AppError> {
        self.0
            .execute("DELETE FROM cache WHERE account=?", [account])
            .map_err(|_| storage_error())?;
        // secure_delete overwrites removed payloads; auto_vacuum reclaims pages
        // at commit without rebuilding the database on every review operation.
        Ok(())
    }

    pub fn draft(&self, account: &str, key: &str) -> Result<Option<LocalDraft>, AppError> {
        validate_draft_key(key)?;
        self.0
            .query_row(
                "SELECT body, updated FROM local_drafts WHERE account=? AND key=?",
                params![account, key],
                |row| {
                    Ok(LocalDraft {
                        body: row.get(0)?,
                        updated_at: row.get::<_, i64>(1)? as u64,
                    })
                },
            )
            .optional()
            .map_err(|_| storage_error())
    }

    pub fn save_draft(&mut self, account: &str, key: &str, body: &str) -> Result<(), AppError> {
        validate_draft_key(key)?;
        if body.len() > MAX_LOCAL_DRAFT_BODY_BYTES {
            return Err(AppError::new(
                "TOO_LARGE",
                "未送信コメントが上限を超えました。",
            ));
        }
        if body.is_empty() {
            self.0
                .execute(
                    "DELETE FROM local_drafts WHERE account=? AND key=?",
                    params![account, key],
                )
                .map_err(|_| storage_error())?;
            return Ok(());
        }

        let exists: bool = self
            .0
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM local_drafts WHERE account=? AND key=?)",
                params![account, key],
                |row| row.get(0),
            )
            .map_err(|_| storage_error())?;
        if !exists {
            let count: i64 = self
                .0
                .query_row(
                    "SELECT COUNT(*) FROM local_drafts WHERE account=? AND length(body)>0",
                    [account],
                    |row| row.get(0),
                )
                .map_err(|_| storage_error())?;
            if count >= MAX_LOCAL_DRAFTS {
                return Err(AppError::new(
                    "TOO_LARGE",
                    "未送信コメントの保存件数が上限に達しました。不要な下書きを削除してください。",
                ));
            }
        }
        self.0
            .execute(
                "INSERT INTO local_drafts(account,key,body,updated) VALUES(?,?,?,?) ON CONFLICT(account,key) DO UPDATE SET body=excluded.body, updated=excluded.updated",
                params![account, key, body, now_ms() as i64],
            )
            .map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn clear_drafts(&mut self, account: &str) -> Result<(), AppError> {
        self.0
            .execute("DELETE FROM local_drafts WHERE account=?", [account])
            .map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn pending_operation(
        &self,
        account: &str,
        resource: &str,
    ) -> Result<Option<Value>, AppError> {
        validate_pending_resource(resource)?;
        let action: Option<String> = self
            .0
            .query_row(
                "SELECT action FROM pending_operations WHERE account=? AND resource=?",
                params![account, resource],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| storage_error())?;
        action
            .map(|text| serde_json::from_str(&text).map_err(|_| storage_error()))
            .transpose()
    }

    pub fn begin_operation(
        &mut self,
        account: &str,
        resource: &str,
        action: &Value,
    ) -> Result<(), AppError> {
        validate_pending_resource(resource)?;
        let text = serde_json::to_string(action).map_err(|_| storage_error())?;
        if text.len() > MAX_PENDING_ACTION_BYTES {
            return Err(AppError::new("TOO_LARGE", "送信記録が上限を超えました。"));
        }
        let transaction = self.0.transaction().map_err(|_| storage_error())?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pending_operations WHERE account=? AND resource=?)",
                params![account, resource],
                |row| row.get(0),
            )
            .map_err(|_| storage_error())?;
        if exists {
            return Err(AppError::new(
                "UNKNOWN_OUTCOME",
                "同じ操作の結果を確認できるまで再送できません。",
            ));
        }
        let count: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM pending_operations WHERE account=?",
                [account],
                |row| row.get(0),
            )
            .map_err(|_| storage_error())?;
        if count >= MAX_PENDING_OPERATIONS {
            return Err(AppError::new(
                "TOO_LARGE",
                "送信記録の保存件数が上限に達しました。結果を確認してから整理してください。",
            ));
        }
        transaction
            .execute(
                "INSERT INTO pending_operations(account,resource,action,updated) VALUES(?,?,?,?)",
                params![account, resource, text, now_ms() as i64],
            )
            .map_err(|_| storage_error())?;
        transaction.commit().map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn finish_operation(&mut self, account: &str, resource: &str) -> Result<(), AppError> {
        validate_pending_resource(resource)?;
        self.0
            .execute(
                "DELETE FROM pending_operations WHERE account=? AND resource=?",
                params![account, resource],
            )
            .map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn complete_operation(
        &mut self,
        account: &str,
        resource: &str,
        receipt_id: &str,
        submitted_draft: Option<(&str, &str)>,
    ) -> Result<(), AppError> {
        validate_pending_resource(resource)?;
        if let Some((key, _)) = submitted_draft {
            validate_draft_key(key)?;
        }

        let transaction = self.0.transaction().map_err(|_| storage_error())?;
        let receipt: Option<String> = transaction
            .query_row(
                "SELECT action FROM pending_operations WHERE account=? AND resource=?",
                params![account, resource],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| storage_error())?;
        let receipt: Value = receipt
            .as_deref()
            .ok_or_else(storage_error)
            .and_then(|text| serde_json::from_str(text).map_err(|_| storage_error()))?;
        if receipt["id"].as_str() != Some(receipt_id) {
            return Err(storage_error());
        }

        if let Some((key, submitted_body)) = submitted_draft {
            let current_body: Option<String> = transaction
                .query_row(
                    "SELECT body FROM local_drafts WHERE account=? AND key=?",
                    params![account, key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| storage_error())?;
            if current_body
                .as_deref()
                .is_some_and(|body| body.trim() == submitted_body)
            {
                transaction
                    .execute(
                        "DELETE FROM local_drafts WHERE account=? AND key=?",
                        params![account, key],
                    )
                    .map_err(|_| storage_error())?;
            }
        }

        let removed = transaction
            .execute(
                "DELETE FROM pending_operations WHERE account=? AND resource=?",
                params![account, resource],
            )
            .map_err(|_| storage_error())?;
        if removed != 1 {
            return Err(storage_error());
        }
        transaction.commit().map_err(|_| storage_error())?;
        Ok(())
    }

    pub fn clear_private_account(&mut self, account: &str) -> Result<(), AppError> {
        let transaction = self.0.transaction().map_err(|_| storage_error())?;
        transaction
            .execute("DELETE FROM cache WHERE account=?", [account])
            .map_err(|_| storage_error())?;
        transaction
            .execute("DELETE FROM local_drafts WHERE account=?", [account])
            .map_err(|_| storage_error())?;
        transaction
            .execute("DELETE FROM pending_operations WHERE account=?", [account])
            .map_err(|_| storage_error())?;
        transaction.commit().map_err(|_| storage_error())?;
        Ok(())
    }
}

fn validate_draft_key(key: &str) -> Result<(), AppError> {
    if key.is_empty() || key.len() > MAX_LOCAL_DRAFT_KEY_BYTES || key.contains('\0') {
        return Err(AppError::new(
            "INVALID_INPUT",
            "下書きの識別子が空、長すぎる、または不正です。",
        ));
    }
    Ok(())
}

fn validate_pending_resource(resource: &str) -> Result<(), AppError> {
    if resource.is_empty() || resource.len() > MAX_PENDING_RESOURCE_BYTES || resource.contains('\0')
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "送信記録の識別子が空、長すぎる、または不正です。",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temporary_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "gitlab-desktop-storage-{label}-{}-{}.sqlite3",
            std::process::id(),
            now_ms()
        ))
    }
    #[test]
    fn cache_is_account_scoped_expires_and_clears() {
        let mut store = Store::init(Connection::open_in_memory().unwrap()).unwrap();
        let snapshot = Snapshot {
            data: serde_json::json!([{"id":"1"}]),
            fetched_at: now_ms(),
            source: "network".into(),
            next_page: Some(2),
            total_pages: None,
            completeness: "page".into(),
        };
        store.put("a", "query", &snapshot).unwrap();
        assert!(store.get("b", "query").unwrap().is_none());
        assert_eq!(store.get("a", "query").unwrap().unwrap().source, "cache");
        let mut expired = snapshot.clone();
        expired.fetched_at = 1;
        store.put("a", "old", &expired).unwrap();
        assert!(store.get("a", "old").unwrap().is_none());
        store.clear_account("a").unwrap();
        assert!(store.get("a", "query").unwrap().is_none());
    }
    #[test]
    fn refuses_future_schema_without_overwriting_it() {
        let connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 99).unwrap();
        assert!(Store::init(connection).is_err());
    }

    #[test]
    fn cache_budget_evicts_oldest_entry() {
        let mut store = Store::memory();
        let snapshot = Snapshot {
            data: serde_json::json!([]),
            fetched_at: now_ms(),
            source: "network".into(),
            next_page: None,
            total_pages: None,
            completeness: "complete".into(),
        };
        store.put("a", "old", &snapshot).unwrap();
        store
            .0
            .execute(
                "UPDATE cache SET size=?, fetched=fetched-1 WHERE key='old'",
                [MAX_CACHE_BYTES],
            )
            .unwrap();
        store.put("a", "new", &snapshot).unwrap();
        assert!(store.get("a", "old").unwrap().is_none());
        assert!(store.get("a", "new").unwrap().is_some());
    }

    #[test]
    fn local_draft_survives_reopen_and_stays_account_scoped() {
        let path = temporary_path("reopen");
        {
            let mut store = Store::open(&path).unwrap();
            store
                .save_draft("account-a", "mr:1:comment", "本文")
                .unwrap();
            store
                .save_draft("account-b", "mr:1:comment", "別アカウント")
                .unwrap();
            let draft = store.draft("account-a", "mr:1:comment").unwrap().unwrap();
            assert_eq!(draft.body, "本文");
            assert!(serde_json::to_value(&draft)
                .unwrap()
                .get("updatedAt")
                .is_some());
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store
                    .draft("account-a", "mr:1:comment")
                    .unwrap()
                    .unwrap()
                    .body,
                "本文"
            );
            assert_eq!(
                store
                    .draft("account-b", "mr:1:comment")
                    .unwrap()
                    .unwrap()
                    .body,
                "別アカウント"
            );
            assert!(store.draft("account-a", "mr:1:other").unwrap().is_none());
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn cache_clear_and_prune_do_not_delete_local_drafts() {
        let mut store = Store::memory();
        let snapshot = Snapshot {
            data: serde_json::json!({"id":"cached"}),
            fetched_at: now_ms(),
            source: "network".into(),
            next_page: None,
            total_pages: None,
            completeness: "complete".into(),
        };
        store.put("account-a", "query", &snapshot).unwrap();
        store
            .save_draft("account-a", "composer", "保持する")
            .unwrap();
        store
            .begin_operation(
                "account-a",
                "resource-1",
                &serde_json::json!({"body":"保持する"}),
            )
            .unwrap();
        store.clear_account("account-a").unwrap();
        assert!(store.get("account-a", "query").unwrap().is_none());
        assert_eq!(
            store.draft("account-a", "composer").unwrap().unwrap().body,
            "保持する"
        );
        assert!(store
            .pending_operation("account-a", "resource-1")
            .unwrap()
            .is_some());

        store.put("account-a", "query", &snapshot).unwrap();
        store.clear_private_account("account-a").unwrap();
        assert!(store.get("account-a", "query").unwrap().is_none());
        assert!(store.draft("account-a", "composer").unwrap().is_none());
        assert!(store
            .pending_operation("account-a", "resource-1")
            .unwrap()
            .is_none());
    }

    #[test]
    fn migration_from_schema_one_preserves_existing_rows_and_sets_schema_two() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE cache (account TEXT NOT NULL, key TEXT NOT NULL, snapshot TEXT NOT NULL, fetched INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO settings(key,value) VALUES('theme','\"dark\"'); PRAGMA user_version=1;")
            .unwrap();
        let existing_snapshot = Snapshot {
            data: serde_json::json!({"id":"legacy"}),
            fetched_at: now_ms(),
            source: "network".into(),
            next_page: None,
            total_pages: None,
            completeness: "complete".into(),
        };
        let existing_json = serde_json::to_string(&existing_snapshot).unwrap();
        connection
            .execute(
                "INSERT INTO cache(account,key,snapshot,fetched,size) VALUES(?,?,?,?,?)",
                params![
                    "account-a",
                    "legacy",
                    existing_json,
                    existing_snapshot.fetched_at as i64,
                    256_i64
                ],
            )
            .unwrap();
        let mut store = Store::init(connection).unwrap();
        assert_eq!(
            store.setting::<String>("theme").unwrap().as_deref(),
            Some("dark")
        );
        assert_eq!(
            store.get("account-a", "legacy").unwrap().unwrap().data["id"],
            "legacy"
        );
        assert_eq!(
            store
                .0
                .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            STORAGE_SCHEMA_VERSION
        );
        store
            .save_draft("account-a", "composer", "migration")
            .unwrap();
        assert_eq!(
            store.draft("account-a", "composer").unwrap().unwrap().body,
            "migration"
        );
    }

    #[test]
    fn future_schema_is_rejected_without_changing_disk_bytes() {
        let path = temporary_path("future");
        {
            let connection = Connection::open(&path).unwrap();
            connection.pragma_update(None, "user_version", 99).unwrap();
        }
        let before = fs::read(&path).unwrap();
        assert!(Store::open(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn local_draft_validates_bytes_and_empty_body_deletes_only_exact_empty() {
        let mut store = Store::memory();
        let body_64k = "あ".repeat(21_845); // 65,535 UTF-8 bytes
        store.save_draft("a", "k", &body_64k).unwrap();
        assert_eq!(store.draft("a", "k").unwrap().unwrap().body.len(), 65_535);
        let too_large = format!("{body_64k}xx");
        assert_eq!(
            store
                .save_draft("a", "too-large", &too_large)
                .unwrap_err()
                .code,
            "TOO_LARGE"
        );
        assert_eq!(
            store.save_draft("a", "", "body").unwrap_err().code,
            "INVALID_INPUT"
        );
        assert_eq!(
            store
                .save_draft("a", &"k".repeat(MAX_LOCAL_DRAFT_KEY_BYTES + 1), "body")
                .unwrap_err()
                .code,
            "INVALID_INPUT"
        );
        assert_eq!(
            store.save_draft("a", "bad\0key", "body").unwrap_err().code,
            "INVALID_INPUT"
        );
        store.save_draft("a", "spaces", "   ").unwrap();
        store.save_draft("a", "spaces", "").unwrap();
        assert!(store.draft("a", "spaces").unwrap().is_none());
    }

    #[test]
    fn local_draft_cap_allows_updates_and_reuse_after_empty_delete() {
        let mut store = Store::memory();
        for index in 0..MAX_LOCAL_DRAFTS {
            store
                .save_draft("a", &format!("key-{index}"), "body")
                .unwrap();
        }
        assert_eq!(
            store.save_draft("a", "key-100", "body").unwrap_err().code,
            "TOO_LARGE"
        );
        store.save_draft("a", "key-0", "updated").unwrap();
        assert_eq!(store.draft("a", "key-0").unwrap().unwrap().body, "updated");
        store.save_draft("a", "key-0", "").unwrap();
        store.save_draft("a", "key-100", "body").unwrap();
        assert_eq!(store.draft("a", "key-100").unwrap().unwrap().body, "body");
    }

    #[test]
    fn pending_receipt_survives_reopen_is_account_scoped_and_rejects_duplicate_begin() {
        let path = temporary_path("pending");
        let action = serde_json::json!({"kind":"comment","body":"未送信"});
        {
            let mut store = Store::open(&path).unwrap();
            store
                .begin_operation("account-a", "mr:1:comment", &action)
                .unwrap();
            assert_eq!(
                store
                    .pending_operation("account-a", "mr:1:comment")
                    .unwrap(),
                Some(action.clone())
            );
            assert!(store
                .pending_operation("account-b", "mr:1:comment")
                .unwrap()
                .is_none());
            assert_eq!(
                store
                    .begin_operation("account-a", "mr:1:comment", &action)
                    .unwrap_err()
                    .code,
                "UNKNOWN_OUTCOME"
            );
        }
        {
            let mut store = Store::open(&path).unwrap();
            assert_eq!(
                store
                    .pending_operation("account-a", "mr:1:comment")
                    .unwrap(),
                Some(action)
            );
            store.finish_operation("account-a", "mr:1:comment").unwrap();
            assert!(store
                .pending_operation("account-a", "mr:1:comment")
                .unwrap()
                .is_none());
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn completing_exact_receipt_atomically_removes_only_unchanged_submitted_draft() {
        let mut store = Store::memory();
        let first = serde_json::json!({
            "id": "11111111-1111-4111-8111-111111111111",
            "action": {"kind":"comment","body":"submitted"},
            "startedAt": 1
        });
        store
            .save_draft("account", "composer", "  submitted\n")
            .unwrap();
        store.begin_operation("account", "7:1", &first).unwrap();

        assert!(store
            .complete_operation(
                "account",
                "7:1",
                "22222222-2222-4222-8222-222222222222",
                Some(("composer", "submitted")),
            )
            .is_err());
        assert!(store.pending_operation("account", "7:1").unwrap().is_some());
        assert!(store.draft("account", "composer").unwrap().is_some());

        store
            .save_draft("account", "composer", "later edit")
            .unwrap();
        store
            .complete_operation(
                "account",
                "7:1",
                "11111111-1111-4111-8111-111111111111",
                Some(("composer", "submitted")),
            )
            .unwrap();
        assert!(store.pending_operation("account", "7:1").unwrap().is_none());
        assert_eq!(
            store.draft("account", "composer").unwrap().unwrap().body,
            "later edit"
        );

        let second = serde_json::json!({
            "id": "33333333-3333-4333-8333-333333333333",
            "action": {"kind":"comment","body":"later edit"},
            "startedAt": 2
        });
        store.begin_operation("account", "7:1", &second).unwrap();
        store
            .complete_operation(
                "account",
                "7:1",
                "33333333-3333-4333-8333-333333333333",
                Some(("composer", "later edit")),
            )
            .unwrap();
        assert!(store.pending_operation("account", "7:1").unwrap().is_none());
        assert!(store.draft("account", "composer").unwrap().is_none());

        store
            .save_draft("account", "composer", "retry after known failure")
            .unwrap();
        let third = serde_json::json!({
            "id": "44444444-4444-4444-8444-444444444444",
            "action": {"kind":"comment","body":"retry after known failure"},
            "startedAt": 3
        });
        store.begin_operation("account", "7:1", &third).unwrap();
        store
            .complete_operation(
                "account",
                "7:1",
                "44444444-4444-4444-8444-444444444444",
                None,
            )
            .unwrap();
        assert!(store.pending_operation("account", "7:1").unwrap().is_none());
        assert_eq!(
            store.draft("account", "composer").unwrap().unwrap().body,
            "retry after known failure"
        );
    }

    #[test]
    fn pending_receipt_validates_resource_and_action_bytes_and_caps_without_eviction() {
        let mut store = Store::memory();
        let action = serde_json::json!({"kind":"comment"});
        assert_eq!(
            store.begin_operation("a", "", &action).unwrap_err().code,
            "INVALID_INPUT"
        );
        assert_eq!(
            store
                .begin_operation("a", &"r".repeat(MAX_PENDING_RESOURCE_BYTES + 1), &action)
                .unwrap_err()
                .code,
            "INVALID_INPUT"
        );
        let oversized_action = serde_json::json!({"body": "x".repeat(MAX_PENDING_ACTION_BYTES)});
        assert_eq!(
            store
                .begin_operation("a", "large", &oversized_action)
                .unwrap_err()
                .code,
            "TOO_LARGE"
        );
        for index in 0..MAX_PENDING_OPERATIONS {
            store
                .begin_operation("a", &format!("resource-{index}"), &action)
                .unwrap();
        }
        assert_eq!(
            store
                .begin_operation("a", "resource-100", &action)
                .unwrap_err()
                .code,
            "TOO_LARGE"
        );
        assert!(store
            .pending_operation("a", "resource-0")
            .unwrap()
            .is_some());
        store.finish_operation("a", "resource-0").unwrap();
        store.begin_operation("a", "resource-100", &action).unwrap();
        assert!(store
            .pending_operation("a", "resource-100")
            .unwrap()
            .is_some());
    }
}
