use crate::dto::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CACHE_BYTES: i64 = 128 * 1024 * 1024;
const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

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
    pub completeness: String,
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

    fn init(connection: Connection) -> Result<Self, AppError> {
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|_| storage_error())?;
        connection
            .execute_batch("PRAGMA secure_delete = ON; PRAGMA auto_vacuum = FULL; PRAGMA max_page_count = 65536;")
            .map_err(|_| storage_error())?;
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| storage_error())?;
        if version > 1 {
            return Err(AppError::new("STORAGE", "この保存データは新しいアプリで作成されています。新しいバージョンを使用してください。"));
        }
        connection.execute_batch("CREATE TABLE IF NOT EXISTS cache (account TEXT NOT NULL, key TEXT NOT NULL, snapshot TEXT NOT NULL, fetched INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;").map_err(|_| storage_error())?;
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
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_is_account_scoped_expires_and_clears() {
        let mut store = Store::init(Connection::open_in_memory().unwrap()).unwrap();
        let snapshot = Snapshot {
            data: serde_json::json!([{"id":"1"}]),
            fetched_at: now_ms(),
            source: "network".into(),
            next_page: Some(2),
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
}
