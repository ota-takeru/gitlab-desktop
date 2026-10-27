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
fn clearing_queries_keeps_the_answers_no_rule_selects() {
    let mut store = Store::init(Connection::open_in_memory().unwrap()).unwrap();
    let snapshot = Snapshot {
        data: serde_json::json!([]),
        fetched_at: now_ms(),
        source: "network".into(),
        next_page: None,
        total_pages: None,
        completeness: "complete".into(),
    };
    let discussions = r#"{"kind":"discussions","projectId":"1","iid":"2","page":1}"#;
    let other_mr = r#"{"kind":"discussions","projectId":"1","iid":"3","page":1}"#;
    let other_project = r#"{"kind":"discussions","projectId":"9","iid":"2","page":1}"#;
    let similar_kind = r#"{"kind":"discussionsOther","projectId":"1","iid":"2"}"#;
    let list = r#"{"kind":"mrs","search":"","state":"opened","page":1}"#;
    let pipeline = r#"{"kind":"pipeline","projectId":"5","pipelineId":"8"}"#;
    let other_pipeline = r#"{"kind":"pipeline","projectId":"5","pipelineId":"9"}"#;
    let not_json = "not json";
    for key in [
        discussions,
        other_mr,
        other_project,
        similar_kind,
        list,
        pipeline,
        other_pipeline,
        not_json,
    ] {
        store.put("a", key, &snapshot).unwrap();
    }
    store.put("b", discussions, &snapshot).unwrap();
    let rule =
        |kind, project_id: Option<&str>, iid: Option<&str>, pipeline_id: Option<&str>| CacheRule {
            kind,
            project_id: project_id.map(str::to_owned),
            iid: iid.map(str::to_owned),
            pipeline_id: pipeline_id.map(str::to_owned),
        };
    store
        .clear_account_queries(
            "a",
            &[
                rule("discussions", Some("1"), Some("2"), None),
                rule("mrs", None, None, None),
                rule("pipeline", Some("5"), None, Some("8")),
            ],
        )
        .unwrap();
    for removed in [discussions, list, pipeline] {
        assert!(store.get("a", removed).unwrap().is_none(), "{removed}");
    }
    for kept in [
        other_mr,
        other_project,
        similar_kind,
        other_pipeline,
        not_json,
    ] {
        assert!(store.get("a", kept).unwrap().is_some(), "{kept}");
    }
    assert!(store.get("b", discussions).unwrap().is_some());
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
