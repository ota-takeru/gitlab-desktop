use crate::dto::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CACHE_BYTES: i64 = 128 * 1024 * 1024;
const MAX_CACHE_ENTRIES: i64 = 10_000;
const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const STORAGE_SCHEMA_VERSION: u32 = 2;
const MAX_LOCAL_DRAFTS: i64 = 100;
const MAX_LOCAL_DRAFT_KEY_BYTES: usize = 4096;
const MAX_LOCAL_DRAFT_BODY_BYTES: usize = 64 * 1024;
const MAX_PENDING_OPERATIONS: i64 = 100;
const MAX_PENDING_RESOURCE_BYTES: usize = 256;
const MAX_PENDING_ACTION_BYTES: usize = 256 * 1024;

/// Cached snapshots fetched before this time are expired.
fn retention_cutoff() -> i64 {
    (now_ms() as i64).saturating_sub(RETENTION_MS)
}

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
    .key("native.storage.failed")
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

/// Saved query answers of one kind to remove, optionally only those of one
/// project, merge request or pipeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheRule {
    pub kind: &'static str,
    pub project_id: Option<String>,
    pub iid: Option<String>,
    pub pipeline_id: Option<String>,
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
            return Err(AppError::new("STORAGE", "この保存データは新しいアプリで作成されています。新しいバージョンを使用してください。").key("native.storage.newerVersion"));
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
                .execute_batch("CREATE TABLE IF NOT EXISTS cache (account TEXT NOT NULL, key TEXT NOT NULL, snapshot TEXT NOT NULL, fetched INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS local_drafts (account TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS pending_operations (account TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(account,resource)); CREATE INDEX IF NOT EXISTS cache_fetched_size ON cache(fetched, size); PRAGMA user_version = 2;")
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
        // Expired rows are skipped here and deleted by the next write, so a read
        // does not have to scan the whole cache.
        let text: Option<String> = self
            .0
            .query_row(
                "SELECT snapshot FROM cache WHERE account=? AND key=? AND fetched >= ?",
                params![account, key, retention_cutoff()],
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
            return Err(
                AppError::new("TOO_LARGE", "保存するデータが上限を超えました。")
                    .key("native.storage.tooLarge"),
            );
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
        // Every query here is answered from the (fetched, size) index; reading
        // the table itself would walk every cached payload.
        self.0
            .execute("DELETE FROM cache WHERE fetched < ?", [retention_cutoff()])
            .map_err(|_| storage_error())?;
        let (size, count): (i64, i64) = self
            .0
            .query_row(
                "SELECT COALESCE(SUM(size),0), COUNT(*) FROM cache",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| storage_error())?;
        let mut excess_size = size - MAX_CACHE_BYTES;
        let mut excess_count = count - MAX_CACHE_ENTRIES;
        if excess_size <= 0 && excess_count <= 0 {
            return Ok(());
        }
        let mut oldest = Vec::new();
        {
            let mut statement = self
                .0
                .prepare("SELECT rowid, size FROM cache ORDER BY fetched")
                .map_err(|_| storage_error())?;
            let mut rows = statement.query([]).map_err(|_| storage_error())?;
            while excess_size > 0 || excess_count > 0 {
                let Some(row) = rows.next().map_err(|_| storage_error())? else {
                    break;
                };
                oldest.push(row.get::<_, i64>(0).map_err(|_| storage_error())?);
                excess_size -= row.get::<_, i64>(1).map_err(|_| storage_error())?;
                excess_count -= 1;
            }
        }
        let eviction = self.0.transaction().map_err(|_| storage_error())?;
        for rowid in oldest {
            eviction
                .execute("DELETE FROM cache WHERE rowid=?", [rowid])
                .map_err(|_| storage_error())?;
        }
        eviction.commit().map_err(|_| storage_error())
    }

    pub fn clear_account(&mut self, account: &str) -> Result<(), AppError> {
        self.0
            .execute("DELETE FROM cache WHERE account=?", [account])
            .map_err(|_| storage_error())?;
        // secure_delete overwrites removed payloads; auto_vacuum reclaims pages
        // at commit without rebuilding the database on every review operation.
        Ok(())
    }

    /// Removes the account's saved answers that `rules` select. Keys are the
    /// query JSON, so a rule matches its kind and, when given, its project,
    /// merge request or pipeline.
    pub fn clear_account_queries(
        &mut self,
        account: &str,
        rules: &[CacheRule],
    ) -> Result<(), AppError> {
        let transaction = self.0.transaction().map_err(|_| storage_error())?;
        for rule in rules {
            transaction
                .execute(
                    "DELETE FROM cache WHERE account=?1 AND json_valid(key) \
                     AND json_extract(key,'$.kind')=?2 \
                     AND (?3 IS NULL OR json_extract(key,'$.projectId')=?3) \
                     AND (?4 IS NULL OR json_extract(key,'$.iid')=?4) \
                     AND (?5 IS NULL OR json_extract(key,'$.pipelineId')=?5)",
                    params![
                        account,
                        rule.kind,
                        rule.project_id,
                        rule.iid,
                        rule.pipeline_id
                    ],
                )
                .map_err(|_| storage_error())?;
        }
        transaction.commit().map_err(|_| storage_error())
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
            return Err(
                AppError::new("TOO_LARGE", "未送信コメントが上限を超えました。")
                    .key("native.draft.tooLarge"),
            );
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
                )
                .key("native.draft.tooMany"));
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
            return Err(AppError::new("TOO_LARGE", "送信記録が上限を超えました。")
                .key("native.receipt.tooLarge"));
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
            )
            .key("native.receipt.pending"));
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
            )
            .key("native.receipt.tooMany"));
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
        )
        .key("native.draft.invalidKey"));
    }
    Ok(())
}

fn validate_pending_resource(resource: &str) -> Result<(), AppError> {
    if resource.is_empty() || resource.len() > MAX_PENDING_RESOURCE_BYTES || resource.contains('\0')
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "送信記録の識別子が空、長すぎる、または不正です。",
        )
        .key("native.receipt.invalidKey"));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
