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
    let (api, started, release, server) = spawn_http_response("500 Internal Server Error", "{}");
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
    let (api, started, release, server) = spawn_http_response("500 Internal Server Error", "{}");
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
        background: false,
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
    let (state, session) = test_state(Url::parse(&format!("http://{address}/api/v4/")).unwrap());
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
    let key = serde_json::to_string(&projects_input(&session, ReadMode::CacheOnly).query).unwrap();
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
        background: false,
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
        background: false,
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
    // Saved caches and drafts are filed under this key, so its form must not change.
    assert_eq!(
        account_key("https://gitlab.example/", "42"),
        "89a5a67281df6baef3e205921436358caa12c763ec447fa4b0e18a05ae03a763"
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
    assert!(instance_avatar_url(instance, "https://secure.gravatar.com/avatar/abc?s=80").is_none());
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
fn svg_images_are_recognised_from_their_text() {
    assert_eq!(
        sniff_image_type(br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#),
        Some("image/svg+xml")
    );
    assert_eq!(
        sniff_image_type("\u{feff}<?xml version=\"1.0\"?>\n<!-- logo -->\n<svg></svg>".as_bytes()),
        Some("image/svg+xml")
    );
    assert_eq!(
        sniff_image_type(b"<html><body><svg></svg></body></html>"),
        None
    );
    assert_eq!(sniff_image_type(b"plain text"), None);
}

#[test]
fn markdown_images_only_allow_same_instance_uploads() {
    let base = "https://gitlab.example/GitLab/";
    assert!(instance_markdown_image_url(
        base,
        "https://gitlab.example/GitLab/group/repo/uploads/ab/photo.png"
    )
    .is_some());
    assert!(
        instance_markdown_image_url(base, "https://gitlab.example/GitLab/uploads/a.png").is_some()
    );
    assert!(instance_markdown_image_url(base, "https://gitlab.example/GitLab/api/v4/projects/42/repository/files/docs%2Fimg%20a.png/raw?ref=main").is_some());
    for bad in [
        "https://gitlab.example/GitLab/api/v4/projects/42/repository/files/docs%2Fimg.png/raw",
        "https://gitlab.example/GitLab/api/v4/projects/42/repository/files/docs/img.png/raw?ref=main",
        "https://gitlab.example/GitLab/api/v4/projects/42/repository/files/%2e%2e/raw?ref=main",
        "https://gitlab.example/GitLab/api/v4/projects/42/repository/files/a.png/raw?ref=main&x=1",
        "https://gitlab.example/GitLab/api/v4/projects/group%2Frepo/repository/files/a.png/raw?ref=main",
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
fn project_uploads_are_read_through_the_api() {
    let base = "https://gitlab.example/GitLab/";
    let api = |input: &str| {
        project_upload_api_url(base, &Url::parse(input).unwrap()).map(|url| url.to_string())
    };
    assert_eq!(
        api("https://gitlab.example/GitLab/group/sub/repo/uploads/0123abcd/photo%20a.png").as_deref(),
        Some("https://gitlab.example/GitLab/api/v4/projects/group%2Fsub%2Frepo/uploads/0123abcd/photo%20a.png")
    );
    assert_eq!(
        api("https://gitlab.example/GitLab/-/project/42/uploads/0123abcd/photo.png").as_deref(),
        Some("https://gitlab.example/GitLab/api/v4/projects/42/uploads/0123abcd/photo.png")
    );
    for kept in [
        "https://gitlab.example/GitLab/uploads/-/system/user/avatar/1/a.png",
        "https://gitlab.example/GitLab/repo/uploads/0123abcd/photo.png",
        "https://gitlab.example/GitLab/group/repo/uploads/0123abcd/photo.png?x=1",
        "https://gitlab.example/GitLab/-/project/x/uploads/0123abcd/photo.png",
    ] {
        assert_eq!(api(kept), None, "{kept}");
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
