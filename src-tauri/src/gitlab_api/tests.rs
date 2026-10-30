use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

const HEAD_SHA: &str = "0123456789abcdef0123456789abcdef01234567";

struct Fixture {
    address: String,
    requests: Arc<Mutex<Vec<String>>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Fixture {
    fn new(responses: Vec<String>) -> Self {
        Self::new_at_path(responses, "/api/v4/")
    }

    fn new_at_path(responses: Vec<String>, path: &str) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = format!("http://{}{path}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        // Each response closes its connection (see `response`), so every
        // request arrives on a new connection. A test that sends fewer
        // requests than expected must fail instead of blocking `Drop`.
        listener.set_nonblocking(true).unwrap();
        let thread = thread::spawn(move || {
            for response in responses {
                let Some(mut stream) = accept_within(&listener, FIXTURE_WAIT) else {
                    return;
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(FIXTURE_WAIT)).unwrap();
                let request = read_request(&mut stream);
                captured.lock().unwrap().push(request);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        Self {
            address,
            requests,
            thread: Some(thread),
        }
    }

    /// Answers each request with the first unused response whose needle its
    /// request line contains, for reads sent side by side in any order.
    fn routed(routes: Vec<(&str, String)>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = format!("http://{}/api/v4/", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let mut routes: Vec<(String, Option<String>)> = routes
            .into_iter()
            .map(|(needle, answer)| (needle.to_owned(), Some(answer)))
            .collect();
        listener.set_nonblocking(true).unwrap();
        let thread = thread::spawn(move || {
            for _ in 0..routes.len() {
                let Some(mut stream) = accept_within(&listener, FIXTURE_WAIT) else {
                    return;
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(FIXTURE_WAIT)).unwrap();
                let request = read_request(&mut stream);
                let line = request.lines().next().unwrap_or_default().to_owned();
                captured.lock().unwrap().push(request);
                let answer = routes
                    .iter_mut()
                    .find(|(needle, answer)| answer.is_some() && line.contains(needle.as_str()))
                    .and_then(|(_, answer)| answer.take())
                    .unwrap_or_else(|| response("500 Internal Server Error", "{}", ""));
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        Self {
            address,
            requests,
            thread: Some(thread),
        }
    }

    fn url(&self) -> Url {
        Url::parse(&self.address).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

const FIXTURE_WAIT: Duration = Duration::from_secs(10);

fn accept_within(listener: &TcpListener, wait: Duration) -> Option<TcpStream> {
    let deadline = std::time::Instant::now() + wait;
    loop {
        match listener.accept() {
            Ok((stream, _)) => return Some(stream),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return None;
                }
                thread::sleep(Duration::from_millis(5));
            }
            Err(_) => return None,
        }
    }
}

fn read_request(stream: &mut TcpStream) -> String {
    let mut buffer = [0_u8; 8192];
    let length = stream.read(&mut buffer).unwrap_or(0);
    String::from_utf8_lossy(&buffer[..length]).to_string()
}

fn response(status: &str, body: &str, headers: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n{headers}\r\n{}",
        body.len(),
        body
    )
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn normalizes_ids_and_pagination() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":7,"name":"Demo","path_with_namespace":"group/demo","description":null,"web_url":"https://gitlab.example/group/demo","archived":false,"last_activity_at":"2026-10-01T09:00:00.000Z"},{"id":8,"name":"Quiet","path_with_namespace":"group/quiet","web_url":"https://gitlab.example/group/quiet","archived":false}]"#,
        "X-Next-Page: 2\r\n",
    )]);
    let client = Client::builder().build().unwrap();
    let result = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::Projects {
                search: String::new(),
                membership: true,
                include_archived: false,
                page: 1,
            },
        ))
        .unwrap();
    assert_eq!(result.next_page, Some(2));
    assert_eq!(result.data[0]["id"], "7");
    assert_eq!(result.data[0]["description"], "");
    assert_eq!(result.data[0]["lastActivityAt"], "2026-10-01T09:00:00.000Z");
    assert!(result.data[1].get("lastActivityAt").is_none());
    let request = &fixture.requests.lock().unwrap()[0];
    assert!(request.contains("/api/v4/projects?"));
    assert!(request.contains("order_by=last_activity_at") && request.contains("sort=desc"));
    assert!(!request.contains("search_namespaces"));
}

#[test]
fn user_lookup_uses_exact_username_and_returns_only_an_exact_match() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":1,"username":"alice2","name":"Alice Two"},{"id":2,"username":"alice","name":"Alice"}]"#,
        "",
    )]);
    let client = Client::builder().build().unwrap();
    let result = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::User {
                username: "Alice".to_owned(),
            },
        ))
        .unwrap();
    assert_eq!(result.data["id"], "2");
    assert_eq!(result.data["username"], "alice");
    assert_eq!(result.next_page, None);
    let request = &fixture.requests.lock().unwrap()[0];
    assert!(request.starts_with("GET /api/v4/users?username=Alice "));
    assert!(!request.contains("search="));
    assert!(!request.contains("active="));
}

#[test]
fn user_lookup_returns_null_for_no_match_and_rejects_duplicate_exact_matches() {
    let no_match = Fixture::new(vec![response("200 OK", "[]", "")]);
    let client = Client::builder().build().unwrap();
    let missing = runtime()
        .block_on(fetch(
            &client,
            &no_match.url(),
            &Query::User {
                username: "alice".to_owned(),
            },
        ))
        .unwrap();
    assert!(missing.data.is_null());

    let duplicate = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":1,"username":"alice","name":"Alice"},{"id":2,"username":"ALICE","name":"Alice 2"}]"#,
        "",
    )]);
    let error = runtime()
        .block_on(fetch(
            &client,
            &duplicate.url(),
            &Query::User {
                username: "alice".to_owned(),
            },
        ))
        .unwrap_err();
    assert_eq!(error.code, "UNSUPPORTED");
}

#[test]
fn user_projects_are_personal_simple_projects_with_search_and_pagination() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":7,"name":"Demo","path_with_namespace":"alice/demo","description":null,"web_url":"https://gitlab.example/alice/demo","archived":false,"last_activity_at":"2026-10-01T09:00:00.000Z"}]"#,
        "X-Next-Page: 2\r\n",
    )]);
    let client = Client::builder().build().unwrap();
    let result = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::UserProjects {
                user_id: "42".to_owned(),
                search: "demo".to_owned(),
                include_archived: false,
                page: 1,
            },
        ))
        .unwrap();
    assert_eq!(result.next_page, Some(2));
    assert_eq!(result.data[0]["id"], "7");
    assert_eq!(result.data[0]["description"], "");
    assert_eq!(result.data[0]["lastActivityAt"], "2026-10-01T09:00:00.000Z");
    let request = &fixture.requests.lock().unwrap()[0];
    assert!(request.starts_with("GET /api/v4/users/42/projects?"));
    assert!(request.contains("order_by=last_activity_at"));
    assert!(request.contains("sort=desc"));
    assert!(request.contains("simple=true"));
    assert!(request.contains("search=demo"));
    assert!(request.contains("archived=false"));
    assert!(request.contains("page=1"));
    assert!(request.contains("per_page=30"));
    assert!(!request.contains("membership="));
}

#[test]
fn user_by_id_uses_the_numeric_users_endpoint_and_normalizes_the_response() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":42,"username":"alice","name":"Alice","avatar_url":"https://gitlab.example/avatar.png"}"#,
        "",
    )]);
    let client = Client::builder().build().unwrap();
    let user = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::UserById {
                user_id: "42".to_owned(),
            },
        ))
        .unwrap();
    assert_eq!(user.data["id"], "42");
    assert_eq!(user.data["username"], "alice");
    assert_eq!(user.data["avatarUrl"], "https://gitlab.example/avatar.png");
    assert!(fixture.requests.lock().unwrap()[0].starts_with("GET /api/v4/users/42 HTTP/1.1"));
}

#[test]
fn user_and_user_projects_queries_validate_identifiers_and_build_expected_urls() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let (user_url, _) = build_query_url(
        &api,
        &Query::User {
            username: "alice".to_owned(),
        },
    )
    .unwrap();
    let user_params = user_url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(user_url.path(), "/api/v4/users");
    assert_eq!(user_params.get("username").unwrap(), "alice");
    assert_eq!(user_params.len(), 1);
    for username in [
        "",
        "a",
        "alice/bob",
        "alice bob",
        "alice?x",
        ".alice",
        "alice.",
    ] {
        assert_eq!(
            build_query_url(
                &api,
                &Query::User {
                    username: username.into()
                }
            )
            .unwrap_err()
            .code,
            "INVALID_INPUT"
        );
    }
    assert!(build_query_url(
        &api,
        &Query::User {
            username: "alice_".into(),
        }
    )
    .is_ok());
    assert!(build_query_url(
        &api,
        &Query::User {
            username: format!("a{}", "b".repeat(254)),
        }
    )
    .is_ok());
    assert_eq!(
        build_query_url(
            &api,
            &Query::User {
                username: format!("a{}", "b".repeat(255)),
            }
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );

    assert_eq!(
        build_query_url(
            &api,
            &Query::UserById {
                user_id: "alice".into(),
            }
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );

    let (projects_url, _) = build_query_url(
        &api,
        &Query::UserProjects {
            user_id: "42".to_owned(),
            search: String::new(),
            include_archived: true,
            page: 2,
        },
    )
    .unwrap();
    let project_params = projects_url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(projects_url.path(), "/api/v4/users/42/projects");
    assert_eq!(project_params.get("order_by").unwrap(), "last_activity_at");
    assert_eq!(project_params.get("sort").unwrap(), "desc");
    assert_eq!(project_params.get("simple").unwrap(), "true");
    assert_eq!(project_params.get("page").unwrap(), "2");
    assert_eq!(project_params.get("per_page").unwrap(), "30");
    assert!(!project_params.contains_key("membership"));
    assert!(!project_params.contains_key("archived"));

    for (user_id, page) in [("0", 1), ("42x", 1), ("42", 0)] {
        assert_eq!(
            build_query_url(
                &api,
                &Query::UserProjects {
                    user_id: user_id.to_owned(),
                    search: String::new(),
                    include_archived: true,
                    page,
                }
            )
            .unwrap_err()
            .code,
            "INVALID_INPUT"
        );
    }
}

#[test]
fn project_search_includes_namespaces() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let (url, _) = build_query_url(
        &api,
        &Query::Projects {
            search: "group/demo".to_owned(),
            membership: false,
            include_archived: true,
            page: 1,
        },
    )
    .unwrap();
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("search").unwrap(), "group/demo");
    assert_eq!(params.get("search_namespaces").unwrap(), "true");
    assert_eq!(params.get("order_by").unwrap(), "last_activity_at");
    assert_eq!(params.get("sort").unwrap(), "desc");
}

#[test]
fn forbidden_messages_distinguish_reads_from_writes() {
    let headers = HeaderMap::new();
    let read = status_error(StatusCode::FORBIDDEN, &headers, false);
    let write = status_error(StatusCode::FORBIDDEN, &headers, true);
    assert_eq!(
        (read.code.as_str(), write.code.as_str()),
        ("FORBIDDEN", "FORBIDDEN")
    );
    assert_eq!(read.message, "表示する権限がありません。");
    assert!(write.message.contains("api スコープ"));
    let limited = status_error(StatusCode::TOO_MANY_REQUESTS, &headers, false);
    assert_eq!(limited.retry_after_ms, None);
    assert!(limited.message.contains("しばらく待って"));
}

#[test]
fn maps_auth_and_rate_limit_errors_without_body() {
    let fixture = Fixture::new(vec![response("401 Unauthorized", "SECRET", "")]);
    let client = Client::builder().build().unwrap();
    let error = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::Mr {
                project_id: "1".to_owned(),
                iid: "2".to_owned(),
            },
        ))
        .unwrap_err();
    assert_eq!(error.code, "AUTH_REQUIRED");
    assert!(!error.message.contains("SECRET"));

    let fixture = Fixture::new(vec![response(
        "429 Too Many Requests",
        "SECRET",
        "Retry-After: 4\r\n",
    )]);
    let error = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::Mr {
                project_id: "1".to_owned(),
                iid: "2".to_owned(),
            },
        ))
        .unwrap_err();
    assert_eq!(error.code, "RATE_LIMITED");
    assert_eq!(error.retry_after_ms, Some(4_000));
    assert!(error.message.contains("4秒後に再試行"));
}

#[test]
fn rejects_unsafe_file_input_before_request() {
    let fixture = Fixture::new(Vec::new());
    let client = Client::builder().build().unwrap();
    let error = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::File {
                project_id: "1".to_owned(),
                path: "../secret".to_owned(),
                sha: "abc".to_owned(),
            },
        ))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert!(fixture.requests.lock().unwrap().is_empty());
}

#[test]
fn lists_a_repository_folder_at_a_branch_and_reads_a_blob() {
    let fixture = Fixture::new(vec![
        response(
            "200 OK",
            r#"[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"src","type":"tree","path":"docs/src","mode":"040000"},{"id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","name":"a b.md","type":"blob","path":"docs/a b.md","mode":"100644"}]"#,
            "Content-Type: application/json\r\nX-Next-Page: 2\r\n",
        ),
        response("200 OK", "text", "Content-Type: text/plain\r\n"),
    ]);
    let client = Client::builder().build().unwrap();
    let tree = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::Tree {
                project_id: "42".to_owned(),
                git_ref: Some("feature/x".to_owned()),
                path: "docs".to_owned(),
                page: 1,
            },
        ))
        .unwrap();
    assert_eq!(tree.next_page, Some(2));
    assert_eq!(tree.data[1]["type"], "blob");
    assert_eq!(tree.data[1]["path"], "docs/a b.md");
    let blob = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::Blob {
                project_id: "42".to_owned(),
                sha: "b".repeat(40),
            },
        ))
        .unwrap();
    assert_eq!(blob.data["content"], "text");
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0].starts_with(
        "GET /api/v4/projects/42/repository/tree?page=1&per_page=100&path=docs&ref=feature%2Fx "
    ));
    assert!(requests[1].starts_with(&format!(
        "GET /api/v4/projects/42/repository/blobs/{}/raw ",
        "b".repeat(40)
    )));
}

#[test]
fn rejects_unsafe_tree_paths_and_refs_before_requesting() {
    let fixture = Fixture::new(Vec::new());
    let client = Client::builder().build().unwrap();
    for (git_ref, path) in [
        (None, "../etc"),
        (Some("a..b"), ""),
        (Some("has space"), ""),
    ] {
        let error = runtime()
            .block_on(fetch(
                &client,
                &fixture.url(),
                &Query::Tree {
                    project_id: "42".to_owned(),
                    git_ref: git_ref.map(str::to_owned),
                    path: path.to_owned(),
                    page: 1,
                },
            ))
            .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");
    }
    assert!(fixture.requests.lock().unwrap().is_empty());
}

#[test]
fn preserves_api_subpath_and_encodes_repository_file_path() {
    let fixture = Fixture::new_at_path(
        vec![response(
            "200 OK",
            "contents",
            "Content-Type: text/plain\r\n",
        )],
        "/gitlab/api/v4/",
    );
    let client = Client::builder().build().unwrap();
    let result = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::File {
                project_id: "42".to_owned(),
                path: "docs/spec #1.md".to_owned(),
                sha: HEAD_SHA.to_owned(),
            },
        ))
        .unwrap();
    assert_eq!(result.data["content"], "contents");
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0]
        .contains("/gitlab/api/v4/projects/42/repository/files/docs%2Fspec%20%231.md/raw?ref="));
}

#[test]
fn decodes_shift_jis_file_when_not_utf8() {
    // A Japanese interface reads Shift_JIS first whatever the system code page.
    crate::text_encoding::set_language("ja");
    let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode("SELECT '日本語' -- 表示");
    assert_eq!(
        decode_file_text(bytes.into_owned()).unwrap(),
        "SELECT '日本語' -- 表示"
    );
    assert_eq!(
        decode_file_text("日本語".as_bytes().to_vec()).unwrap(),
        "日本語"
    );
    assert_eq!(
        decode_file_text(vec![0x89, b'P', b'N', b'G', 0, 0xff])
            .unwrap_err()
            .code,
        "UNSUPPORTED"
    );
}

#[test]
fn diff_fetch_checks_the_head_beside_the_read_and_confirms_it_after() {
    let merge_request = format!(r#"{{"diff_refs":{{"head_sha":"{HEAD_SHA}"}}}}"#);
    let fixture = Fixture::routed(vec![
        ("/merge_requests/9 ", response("200 OK", &merge_request, "")),
        (
            "/merge_requests/9/diffs?",
            response(
                "200 OK",
                r#"[{"old_path":"src/a.ts","new_path":"src/a.ts","diff":"@@","new_file":false,"deleted_file":false,"renamed_file":false,"too_large":false}]"#,
                "X-Next-Page: 2
",
            ),
        ),
        ("/merge_requests/9 ", response("200 OK", &merge_request, "")),
    ]);
    let client = Client::builder().build().unwrap();
    let query = Query::Diffs {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        head_sha: HEAD_SHA.to_owned(),
        page: 1,
    };
    let result = runtime()
        .block_on(fetch(&client, &fixture.url(), &query))
        .unwrap();

    assert_eq!(result.data[0]["newPath"], "src/a.ts");
    assert_eq!(result.next_page, Some(2));
    {
        let requests = fixture.requests.lock().unwrap();
        // The page is returned after one head check made beside the read.
        assert_eq!(requests.len(), 2);
        let diff_read = requests
            .iter()
            .position(|request| request.contains("/projects/42/merge_requests/9/diffs?"))
            .unwrap();
        assert!(requests[1 - diff_read].contains("/projects/42/merge_requests/9 HTTP/1.1"));
        assert!(requests[diff_read]
            .to_lowercase()
            .contains("accept-encoding: gzip"));
    }
    runtime()
        .block_on(confirm_unchanged(&client, &fixture.url(), &query))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[2].contains("/projects/42/merge_requests/9 HTTP/1.1"));
}

#[test]
fn diff_confirmation_fails_if_the_head_changes_while_loading() {
    let before = format!(r#"{{"diff_refs":{{"head_sha":"{HEAD_SHA}"}}}}"#);
    let changed = r#"{"diff_refs":{"head_sha":"fedcba9876543210fedcba9876543210fedcba98"}}"#;
    let fixture = Fixture::routed(vec![
        ("/merge_requests/9 ", response("200 OK", &before, "")),
        (
            "/merge_requests/9/diffs?",
            response(
                "200 OK",
                r#"[{"old_path":"src/old.ts","new_path":"src/old.ts","diff":"@@","new_file":false,"deleted_file":false,"renamed_file":false,"too_large":false}]"#,
                "",
            ),
        ),
        ("/merge_requests/9 ", response("200 OK", changed, "")),
    ]);
    let client = Client::builder().build().unwrap();
    let query = Query::Diffs {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        head_sha: HEAD_SHA.to_owned(),
        page: 1,
    };
    runtime()
        .block_on(fetch(&client, &fixture.url(), &query))
        .unwrap();
    let error = runtime()
        .block_on(confirm_unchanged(&client, &fixture.url(), &query))
        .unwrap_err();

    assert_eq!(error.code, "INVALID_INPUT");
    assert!(error.message.contains("再読み込み"));
    assert_eq!(fixture.requests.lock().unwrap().len(), 3);
}

#[test]
fn rejects_blank_resource_and_user_responses() {
    assert_eq!(
        normalize_project(&Value::Null).unwrap_err().code,
        "UNSUPPORTED"
    );
    assert_eq!(
        normalize_project(&json!({})).unwrap_err().code,
        "UNSUPPORTED"
    );
    assert_eq!(
        normalize_merge_request(&json!({
            "id": 1,
            "iid": "2",
            "project_id": 3,
            "title": "Review",
            "state": "opened",
            "author": {}
        }))
        .unwrap_err()
        .code,
        "UNSUPPORTED"
    );
    assert_eq!(
        normalize_project(&json!({
            "id": 0,
            "name": "Demo",
            "path_with_namespace": "group/demo"
        }))
        .unwrap_err()
        .code,
        "UNSUPPORTED"
    );
}

#[test]
fn rejects_invalid_mutation_fields_before_request() {
    let blank = Action::Comment {
        project_id: "1".to_owned(),
        iid: "2".to_owned(),
        body: " \n ".to_owned(),
        thread: false,
        position: None,
    };
    assert_eq!(validate_action(&blank).unwrap_err().code, "INVALID_INPUT");

    let oversized = Action::EditDraft {
        project_id: "1".to_owned(),
        iid: "2".to_owned(),
        draft_id: "3".to_owned(),
        body: "x".repeat(MAX_ACTION_BODY_BYTES + 1),
    };
    assert_eq!(
        validate_action(&oversized).unwrap_err().code,
        "INVALID_INPUT"
    );

    let zero_id = Action::Unapprove {
        project_id: "0".to_owned(),
        iid: "2".to_owned(),
    };
    assert_eq!(validate_action(&zero_id).unwrap_err().code, "INVALID_INPUT");

    let zero_line = Action::Comment {
        project_id: "1".to_owned(),
        iid: "2".to_owned(),
        body: "Comment".to_owned(),
        thread: true,
        position: Some(Position {
            base_sha: HEAD_SHA.to_owned(),
            start_sha: HEAD_SHA.to_owned(),
            head_sha: HEAD_SHA.to_owned(),
            old_path: "src/a.ts".to_owned(),
            new_path: "src/a.ts".to_owned(),
            old_line: None,
            new_line: Some(0),
            position_type: PositionType::Text,
            line_range: None,
        }),
    };
    assert_eq!(
        validate_action(&zero_line).unwrap_err().code,
        "INVALID_INPUT"
    );

    assert!(validate_sha(&"a".repeat(40), "sha").is_ok());
    assert!(validate_sha(&"a".repeat(64), "sha").is_ok());
    assert!(validate_sha(&"a".repeat(41), "sha").is_err());
}

#[test]
fn line_comment_checks_current_head_before_write() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        &format!(
            r#"{{"diff_refs":{{"head_sha":"{}"}}}}"#,
            "fedcba9876543210fedcba9876543210fedcba98"
        ),
        "",
    )]);
    let client = Client::builder().build().unwrap();
    let action = Action::Approve {
        project_id: "1".to_owned(),
        iid: "2".to_owned(),
        sha: HEAD_SHA.to_owned(),
    };
    let error = runtime()
        .block_on(mutate(&client, &fixture.url(), &action, "9"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn mr_assignment_filters_reach_gitlab_for_global_and_project_lists() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    for project_id in [None, Some("42".to_owned())] {
        let query = Query::Mrs {
            search: String::new(),
            state: MergeRequestState::Opened,
            project_id: project_id.clone(),
            group_id: None,
            labels: None,
            source_branch: None,
            target_branch: None,
            reviewer_id: Some("8".to_owned()),
            assignee_id: Some("9".to_owned()),
            author_id: None,
            updated_after: None,
            updated_before: None,
            order_by: None,
            sort: None,
            page: 2,
        };
        let (url, _) = build_query_url(&api, &query).unwrap();
        let params = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(params.get("assignee_id").unwrap(), "9");
        assert_eq!(params.get("reviewer_id").unwrap(), "8");
        assert_eq!(params.get("scope").unwrap(), "all");
        assert_eq!(params.get("state").unwrap(), "opened");
        assert_eq!(params.get("page").unwrap(), "2");
        assert_eq!(params.get("order_by").unwrap(), "updated_at");
        assert_eq!(params.get("sort").unwrap(), "desc");
        assert_eq!(
            url.path(),
            if project_id.is_some() {
                "/api/v4/projects/42/merge_requests"
            } else {
                "/api/v4/merge_requests"
            }
        );
        let mut ordered = query.clone();
        if let Query::Mrs { order_by, sort, .. } = &mut ordered {
            *order_by = Some("created_at".to_owned());
            *sort = Some("asc".to_owned());
        }
        let (ordered_url, _) = build_query_url(&api, &ordered).unwrap();
        assert!(ordered_url
            .query_pairs()
            .any(|(key, value)| key == "order_by" && value == "created_at"));
        if let Query::Mrs { sort, .. } = &mut ordered {
            *sort = Some("arbitrary".to_owned());
        }
        assert_eq!(
            build_query_url(&api, &ordered).unwrap_err().code,
            "INVALID_INPUT"
        );
        if let Query::Mrs { order_by, sort, .. } = &mut ordered {
            *sort = None;
            *order_by = Some("arbitrary".to_owned());
        }
        assert_eq!(
            build_query_url(&api, &ordered).unwrap_err().code,
            "INVALID_INPUT"
        );
        let mut invalid = query;
        if let Query::Mrs { assignee_id, .. } = &mut invalid {
            *assignee_id = Some("self".to_owned());
        }
        assert_eq!(
            build_query_url(&api, &invalid).unwrap_err().code,
            "INVALID_INPUT"
        );
    }
}

#[test]
fn group_search_uses_encoded_path_and_passes_label_and_branch_filters() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let make_query = |project_id, group_id, labels| Query::Mrs {
        search: "cache".to_owned(),
        state: MergeRequestState::Opened,
        project_id,
        group_id,
        labels,
        source_branch: Some("feature/search".to_owned()),
        target_branch: Some("main".to_owned()),
        reviewer_id: None,
        assignee_id: None,
        author_id: None,
        updated_after: None,
        updated_before: None,
        order_by: None,
        sort: None,
        page: 1,
    };
    let query = make_query(
        None,
        Some("team/platform".to_owned()),
        Some(vec!["bug".to_owned(), "ready".to_owned()]),
    );
    let (url, _) = build_query_url(&api, &query).unwrap();
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();

    assert_eq!(url.path(), "/api/v4/groups/team%2Fplatform/merge_requests");
    assert_eq!(params.get("search").unwrap(), "cache");
    assert_eq!(params.get("labels").unwrap(), "bug,ready");
    assert_eq!(params.get("source_branch").unwrap(), "feature/search");
    assert_eq!(params.get("target_branch").unwrap(), "main");

    let invalid_scopes = [
        make_query(
            Some("42".to_owned()),
            Some("team/platform".to_owned()),
            Some(vec!["bug".to_owned()]),
        ),
        make_query(
            None,
            Some("team/../platform".to_owned()),
            Some(vec!["bug".to_owned()]),
        ),
        make_query(
            None,
            Some("team/platform".to_owned()),
            Some(vec!["".to_owned()]),
        ),
    ];
    for invalid in invalid_scopes {
        assert_eq!(
            build_query_url(&api, &invalid).unwrap_err().code,
            "INVALID_INPUT"
        );
    }
}

#[test]
fn explicit_mr_number_search_filters_by_iid() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let make_query = |search: &str| Query::Mrs {
        search: search.to_owned(),
        state: MergeRequestState::All,
        project_id: Some("42".to_owned()),
        group_id: None,
        labels: None,
        source_branch: None,
        target_branch: None,
        reviewer_id: None,
        assignee_id: None,
        author_id: None,
        updated_after: None,
        updated_before: None,
        order_by: None,
        sort: None,
        page: 1,
    };
    let outside_project = |group_id: Option<&str>| Query::Mrs {
        search: "!123".to_owned(),
        state: MergeRequestState::All,
        project_id: None,
        group_id: group_id.map(str::to_owned),
        labels: None,
        source_branch: None,
        target_branch: None,
        reviewer_id: None,
        assignee_id: None,
        author_id: None,
        updated_after: None,
        updated_before: None,
        order_by: None,
        sort: None,
        page: 1,
    };
    for search in ["!123", " !123 "] {
        let (url, _) = build_query_url(&api, &make_query(search)).unwrap();
        let params = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(params.get("iids[]").unwrap(), "123");
        assert!(!params.contains_key("search"));
    }
    for search in ["123", "!", "12a", "v1.2"] {
        let (url, _) = build_query_url(&api, &make_query(search)).unwrap();
        let params = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(params.get("search").unwrap(), search);
        assert!(!params.contains_key("iids[]"));
    }
    // Group and global lists ignore `iids[]`; `fetch` searches the number instead.
    for group_id in [None, Some("9")] {
        let (url, _) = build_query_url(&api, &outside_project(group_id)).unwrap();
        let params = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(params.get("search").unwrap(), "!123");
        assert!(!params.contains_key("iids[]"));
    }
}

#[test]
fn bare_mr_number_search_leads_with_iid_matches_then_text_matches() {
    let user = r#"{"id":1,"username":"alice","name":"Alice"}"#;
    let mr = |id: u32, iid: u32, title: &str| {
        format!(
            r#"{{"id":{id},"iid":{iid},"project_id":7,"title":"{title}","state":"opened","author":{user}}}"#
        )
    };
    let fixture = Fixture::new(vec![
        response(
            "200 OK",
            &format!(
                "[{},{}]",
                mr(1, 5, "Fix 123 errors"),
                mr(2, 123, "Numbered")
            ),
            "X-Next-Page: 2\r\n",
        ),
        response("200 OK", &format!("[{}]", mr(2, 123, "Numbered")), ""),
        response(
            "200 OK",
            &format!("[{},{}]", mr(2, 123, "Numbered"), mr(4, 6, "Retry 123")),
            "",
        ),
    ]);
    let client = Client::builder().build().unwrap();
    let query = |page| Query::Mrs {
        search: "123".to_owned(),
        state: MergeRequestState::All,
        project_id: Some("7".to_owned()),
        group_id: None,
        labels: None,
        source_branch: None,
        target_branch: None,
        reviewer_id: None,
        assignee_id: None,
        author_id: None,
        updated_after: None,
        updated_before: None,
        order_by: None,
        sort: None,
        page,
    };
    let iids = |result: &ApiResult| {
        result
            .data
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["iid"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };

    let first = runtime()
        .block_on(fetch(&client, &fixture.url(), &query(1)))
        .unwrap();
    assert_eq!(iids(&first), ["123", "5"]);
    assert_eq!(first.next_page, Some(2));
    let second = runtime()
        .block_on(fetch(&client, &fixture.url(), &query(2)))
        .unwrap();
    assert_eq!(iids(&second), ["6"]);

    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[0].contains("/projects/7/merge_requests"));
    assert!(requests[0].contains("search=123") && !requests[0].contains("iids"));
    assert!(requests[1].contains("iids%5B%5D=123") && !requests[1].contains("search="));
    assert!(requests[2].contains("search=123") && requests[2].contains("page=2"));
}

#[test]
fn mr_number_search_outside_a_project_uses_gitlab_search_and_keeps_the_list_conditions() {
    let mr = |id: u32, iid: u32, project: u32, reviewer: u32, state: &str| {
        format!(
            r#"{{"id":{id},"iid":{iid},"project_id":{project},"title":"MR {id}","state":"{state}","updated_at":"2026-01-15T00:00:00Z","author":{{"id":1,"username":"alice","name":"Alice"}},"reviewers":[{{"id":{reviewer},"username":"r{reviewer}","name":"R"}}]}}"#
        )
    };
    let found = format!(
        "[{},{},{},{}]",
        mr(1, 123, 7, 8, "opened"),
        mr(2, 123, 9, 5, "opened"),
        mr(3, 1234, 7, 8, "opened"),
        mr(4, 123, 11, 8, "merged"),
    );
    let fixture = Fixture::new(vec![
        response("200 OK", &found, "X-Next-Page: 2\r\nX-Total-Pages: 3\r\n"),
        response("200 OK", &format!("[{}]", mr(5, 6, 7, 8, "opened")), ""),
        response("200 OK", &found, ""),
    ]);
    let client = Client::builder().build().unwrap();
    let query = |search: &str, group_id: Option<&str>| Query::Mrs {
        search: search.to_owned(),
        state: MergeRequestState::Opened,
        project_id: None,
        group_id: group_id.map(str::to_owned),
        labels: None,
        source_branch: None,
        target_branch: None,
        reviewer_id: Some("8".to_owned()),
        assignee_id: None,
        author_id: Some("1".to_owned()),
        updated_after: Some("2026-01-01T00:00:00.000Z".to_owned()),
        updated_before: None,
        order_by: None,
        sort: None,
        page: 1,
    };
    let ids = |result: &ApiResult| {
        result
            .data
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };

    // `!123` lists only the MRs numbered 123 that meet the conditions.
    let explicit = runtime()
        .block_on(fetch(&client, &fixture.url(), &query("!123", None)))
        .unwrap();
    assert_eq!(ids(&explicit), ["1"]);
    assert_eq!(explicit.next_page, Some(2));
    assert_eq!(explicit.total_pages, None);
    // `123` leads with those MRs, then the text matches.
    let bare = runtime()
        .block_on(fetch(&client, &fixture.url(), &query("123", Some("9"))))
        .unwrap();
    assert_eq!(ids(&bare), ["1", "5"]);

    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[0].starts_with("GET /api/v4/search?"));
    assert!(requests[0].contains("scope=merge_requests") && requests[0].contains("search=%23123"));
    assert!(requests[0].contains("state=opened") && requests[0].contains("per_page=100"));
    assert!(requests[1].starts_with("GET /api/v4/groups/9/merge_requests?"));
    assert!(requests[1].contains("search=123") && requests[1].contains("reviewer_id=8"));
    assert!(requests[2].starts_with("GET /api/v4/groups/9/search?"));
    assert!(requests[2].contains("search=%23123"));
}

#[test]
fn uses_project_scoped_mr_and_repository_commit_diff_routes() {
    let fixture = Fixture::new(vec![
        response("200 OK", "[]", ""),
        response(
            "200 OK",
            r#"[{"old_path":"src/a.ts","new_path":"src/a.ts","diff":"@@","new_file":false,"deleted_file":false,"renamed_file":false,"too_large":false}]"#,
            "",
        ),
    ]);
    let client = Client::builder().build().unwrap();
    let project_mrs = Query::Mrs {
        search: "demo".to_owned(),
        state: MergeRequestState::All,
        project_id: Some("42".to_owned()),
        group_id: None,
        labels: None,
        source_branch: None,
        target_branch: None,
        reviewer_id: None,
        assignee_id: None,
        author_id: None,
        updated_after: None,
        updated_before: None,
        order_by: None,
        sort: None,
        page: 1,
    };
    runtime()
        .block_on(fetch(&client, &fixture.url(), &project_mrs))
        .unwrap();
    runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::CommitDiff {
                project_id: "42".to_owned(),
                iid: "9".to_owned(),
                sha: HEAD_SHA.to_owned(),
                page: 1,
            },
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0].contains("/api/v4/projects/42/merge_requests?"));
    assert!(requests[1].contains("/api/v4/projects/42/repository/commits/"));
    assert!(!requests[1].contains("merge_requests/9/commits"));
}

#[test]
fn discovery_queries_encode_paths_and_bound_lists() {
    let api = Url::parse("https://gitlab.example/prefix/api/v4/").unwrap();
    let (project, _) = build_query_url(
        &api,
        &Query::Project {
            path: "group/sub/project".to_owned(),
        },
    )
    .unwrap();
    assert_eq!(
        project.path(),
        "/prefix/api/v4/projects/group%2Fsub%2Fproject"
    );
    for path in [
        "",
        "42",
        "group/../project",
        "group//project",
        "/group/project",
        "group/project\n",
    ] {
        assert_eq!(
            build_query_url(
                &api,
                &Query::Project {
                    path: path.to_owned()
                }
            )
            .unwrap_err()
            .code,
            "INVALID_INPUT"
        );
    }
    let (users, _) = build_query_url(
        &api,
        &Query::Users {
            search: "A & B".to_owned(),
            page: 2,
        },
    )
    .unwrap();
    let params = users
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("search").unwrap(), "A & B");
    assert_eq!(params.get("active").unwrap(), "true");
    assert_eq!(params.get("per_page").unwrap(), "30");
    assert_eq!(params.get("page").unwrap(), "2");
    let (todos, _) = build_query_url(
        &api,
        &Query::Todos {
            page: 1,
            done: false,
        },
    )
    .unwrap();
    let params = todos
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("type").unwrap(), "MergeRequest");
    assert_eq!(params.get("state").unwrap(), "pending");
    assert_eq!(params.get("per_page").unwrap(), "100");
    let (done, _) = build_query_url(
        &api,
        &Query::Todos {
            page: 1,
            done: true,
        },
    )
    .unwrap();
    assert!(done.query().unwrap().contains("state=done"));
    assert!(build_query_url(
        &api,
        &Query::Todos {
            page: 0,
            done: false,
        },
    )
    .is_err());
}

#[test]
fn groups_query_searches_visible_groups_and_normalizes_paths() {
    let api = Url::parse("https://gitlab.example/prefix/api/v4/").unwrap();
    let (url, kind) = build_query_url(
        &api,
        &Query::Groups {
            search: "team/plat".to_owned(),
            page: 1,
        },
    )
    .unwrap();
    assert_eq!(url.path(), "/prefix/api/v4/groups");
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("search").unwrap(), "team/plat");
    assert_eq!(params.get("all_available").unwrap(), "true");
    assert_eq!(params.get("per_page").unwrap(), "20");
    assert!(!params.contains_key("min_access_level"));
    assert!(build_query_url(
        &api,
        &Query::Groups {
            search: "team".to_owned(),
            page: 0,
        },
    )
    .is_err());

    let groups = normalize_response(
        kind,
        json!([{"id": 12, "name": "Platform", "full_path": "team/platform", "full_name": "Team / Platform", "web_url": "https://gitlab.example/prefix/groups/team/platform"}]),
    )
    .unwrap();
    assert_eq!(groups[0]["id"], "12");
    assert_eq!(groups[0]["fullPath"], "team/platform");
    assert_eq!(groups[0]["fullName"], "Team / Platform");
    assert_eq!(
        normalize_group(&json!({"id": 12, "name": "Platform"}))
            .unwrap_err()
            .code,
        "UNSUPPORTED"
    );
}

#[test]
fn merge_request_creation_time_is_returned_when_gitlab_sends_it() {
    let base = json!({
        "id": 1,
        "iid": 2,
        "project_id": 3,
        "title": "Review",
        "state": "opened",
        "author": {"id": 4, "username": "alice", "name": "Alice"},
        "updated_at": "2026-10-09T00:00:01Z",
    });
    assert!(normalize_merge_request(&base)
        .unwrap()
        .get("createdAt")
        .is_none());
    let mut created = base.clone();
    created["created_at"] = "2026-10-01T00:00:00Z".into();
    let merge_request = normalize_merge_request(&created).unwrap();
    assert_eq!(merge_request["createdAt"], "2026-10-01T00:00:00Z");
    assert_eq!(merge_request["updatedAt"], "2026-10-09T00:00:01Z");
}

#[test]
fn branches_query_is_project_scoped_recent_first_and_validated() {
    let api = Url::parse("https://gitlab.example/prefix/api/v4/").unwrap();
    let query = |project_id: &str, search: &str, page| Query::Branches {
        project_id: project_id.to_owned(),
        search: search.to_owned(),
        page,
    };
    let (url, _) = build_query_url(&api, &query("7", "feat/x", 2)).unwrap();
    assert_eq!(url.path(), "/prefix/api/v4/projects/7/repository/branches");
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("sort").unwrap(), "updated_desc");
    assert_eq!(params.get("search").unwrap(), "feat/x");
    assert_eq!(params.get("page").unwrap(), "2");
    assert_eq!(params.get("per_page").unwrap(), "30");
    let (url, _) = build_query_url(&api, &query("7", "", 1)).unwrap();
    assert!(!url.query_pairs().any(|(key, _)| key == "search"));
    assert!(build_query_url(&api, &query("../7", "", 1)).is_err());
    assert!(build_query_url(&api, &query("7", "", 0)).is_err());
}

#[test]
fn branches_keep_state_flags_and_latest_commit() {
    let branch = json!({
        "name": "feature/search", "merged": false, "protected": true, "default": false,
        "web_url": "https://gitlab.example/group/project/-/tree/feature/search",
        "commit": {"id": "abc123", "short_id": "abc1", "title": "Add search", "author_name": "Alice", "committed_date": "2026-10-09T00:00:00Z"}
    });
    let normalized = normalize_response(
        ResponseKind::Branches,
        json!([branch, {"name": "main", "default": true}]),
    )
    .unwrap();
    assert_eq!(normalized[0]["name"], "feature/search");
    assert_eq!(normalized[0]["protected"], true);
    assert_eq!(normalized[0]["commit"]["shortId"], "abc1");
    assert_eq!(
        normalized[0]["commit"]["committedDate"],
        "2026-10-09T00:00:00Z"
    );
    assert_eq!(normalized[1]["default"], true);
    assert!(normalized[1]["commit"].is_null());
    assert!(normalize_response(ResponseKind::Branches, json!([{"merged": true}])).is_err());
}

#[test]
fn notes_query_preserves_system_notes_and_updated_order() {
    let api = Url::parse("https://gitlab.example/prefix/api/v4/").unwrap();
    let query = Query::Notes {
        project_id: "7".to_owned(),
        iid: "3".to_owned(),
        page: 2,
    };
    let (url, kind) = build_query_url(&api, &query).unwrap();
    assert_eq!(
        url.path(),
        "/prefix/api/v4/projects/7/merge_requests/3/notes"
    );
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("sort").unwrap(), "desc");
    assert_eq!(params.get("order_by").unwrap(), "updated_at");
    assert_eq!(params.get("page").unwrap(), "2");
    assert_eq!(params.get("per_page").unwrap(), "30");
    let user = json!({"id": 9, "username": "alice", "name": "Alice"});
    let data = normalize_response(kind, json!([
        {"id": 1, "body": "changed labels", "author": user, "created_at": "2026-10-09T00:00:00Z", "updated_at": "2026-10-09T00:00:01Z", "system": true},
        {"id": 2, "body": "Please review", "author": user, "system": false}
    ])).unwrap();
    assert_eq!(data.as_array().unwrap().len(), 2);
    assert_eq!(data[0]["system"], true);
    assert_eq!(data[0]["updatedAt"], "2026-10-09T00:00:01Z");
    assert_eq!(data[1]["system"], false);
    assert!(data[1]["updatedAt"].is_null());
    for invalid in [
        Query::Notes {
            project_id: "bad/path".to_owned(),
            iid: "3".to_owned(),
            page: 1,
        },
        Query::Notes {
            project_id: "7".to_owned(),
            iid: "0".to_owned(),
            page: 1,
        },
        Query::Notes {
            project_id: "7".to_owned(),
            iid: "3".to_owned(),
            page: 0,
        },
    ] {
        assert_eq!(
            build_query_url(&api, &invalid).unwrap_err().code,
            "INVALID_INPUT"
        );
    }
}

#[test]
fn optional_review_metadata_and_todos_preserve_resource_types() {
    let user = json!({"id": 7, "username": "alice", "name": "Alice"});
    let mut mr = json!({"id": 11, "iid": 3, "project_id": 2, "title": "Review", "state": "opened", "author": user});
    let normalized = normalize_merge_request(&mr).unwrap();
    assert!(normalized["projectPath"].is_null());
    assert!(normalized["pipeline"].is_null());
    assert_eq!(normalized["assignees"], json!([]));
    assert_eq!(normalized["labels"], json!([]));
    mr["references"] = json!({"full": "group/project!3"});
    mr["draft"] = json!(true);
    mr["labels"] = json!(["bug"]);
    mr["assignees"] = json!([user.clone()]);
    mr["reviewers"] = json!([user.clone()]);
    mr["head_pipeline"] =
        json!({"status": "success", "web_url": "https://gitlab.example/pipelines/1"});
    let normalized = normalize_merge_request(&mr).unwrap();
    assert_eq!(normalized["projectPath"], "group/project");
    assert_eq!(normalized["draft"], true);
    assert_eq!(normalized["assignees"][0]["id"], "7");
    assert_eq!(normalized["reviewers"][0]["name"], "Alice");
    assert_eq!(normalized["pipeline"]["status"], "success");
    let todo = json!({"id": 4, "target_type": "MergeRequest", "target": {"iid": 3, "title": "Review"}, "project": {"id": 2, "name": "Project", "path_with_namespace": "group/project"}, "author": user, "action_name": "assigned", "body": "Please review", "created_at": "2026-10-09T00:00:00Z", "target_url": "https://gitlab.example/group/project/-/merge_requests/3"});
    let normalized =
        normalize_todos(json!([{"target_type": "Issue", "target": {"iid": 3}}, todo.clone()]))
            .unwrap();
    assert_eq!(normalized.as_array().unwrap().len(), 1);
    assert_eq!(normalized[0]["projectId"], "2");
    assert_eq!(normalized[0]["iid"], "3");
    let mut invalid = todo;
    invalid["target"] = Value::Null;
    assert!(normalize_todos(json!([invalid])).is_err());
    mr["assignees"] = json!([{"id": 7, "username": "alice"}]);
    assert!(normalize_merge_request(&mr).is_err());
    let note =
        normalize_note(&json!({"id": 1, "author": user, "updated_at": "2026-10-09T00:00:00Z"}))
            .unwrap();
    assert_eq!(note["updatedAt"], "2026-10-09T00:00:00Z");
}

#[test]
fn retries_recoverable_gets_at_most_twice() {
    let fixture = Fixture::new(vec![
        response("503 Service Unavailable", "{}", ""),
        response("502 Bad Gateway", "{}", ""),
        response("500 Internal Server Error", "{}", ""),
    ]);
    let client = Client::builder().build().unwrap();
    let error = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::Mr {
                project_id: "1".to_owned(),
                iid: "2".to_owned(),
            },
        ))
        .unwrap_err();
    assert_eq!(error.code, "NETWORK");
    assert_eq!(fixture.requests.lock().unwrap().len(), 3);
}

#[test]
fn writes_are_sent_once_when_outcome_is_unknown() {
    let fixture = Fixture::new(vec![response("500 Internal Server Error", "{}", "")]);
    let client = Client::builder().build().unwrap();
    let error = runtime()
        .block_on(mutate(
            &client,
            &fixture.url(),
            &Action::Unapprove {
                project_id: "1".to_owned(),
                iid: "2".to_owned(),
            },
            "9",
        ))
        .unwrap_err();
    assert_eq!(error.code, "UNKNOWN_OUTCOME");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn ambiguous_success_and_timeout_never_confirm_or_retry_a_write() {
    for (status, body) in [
        ("200 OK", "<html>login</html>"),
        ("200 OK", "{}"),
        ("200 OK", "{\"id\":"),
        ("200 OK", "[]"),
        ("202 Accepted", "{\"id\":1}"),
        ("204 No Content", ""),
        ("408 Request Timeout", ""),
    ] {
        let fixture = Fixture::new(vec![response(status, body, "")]);
        let error = runtime()
            .block_on(send_mutation(
                &Client::new(),
                Method::POST,
                fixture.url(),
                json!({"body":"fixture"}),
                false,
                |_| None,
                false,
            ))
            .unwrap_err();
        assert_eq!(error.code, "UNKNOWN_OUTCOME", "{status}");
        assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn write_confirmation_requires_identified_json_or_expected_no_content() {
    for (status, body, allows_empty) in [
        ("201 Created", "{\"id\":42}", false),
        ("200 OK", "{\"id\":\"discussion-hash\"}", false),
        ("204 No Content", "", true),
    ] {
        let fixture = Fixture::new(vec![response(status, body, "")]);
        runtime()
            .block_on(send_mutation(
                &Client::new(),
                Method::POST,
                fixture.url(),
                Value::Null,
                allows_empty,
                |_| None,
                false,
            ))
            .unwrap();
        assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    }
}

#[test]
#[ignore = "Explicit read-only GitLab.com MR check; public endpoints must permit anonymous access"]
fn gitlab_com_public_merge_request_review() {
    runtime().block_on(async {
        let client = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap();
        let api = Url::parse("https://gitlab.com/api/v4/").unwrap();
        let project_id = "278964".to_owned();
        let started = std::time::Instant::now();
        let list = fetch(
            &client,
            &api,
            &Query::Mrs {
                search: String::new(),
                state: MergeRequestState::Merged,
                project_id: Some(project_id.clone()),
                group_id: None,
                labels: None,
                source_branch: None,
                target_branch: None,
                reviewer_id: None,
                assignee_id: None,
                author_id: None,
                updated_after: None,
                updated_before: None,
                order_by: None,
                sort: None,
                page: 1,
            },
        )
        .await
        .unwrap();
        let rows = list.data.as_array().unwrap();
        let iid = rows.first().unwrap()["iid"].as_str().unwrap().to_owned();
        let mr = fetch(
            &client,
            &api,
            &Query::Mr {
                project_id: project_id.clone(),
                iid: iid.clone(),
            },
        )
        .await
        .unwrap();
        assert_eq!(mr.data["iid"].as_str(), Some(iid.as_str()));
        let head_sha = mr.data["diffRefs"]["headSha"].as_str().unwrap().to_owned();
        let discussions = fetch(
            &client,
            &api,
            &Query::Discussions {
                project_id: project_id.clone(),
                iid: iid.clone(),
                page: 1,
            },
        )
        .await
        .unwrap();
        let diffs = fetch(
            &client,
            &api,
            &Query::Diffs {
                project_id,
                iid,
                head_sha,
                page: 1,
            },
        )
        .await
        .unwrap();
        assert!(discussions.data.is_array());
        assert!(diffs.data.is_array());
        println!(
            "Public MR flow: {} list rows, {} discussions, {} files; network+normalization {} ms",
            rows.len(),
            discussions.data.as_array().unwrap().len(),
            diffs.data.as_array().unwrap().len(),
            started.elapsed().as_millis()
        );
    });
}

#[test]
fn normalizes_blame_and_associated_merge_requests() {
    let block = normalize_blame_block(&json!({
        "commit": { "id": "abc", "author_name": "Alice", "committed_date": "2026-09-01", "title": "Fix", "parent_ids": ["b".repeat(40), "short"] },
        "lines": ["before", "after"]
    })).unwrap();
    assert_eq!(block["lines"], json!(["before", "after"]));
    assert_eq!(block["commitId"], "abc");
    assert_eq!(block["parentIds"], json!(["b".repeat(40)]));
    let mr = normalize_associated_merge_request(&json!({
        "project_id": 7, "iid": 12, "title": "Introduce fix",
        "web_url": "https://gitlab.example/group/repo/-/merge_requests/12", "state": "merged"
    }))
    .unwrap();
    assert_eq!(mr["projectId"], "7");
    assert_eq!(mr["iid"], "12");
}

#[test]
fn blame_query_restricts_range_and_encodes_paths() {
    let base = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let query = Query::Blame {
        project_id: "7".to_owned(),
        path: "src/foo bar.ts".to_owned(),
        sha: "a".repeat(40),
        start_line: 2,
        end_line: 17,
    };
    let (url, _) = build_query_url(&base, &query).unwrap();
    assert!(url.path().contains("foo%20bar.ts"));
    assert!(url.as_str().contains("range%5Bstart%5D=2"));
    let bad = Query::Blame {
        project_id: "7".to_owned(),
        path: "x.rs".to_owned(),
        sha: "a".repeat(40),
        start_line: 1,
        end_line: 101,
    };
    assert_eq!(
        build_query_url(&base, &bad).unwrap_err().code,
        "INVALID_INPUT"
    );
}

#[test]
fn users_keep_only_a_bounded_avatar_url() {
    let user = normalize_user(&json!({"id": 3, "username": "a", "name": "A", "avatar_url": "https://gitlab.example/uploads/a.png"})).unwrap();
    assert_eq!(user["avatarUrl"], "https://gitlab.example/uploads/a.png");
    let user = normalize_user(&json!({"id": 3, "username": "a", "name": "A", "avatar_url": null}))
        .unwrap();
    assert!(user.get("avatarUrl").is_none());
}

#[test]
fn total_pages_is_an_optional_navigation_hint() {
    let mut headers = HeaderMap::new();
    assert_eq!(parse_total_pages(&headers), None);
    headers.insert("x-total-pages", "4".parse().unwrap());
    assert_eq!(parse_total_pages(&headers), Some(4));
    headers.insert("x-total-pages", "0".parse().unwrap());
    assert_eq!(parse_total_pages(&headers), None);
    headers.insert("x-total-pages", "many".parse().unwrap());
    assert_eq!(parse_total_pages(&headers), None);
}

#[test]
fn description_changes_only_when_gitlab_still_has_the_edited_description() {
    let action = Action::SetDescription {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        description: "新しい説明".to_owned(),
        expected_description: String::new(),
    };
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"description":null}"#, ""),
        response("200 OK", r#"{"id":1,"description":"新しい説明"}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[1].starts_with("PUT "));
    assert!(requests[1].contains("/projects/42/merge_requests/9 "));
    assert!(requests[1].ends_with(r#"{"description":"新しい説明"}"#));
    drop(requests);

    // Someone else changed the description: nothing is written.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"description":"別の人の編集"}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    let too_large = Action::SetDescription {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        description: "x".repeat(MAX_DESCRIPTION_BYTES + 1),
        expected_description: String::new(),
    };
    assert_eq!(
        validate_action(&too_large).unwrap_err().code,
        "INVALID_INPUT"
    );
}

#[test]
fn people_changes_replace_the_list_only_when_gitlab_still_has_the_seen_users() {
    let action = Action::SetReviewers {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        user_ids: vec!["7".to_owned(), "8".to_owned()],
        expected_user_ids: vec!["7".to_owned()],
    };
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"reviewers":[{"id":7}]}"#, ""),
        response("200 OK", r#"{"id":1,"reviewers":[{"id":8},{"id":7}]}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[1].starts_with("PUT "));
    assert!(requests[1].contains("/projects/42/merge_requests/9 "));
    assert!(requests[1].ends_with(r#"{"reviewer_ids":[7,8]}"#));
    drop(requests);

    // Someone else changed the reviewers: nothing is written.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"reviewers":[{"id":5}]}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    // GitLab kept only some of the users.
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"reviewers":[{"id":7}]}"#, ""),
        response("200 OK", r#"{"id":1,"reviewers":[{"id":7}]}"#, ""),
    ]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "UNSUPPORTED");
}

#[test]
fn people_changes_clear_with_an_empty_list_and_reject_bad_ids() {
    let clear = Action::SetAssignees {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        user_ids: Vec::new(),
        expected_user_ids: vec!["7".to_owned()],
    };
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"assignees":[{"id":7}]}"#, ""),
        response("200 OK", r#"{"id":1,"assignees":[]}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &clear, "7"))
        .unwrap();
    assert!(fixture.requests.lock().unwrap()[1].ends_with(r#"{"assignee_ids":[]}"#));

    for user_ids in [
        vec!["0".to_owned()],
        vec!["x".to_owned()],
        vec!["7".to_owned(), "7".to_owned()],
    ] {
        let invalid = Action::SetAssignees {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            user_ids,
            expected_user_ids: Vec::new(),
        };
        assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
    }
}

#[test]
fn approvals_for_a_page_take_one_graphql_request_with_values_as_variables() {
    let fixture = Fixture::new_at_path(
        vec![response(
            "200 OK",
            r#"{"data":{"m0":{"mergeRequest":{"approvedBy":{"nodes":[{"id":"gid://gitlab/User/42"}]}}},"m1":null}}"#,
            "",
        )],
        "/GitLab/api/v4/",
    );
    let query = Query::MrApprovals {
        items: vec![
            MrPathRef {
                project_path: "group/app".to_owned(),
                iid: "3".to_owned(),
            },
            MrPathRef {
                project_path: "group/\"hidden".to_owned(),
                iid: "4".to_owned(),
            },
        ],
    };
    let result = runtime()
        .block_on(fetch(&Client::new(), &fixture.url(), &query))
        .unwrap();
    assert_eq!(
        result.data,
        json!([
            {"projectPath": "group/app", "iid": "3", "approvedBy": ["42"]},
            {"projectPath": "group/\"hidden", "iid": "4", "approvedBy": null},
        ])
    );
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("POST /GitLab/api/graphql "));
    let raw = &requests[0];
    let body: Value = serde_json::from_str(&raw[raw.find("{\"query\"").unwrap()..]).unwrap();
    // Paths travel only as variables, so a quote cannot change the query.
    assert!(!body["query"].as_str().unwrap().contains("group/"));
    assert_eq!(body["variables"]["p1"], "group/\"hidden");

    let too_many = Query::MrApprovals {
        items: vec![
            MrPathRef {
                project_path: "group/app".to_owned(),
                iid: "3".to_owned(),
            };
            31
        ],
    };
    assert_eq!(
        runtime()
            .block_on(fetch(&Client::new(), &fixture.url(), &too_many))
            .unwrap_err()
            .code,
        "INVALID_INPUT"
    );
}

fn graphql_body(raw: &str) -> Value {
    serde_json::from_str(&raw[raw.find("{\"query\"").unwrap()..]).unwrap()
}

#[test]
fn merge_request_reactions_use_the_rest_award_list() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":5,"name":"thumbsup","user":{"id":7,"username":"alice","name":"Alice"},"awardable_type":"MergeRequest"}]"#,
        "",
    )]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::MrAwards {
                project_id: "42".to_owned(),
                iid: "9".to_owned(),
            },
        ))
        .unwrap();
    assert_eq!(
        result.data,
        json!([{"name": "thumbsup", "user": {"id": "7", "username": "alice", "name": "Alice"}}])
    );
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0]
        .starts_with("GET /api/v4/projects/42/merge_requests/9/award_emoji?page=1&per_page=100 "));
    assert!(normalize_award(&json!({"name": "smile"})).is_err());
}

#[test]
fn comment_reactions_read_back_from_the_newest_page_to_the_oldest_shown_comment() {
    let user = r#"{"id":"gid://gitlab/User/7","username":"alice","name":"Alice"}"#;
    let newest = format!(
        r#"{{"data":{{"project":{{"mergeRequest":{{"notes":{{"pageInfo":{{"hasPreviousPage":true,"startCursor":"c2"}},"nodes":[{{"id":"gid://gitlab/DiffNote/50","awardEmoji":{{"nodes":[{{"name":"tada","user":{user}}}]}}}},{{"id":"gid://gitlab/Note/60","lastEditedAt":"2026-10-01T09:06:00Z","awardEmoji":{{"nodes":[]}}}}]}}}}}}}}}}"#
    );
    let older = r#"{"data":{"project":{"mergeRequest":{"notes":{"pageInfo":{"hasPreviousPage":true,"startCursor":"c1"},"nodes":[{"id":"gid://gitlab/Note/30","awardEmoji":{"nodes":[]}},{"id":"gid://gitlab/Note/40","awardEmoji":{"nodes":[]}}]}}}}}"#;
    let fixture = Fixture::new_at_path(
        vec![
            response("200 OK", &newest, ""),
            response("200 OK", older, ""),
        ],
        "/GitLab/api/v4/",
    );
    let query = Query::NoteAwards {
        project_path: "group/\"app".to_owned(),
        iid: "9".to_owned(),
        since_note_id: "40".to_owned(),
    };
    let result = runtime()
        .block_on(fetch(&Client::new(), &fixture.url(), &query))
        .unwrap();
    assert!(!result.truncated);
    assert_eq!(
        result.data,
        json!([
            {"noteId": "50", "awards": [{"name": "tada", "user": {"id": "7", "username": "alice", "name": "Alice"}}], "lastEditedAt": null},
            {"noteId": "60", "awards": [], "lastEditedAt": "2026-10-01T09:06:00Z"},
            {"noteId": "40", "awards": [], "lastEditedAt": null},
        ])
    );
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].starts_with("POST /GitLab/api/graphql "));
    let first = graphql_body(&requests[0]);
    // Values travel only as variables, so a quote cannot change the query.
    assert!(!first["query"].as_str().unwrap().contains("group/"));
    assert_eq!(first["variables"]["path"], "group/\"app");
    assert_eq!(first["variables"]["last"], 100);
    assert!(first["variables"]["before"].is_null());
    assert_eq!(graphql_body(&requests[1])["variables"]["before"], "c2");
    drop(requests);

    // A GitLab without these fields answers with errors only.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"errors":[{"message":"Field 'notes' doesn't exist"}]}"#,
        "",
    )]);
    assert_eq!(
        runtime()
            .block_on(fetch(&Client::new(), &fixture.url(), &query))
            .unwrap_err()
            .code,
        "UNSUPPORTED"
    );
    let invalid = Query::NoteAwards {
        project_path: "group/app".to_owned(),
        iid: "9".to_owned(),
        since_note_id: "abc".to_owned(),
    };
    assert_eq!(
        runtime()
            .block_on(fetch(&Client::new(), &fixture.url(), &invalid))
            .unwrap_err()
            .code,
        "INVALID_INPUT"
    );
}

#[test]
fn comment_reactions_beyond_the_page_limit_are_marked_truncated() {
    let page = r#"{"data":{"project":{"mergeRequest":{"notes":{"pageInfo":{"hasPreviousPage":true,"startCursor":"c"},"nodes":[{"id":"gid://gitlab/Note/900","awardEmoji":{"nodes":[]}}]}}}}}"#;
    let fixture = Fixture::new(vec![response("200 OK", page, ""); MAX_NOTE_AWARD_PAGES]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::NoteAwards {
                project_path: "group/app".to_owned(),
                iid: "9".to_owned(),
                since_note_id: "1".to_owned(),
            },
        ))
        .unwrap();
    assert!(result.truncated);
    assert_eq!(fixture.requests.lock().unwrap().len(), MAX_NOTE_AWARD_PAGES);
}

#[test]
fn adding_a_reaction_checks_it_is_not_already_given() {
    let action = Action::AddAward {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        note_id: Some("77".to_owned()),
        name: "tada".to_owned(),
    };
    let fixture = Fixture::new(vec![
        response(
            "200 OK",
            r#"[{"id":3,"name":"tada","user":{"id":8,"username":"bob","name":"Bob"}}]"#,
            "",
        ),
        response(
            "201 Created",
            r#"{"id":4,"name":"tada","user":{"id":7}}"#,
            "",
        ),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(
        requests[0].starts_with("GET /api/v4/projects/42/merge_requests/9/notes/77/award_emoji?")
    );
    assert!(
        requests[1].starts_with("POST /api/v4/projects/42/merge_requests/9/notes/77/award_emoji ")
    );
    assert!(requests[1].ends_with(r#"{"name":"tada"}"#));
    drop(requests);

    // Already given by this user: nothing is written.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":3,"name":"tada","user":{"id":7,"username":"alice","name":"Alice"}}]"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn removing_a_reaction_deletes_only_the_users_own_award() {
    let action = Action::RemoveAward {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        note_id: None,
        name: "thumbsup".to_owned(),
    };
    let fixture = Fixture::new(vec![
        response(
            "200 OK",
            r#"[{"id":3,"name":"thumbsup","user":{"id":8}},{"id":5,"name":"thumbsup","user":{"id":7}}]"#,
            "",
        ),
        response("204 No Content", "", ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /api/v4/projects/42/merge_requests/9/award_emoji?"));
    assert!(requests[1].starts_with("DELETE /api/v4/projects/42/merge_requests/9/award_emoji/5 "));
    drop(requests);

    // Not given by this user (any more): nothing is deleted.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":3,"name":"thumbsup","user":{"id":8}}]"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    for name in ["", "Thumbsup", ":smile:", "a/b"] {
        let invalid = Action::AddAward {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            note_id: None,
            name: name.to_owned(),
        };
        assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
    }
    assert!(validate_award_name("+1").is_ok());
    assert!(validate_award_name("flag_jp").is_ok());
}

#[test]
fn todo_is_marked_done_only_when_gitlab_lists_it_for_that_merge_request() {
    let action = Action::MarkTodoDone {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        todo_id: "102".to_owned(),
    };
    let pending = r#"[{"id":101,"target_type":"MergeRequest","target":{"iid":8},"project":{"id":42}},{"id":102,"target_type":"MergeRequest","target":{"iid":9},"project":{"id":42}}]"#;
    let fixture = Fixture::new(vec![
        response("200 OK", pending, ""),
        response("201 Created", r#"{"id":102,"state":"done"}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /api/v4/todos?"));
    for param in [
        "type=MergeRequest",
        "state=pending",
        "project_id=42",
        "per_page=100",
    ] {
        assert!(requests[0].contains(param), "{param}");
    }
    assert!(requests[1].starts_with("POST /api/v4/todos/102/mark_as_done "));
    drop(requests);

    // Another MR's To-Do, or one no longer pending: nothing is written.
    for listed in [
        r#"[{"id":102,"target_type":"MergeRequest","target":{"iid":8},"project":{"id":42}}]"#,
        r#"[{"id":102,"target_type":"Issue","target":{"iid":9},"project":{"id":42}}]"#,
        "[]",
    ] {
        let fixture = Fixture::new(vec![response("200 OK", listed, "")]);
        let error = runtime()
            .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
            .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");
        assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    }
    let invalid = Action::MarkTodoDone {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        todo_id: "todo-1".to_owned(),
    };
    assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
}

#[test]
fn mr_pipelines_are_project_scoped_pages_with_the_running_project() {
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"[{"id":77,"iid":5,"project_id":8,"sha":"959e04d7c7a30600c894bd3c0cd0e1ce7f42c11d","ref":"refs/merge-requests/9/head","status":"running","source":"merge_request_event","created_at":"2026-10-01T09:00:00.000Z","updated_at":"2026-10-01T09:01:00.000Z","web_url":"https://gitlab.example/g/p/-/pipelines/77"},{"id":70,"sha":"a","ref":"main","status":"success"}]"#,
        "X-Next-Page: 2\r\n",
    )]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::MrPipelines {
                project_id: "7".to_owned(),
                iid: "9".to_owned(),
                page: 1,
            },
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0]
        .starts_with("GET /api/v4/projects/7/merge_requests/9/pipelines?page=1&per_page=30 "));
    assert_eq!(result.next_page, Some(2));
    assert_eq!(result.data[0]["id"], "77");
    assert_eq!(result.data[0]["projectId"], "8");
    assert_eq!(result.data[0]["status"], "running");
    assert_eq!(result.data[0]["createdAt"], "2026-10-01T09:00:00.000Z");
    // The list omits duration; a missing field is null, not zero.
    assert_eq!(result.data[1]["projectId"], Value::Null);
    assert_eq!(result.data[1]["duration"], Value::Null);

    let detail = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":77,"project_id":8,"status":"failed","ref":"main","sha":"b","duration":34.5,"started_at":"2026-10-01T09:00:10.000Z","finished_at":"2026-10-01T09:00:45.000Z"}"#,
        "",
    )]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &detail.url(),
            &Query::Pipeline {
                project_id: "8".to_owned(),
                pipeline_id: "77".to_owned(),
            },
        ))
        .unwrap();
    assert!(detail.requests.lock().unwrap()[0].starts_with("GET /api/v4/projects/8/pipelines/77 "));
    assert_eq!(result.data["duration"], 34.5);
    assert_eq!(result.data["finishedAt"], "2026-10-01T09:00:45.000Z");

    let invalid = Query::Pipeline {
        project_id: "8".to_owned(),
        pipeline_id: "../1".to_owned(),
    };
    assert_eq!(
        build_query_url(&fixture.url(), &invalid).unwrap_err().code,
        "INVALID_INPUT"
    );
}

#[test]
fn pipeline_jobs_read_every_page_then_trigger_jobs() {
    let fixture = Fixture::routed(vec![
        (
            "/jobs?page=1&",
            response(
                "200 OK",
                r#"[{"id":902,"name":"test","stage":"test","status":"failed","allow_failure":false,"duration":12.5,"failure_reason":"script_failure","web_url":"https://gitlab.example/j/902"}]"#,
                "X-Next-Page: 2\r\n",
            ),
        ),
        (
            "/jobs?page=2&",
            response(
                "200 OK",
                r#"[{"id":901,"name":"build","stage":"build","status":"success"}]"#,
                "",
            ),
        ),
        (
            "/bridges?page=1&",
            response(
                "200 OK",
                r#"[{"id":903,"name":"deploy","stage":"deploy","status":"running","downstream_pipeline":{"id":88,"status":"running","web_url":"https://gitlab.example/other/-/pipelines/88"}}]"#,
                "",
            ),
        ),
    ]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::PipelineJobs {
                project_id: "7".to_owned(),
                pipeline_id: "77".to_owned(),
            },
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    // Jobs and trigger jobs are read side by side; the job pages in order.
    let at = |line: &str| {
        requests
            .iter()
            .position(|request| request.starts_with(line))
            .unwrap()
    };
    assert!(
        at("GET /api/v4/projects/7/pipelines/77/jobs?page=1&per_page=100 ")
            < at("GET /api/v4/projects/7/pipelines/77/jobs?page=2&per_page=100 ")
    );
    at("GET /api/v4/projects/7/pipelines/77/bridges?page=1&per_page=100 ");
    assert!(!result.truncated);
    let jobs = result.data.as_array().unwrap();
    assert_eq!(jobs.len(), 3);
    assert_eq!(jobs[0]["kind"], "job");
    assert_eq!(jobs[0]["failureReason"], "script_failure");
    assert_eq!(jobs[0]["duration"], 12.5);
    assert_eq!(jobs[2]["kind"], "bridge");
    assert_eq!(jobs[2]["downstreamPipeline"]["id"], "88");
    assert_eq!(jobs[2]["downstreamPipeline"]["status"], "running");
    drop(requests);

    // A server that removed `bridges` lists them as `trigger_jobs`.
    let fixture = Fixture::routed(vec![
        ("/jobs?", response("200 OK", "[]", "")),
        ("/bridges?", response("404 Not Found", "{}", "")),
        ("/trigger_jobs?", response("200 OK", "[]", "")),
    ]);
    runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::PipelineJobs {
                project_id: "7".to_owned(),
                pipeline_id: "77".to_owned(),
            },
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    let at = |line: &str| {
        requests
            .iter()
            .position(|request| request.starts_with(line))
            .unwrap()
    };
    assert!(
        at("GET /api/v4/projects/7/pipelines/77/bridges?page=1&per_page=100 ")
            < at("GET /api/v4/projects/7/pipelines/77/trigger_jobs?page=1&per_page=100 ")
    );
}

#[test]
fn job_trace_keeps_the_end_and_requests_only_the_tail() {
    let log = "section_start:1700000000:prepare[collapsed=true]\r\u{1b}[0K\u{1b}[36;1mPreparing\u{1b}[0;m\n\u{1b}[32;1m$ npm test\u{1b}[0;m\nprogress 10%\rprogress 100%\n\u{7}bell\u{1b}]8;;https://x\u{7}link\n\u{1b}[0Ksection_end:1700000001:prepare\r\u{1b}[0K\n\u{1b}[31mERROR\u{1b}[39m done\n";
    let fixture = Fixture::new(vec![format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{log}",
        log.len()
    )]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::JobTrace {
                project_id: "7".to_owned(),
                job_id: "900".to_owned(),
            },
        ))
        .unwrap();
    let request = fixture.requests.lock().unwrap()[0].to_lowercase();
    assert!(request.starts_with("get /api/v4/projects/7/jobs/900/trace "));
    assert!(request.contains(&format!("range: bytes=-{MAX_TRACE_BYTES}")));
    assert!(request.contains("accept-encoding: identity"));
    assert_eq!(result.data["headOmitted"], false);
    assert_eq!(result.data["omittedLines"], 0);
    assert_eq!(
        result.data["lines"],
        json!([
            [{"text": "Preparing", "fg": "cyan", "bold": true}],
            [{"text": "$ npm test", "fg": "green", "bold": true}],
            [{"text": "progress 100%"}],
            [{"text": "belllink"}],
            [{"text": "ERROR", "fg": "red"}, {"text": " done"}],
        ])
    );

    // A server that honours the range says where the part starts.
    let fixture = Fixture::new(vec![
        "HTTP/1.1 206 Partial Content\r\nContent-Length: 15\r\nContent-Range: bytes 4000-4014/4015\r\nConnection: close\r\n\r\ntail\nlast line\n".to_owned(),
    ]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::JobTrace {
                project_id: "7".to_owned(),
                job_id: "900".to_owned(),
            },
        ))
        .unwrap();
    assert_eq!(result.data["headOmitted"], true);
    // The start was not sent, so where the kept lines sit is unknown.
    assert_eq!(result.data["omittedLines"], Value::Null);
    assert!(result.truncated);
    // The partial first line is dropped.
    assert_eq!(result.data["lines"], json!([[{"text": "last line"}]]));
}

#[test]
fn job_trace_from_a_server_without_ranges_keeps_only_the_bounded_end() {
    // A line left empty by its section marker is not a display line.
    let mut log = String::from("first line\nsection_start:1700000000:build\r\u{1b}[0K\n");
    // Over twice the kept size, so the start is also dropped while reading.
    while log.len() < 3 * MAX_TRACE_BYTES {
        log.push_str("filler line of the job log\n");
    }
    log.push_str("the end\n");
    let (bytes, dropped, omitted_lines) = {
        let fixture = Fixture::new(vec![format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{log}",
            log.len()
        )]);
        runtime()
            .block_on(get_trace_tail(
                &Client::new(),
                &fixture.url().join("trace").unwrap(),
            ))
            .unwrap()
    };
    assert!(dropped);
    assert_eq!(bytes.len(), MAX_TRACE_BYTES);
    let (lines, head_omitted, trimmed) = render_trace(&bytes, dropped);
    assert!(head_omitted);
    assert_eq!(trimmed, 0);
    // The dropped display lines and the kept ones make up the whole log.
    assert_eq!(
        omitted_lines.unwrap() + lines.len() as u64,
        log.lines().count() as u64 - 1
    );
    assert_eq!(lines.last().unwrap(), &json!([{"text": "the end"}]));
    assert_ne!(lines.first().unwrap(), &json!([{"text": "first line"}]));

    // An empty log cannot satisfy a suffix range.
    let fixture = Fixture::new(vec![response("416 Range Not Satisfiable", "", "")]);
    let (bytes, dropped, omitted_lines) = runtime()
        .block_on(get_trace_tail(&Client::new(), &fixture.url()))
        .unwrap();
    assert!(bytes.is_empty() && !dropped);
    assert_eq!(omitted_lines, Some(0));
}

#[test]
fn trace_rendering_drops_controls_and_keeps_colour_across_lines() {
    let (lines, _, _) = render_trace(
        "\u{1b}[1;33mwarn\nstill\u{1b}[22m plain\u{1b}[0m\n\u{1b}[38;5;196mred?\u{1b}[0m\ttab\u{0}\u{8}\u{9b}x\n".as_bytes(),
        false,
    );
    assert_eq!(
        lines,
        vec![
            json!([{"text": "warn", "fg": "yellow", "bold": true}]),
            json!([{"text": "still", "fg": "yellow", "bold": true}, {"text": " plain", "fg": "yellow"}]),
            json!([{"text": "red?\ttabx"}]),
        ]
    );
    let (line, found) = remove_section_markers("a section_start:x b section_end:12:n-1.c[x] c");
    assert!(found);
    assert_eq!(line, "a section_start:x b  c");
}

fn ci_action(kind: &str) -> Action {
    let value = json!({"kind": kind, "projectId": "7", "iid": "9", "pipelineProjectId": "8", "jobId": "900", "pipelineId": "77"});
    let mut object = value.as_object().unwrap().clone();
    if kind.ends_with("Pipeline") {
        object.remove("jobId");
    } else {
        object.remove("pipelineId");
    }
    serde_json::from_value(Value::Object(object)).unwrap()
}

#[test]
fn job_and_pipeline_operations_check_the_current_state_then_post_once() {
    for (kind, current, path) in [
        (
            "retryJob",
            r#"{"id":900,"status":"failed"}"#,
            "/projects/8/jobs/900/retry ",
        ),
        (
            "cancelJob",
            r#"{"id":900,"status":"running"}"#,
            "/projects/8/jobs/900/cancel ",
        ),
        (
            "playJob",
            r#"{"id":900,"status":"manual"}"#,
            "/projects/8/jobs/900/play ",
        ),
        (
            "retryPipeline",
            r#"{"id":77,"status":"canceled"}"#,
            "/projects/8/pipelines/77/retry ",
        ),
        (
            "cancelPipeline",
            r#"{"id":77,"status":"pending"}"#,
            "/projects/8/pipelines/77/cancel ",
        ),
    ] {
        let fixture = Fixture::new(vec![
            response("200 OK", current, ""),
            response("201 Created", r#"{"id":901,"status":"pending"}"#, ""),
        ]);
        runtime()
            .block_on(mutate(
                &Client::new(),
                &fixture.url(),
                &ci_action(kind),
                "42",
            ))
            .unwrap();
        let requests = fixture.requests.lock().unwrap();
        assert!(requests[0].starts_with("GET "), "{kind}");
        assert!(requests[1].starts_with("POST "), "{kind}");
        assert!(requests[1].contains(path), "{kind}");
    }
}

#[test]
fn job_and_pipeline_operations_refuse_a_state_that_changed() {
    for (kind, current) in [
        ("cancelJob", r#"{"id":900,"status":"success"}"#),
        ("retryJob", r#"{"id":900,"status":"running"}"#),
        (
            "retryJob",
            r#"{"id":900,"status":"failed","archived":true}"#,
        ),
        ("playJob", r#"{"id":900,"status":"success"}"#),
        ("retryPipeline", r#"{"id":77,"status":"running"}"#),
        ("cancelPipeline", r#"{"id":77,"status":"failed"}"#),
    ] {
        let fixture = Fixture::new(vec![response("200 OK", current, "")]);
        let error = runtime()
            .block_on(mutate(
                &Client::new(),
                &fixture.url(),
                &ci_action(kind),
                "42",
            ))
            .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT", "{kind}");
        // Nothing is written.
        assert_eq!(fixture.requests.lock().unwrap().len(), 1, "{kind}");
    }

    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":900,"status":"failed"}"#, ""),
        response("403 Forbidden", r#"{"message":"403 Forbidden"}"#, ""),
    ]);
    let error = runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &ci_action("retryJob"),
            "42",
        ))
        .unwrap_err();
    assert_eq!(error.code, "FORBIDDEN");
    assert_eq!(error.message, CI_FORBIDDEN_MESSAGE);

    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":77,"status":"running"}"#, ""),
        response("502 Bad Gateway", "", ""),
    ]);
    let error = runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &ci_action("cancelPipeline"),
            "42",
        ))
        .unwrap_err();
    assert_eq!(error.code, "UNKNOWN_OUTCOME");
    assert_eq!(fixture.requests.lock().unwrap().len(), 2);

    let mut invalid = ci_action("retryJob");
    if let Action::RetryJob { job_id, .. } = &mut invalid {
        *job_id = "0".to_owned();
    }
    assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
    assert_eq!(
        action_project_and_iid(&ci_action("cancelPipeline")),
        ("7", "9")
    );
}

fn head_response() -> String {
    response(
        "200 OK",
        &format!(r#"{{"id":1,"diff_refs":{{"head_sha":"{HEAD_SHA}"}}}}"#),
        "",
    )
}

fn request_body(request: &str) -> Value {
    serde_json::from_str(&request[request.find("\r\n\r\n").unwrap() + 4..]).unwrap()
}

fn merge_action(auto_merge: bool) -> Action {
    Action::Merge {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        sha: HEAD_SHA.to_owned(),
        squash: !auto_merge,
        remove_source_branch: auto_merge,
        merge_commit_message: (!auto_merge).then(|| "Merge feature".to_owned()),
        auto_merge,
    }
}

#[test]
fn merge_sends_the_seen_head_and_asks_every_version_to_wait_for_checks() {
    let fixture = Fixture::new(vec![
        head_response(),
        response(
            "200 OK",
            r#"{"id":1,"state":"opened","merge_when_pipeline_succeeds":true}"#,
            "",
        ),
    ]);
    runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &merge_action(true),
            "7",
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /api/v4/projects/42/merge_requests/9 "));
    assert!(requests[1].starts_with("PUT /api/v4/projects/42/merge_requests/9/merge "));
    assert_eq!(
        request_body(&requests[1]),
        json!({"sha": HEAD_SHA, "should_remove_source_branch": true, "auto_merge": true, "merge_when_pipeline_succeeds": true})
    );
    drop(requests);

    let fixture = Fixture::new(vec![
        head_response(),
        response("200 OK", r#"{"id":1,"state":"merged"}"#, ""),
    ]);
    runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &merge_action(false),
            "7",
        ))
        .unwrap();
    assert_eq!(
        request_body(&fixture.requests.lock().unwrap()[1]),
        json!({"sha": HEAD_SHA, "should_remove_source_branch": false, "squash": true, "merge_commit_message": "Merge feature"})
    );

    // GitLab answered without merging or setting auto-merge.
    let fixture = Fixture::new(vec![
        head_response(),
        response("200 OK", r#"{"id":1,"state":"opened"}"#, ""),
    ]);
    let error = runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &merge_action(false),
            "7",
        ))
        .unwrap_err();
    assert_eq!(error.code, "UNSUPPORTED");
}

#[test]
fn merge_is_refused_before_sending_when_the_head_moved_and_reports_refusals() {
    let moved = response(
        "200 OK",
        r#"{"id":1,"diff_refs":{"head_sha":"fedcba9876543210fedcba9876543210fedcba98"}}"#,
        "",
    );
    let fixture = Fixture::new(vec![moved]);
    let error = runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &merge_action(false),
            "7",
        ))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    // GitLab answers 401 to a user who may not merge; the session stays.
    for (status, code) in [
        ("401 Unauthorized", "FORBIDDEN"),
        ("405 Method Not Allowed", "INVALID_INPUT"),
        ("409 Conflict", "INVALID_INPUT"),
        ("422 Unprocessable Entity", "INVALID_INPUT"),
    ] {
        let fixture = Fixture::new(vec![head_response(), response(status, "{}", "")]);
        let error = runtime()
            .block_on(mutate(
                &Client::new(),
                &fixture.url(),
                &merge_action(false),
                "7",
            ))
            .unwrap_err();
        assert_eq!(error.code, code, "{status}");
    }
    let invalid = Action::Merge {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        sha: HEAD_SHA.to_owned(),
        squash: false,
        remove_source_branch: false,
        merge_commit_message: Some(" ".to_owned()),
        auto_merge: false,
    };
    assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
}

#[test]
fn cancelling_auto_merge_reads_the_status_gitlab_returns_instead_of_the_mr() {
    let action = Action::CancelAutoMerge {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
    };
    let set = || {
        response(
            "200 OK",
            r#"{"id":1,"merge_when_pipeline_succeeds":true}"#,
            "",
        )
    };
    let fixture = Fixture::new(vec![
        set(),
        response("201 Created", r#"{"status":"success"}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    assert!(fixture.requests.lock().unwrap()[1].starts_with(
        "POST /api/v4/projects/42/merge_requests/9/cancel_merge_when_pipeline_succeeds "
    ));

    let fixture = Fixture::new(vec![
        set(),
        response(
            "201 Created",
            r#"{"status":"error","message":"Can't cancel the automatic merge","http_status":406}"#,
            "",
        ),
    ]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");

    let fixture = Fixture::new(vec![set(), response("201 Created", "{}", "")]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "UNKNOWN_OUTCOME");

    // Not set to auto-merge any more: nothing is sent.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"merge_when_pipeline_succeeds":false}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn rebase_is_confirmed_by_gitlab_accepting_it_for_the_background() {
    let action = Action::Rebase {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        sha: HEAD_SHA.to_owned(),
    };
    let fixture = Fixture::new(vec![
        head_response(),
        response("202 Accepted", r#"{"rebase_in_progress":true}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    assert!(fixture.requests.lock().unwrap()[1]
        .starts_with("PUT /api/v4/projects/42/merge_requests/9/rebase "));

    for (status, body, code) in [
        (
            "200 OK",
            r#"{"rebase_in_progress":true}"#,
            "UNKNOWN_OUTCOME",
        ),
        ("202 Accepted", "{}", "UNKNOWN_OUTCOME"),
        ("403 Forbidden", "{}", "FORBIDDEN"),
        ("409 Conflict", "{}", "INVALID_INPUT"),
    ] {
        let fixture = Fixture::new(vec![head_response(), response(status, body, "")]);
        let error = runtime()
            .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
            .unwrap_err();
        assert_eq!(error.code, code, "{status} {body}");
        assert_eq!(fixture.requests.lock().unwrap().len(), 2);
    }
}

#[test]
fn closing_and_reopening_require_the_state_the_user_saw_and_check_the_result() {
    let close = Action::SetState {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        state_event: StateEvent::Close,
    };
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"state":"opened"}"#, ""),
        response("200 OK", r#"{"id":1,"state":"closed"}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &close, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[1].starts_with("PUT /api/v4/projects/42/merge_requests/9 "));
    assert_eq!(request_body(&requests[1]), json!({"state_event": "close"}));
    drop(requests);

    let reopen = Action::SetState {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        state_event: StateEvent::Reopen,
    };
    // Already reopened elsewhere: nothing is sent.
    let fixture = Fixture::new(vec![response("200 OK", r#"{"id":1,"state":"opened"}"#, "")]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &reopen, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    // GitLab accepted the update but kept the MR closed.
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"state":"closed"}"#, ""),
        response("200 OK", r#"{"id":1,"state":"closed"}"#, ""),
    ]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &reopen, "7"))
        .unwrap_err();
    assert_eq!(error.code, "UNSUPPORTED");
}

#[test]
fn title_changes_only_when_gitlab_still_has_the_edited_title() {
    let action = Action::SetTitle {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        title: "Draft: 新しいタイトル".to_owned(),
        expected_title: "新しいタイトル".to_owned(),
    };
    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"title":"新しいタイトル"}"#, ""),
        response("200 OK", r#"{"id":1,"title":"Draft: 新しいタイトル"}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    assert_eq!(
        request_body(&fixture.requests.lock().unwrap()[1]),
        json!({"title": "Draft: 新しいタイトル"})
    );

    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"title":"別の人の変更"}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    for title in ["", "  ", "two\nlines", &"x".repeat(256)] {
        let invalid = Action::SetTitle {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            title: title.to_owned(),
            expected_title: String::new(),
        };
        assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
    }
}

#[test]
fn labels_send_only_the_difference_and_check_what_gitlab_saved() {
    let action = Action::SetLabels {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        add_labels: vec!["bug".to_owned(), "needs review".to_owned()],
        remove_labels: vec!["wip".to_owned()],
    };
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"labels":["bug","needs review","someone else's"]}"#,
        "",
    )]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("PUT /api/v4/projects/42/merge_requests/9 "));
    assert_eq!(
        request_body(&requests[0]),
        json!({"add_labels": "bug,needs review", "remove_labels": "wip"})
    );
    drop(requests);

    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"labels":["bug","wip"]}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "UNSUPPORTED");

    for (add, remove) in [
        (vec![], vec![]),
        (vec!["a,b"], vec![]),
        (vec!["bug"], vec!["bug"]),
    ] {
        let invalid = Action::SetLabels {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            add_labels: add.into_iter().map(str::to_owned).collect(),
            remove_labels: remove.into_iter().map(str::to_owned).collect(),
        };
        assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
    }
}

#[test]
fn milestone_changes_require_the_seen_milestone_and_clear_with_zero() {
    let clear = Action::SetMilestone {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        milestone_id: None,
        expected_milestone_id: Some("5".to_owned()),
    };
    let fixture = Fixture::new(vec![
        response(
            "200 OK",
            r#"{"id":1,"milestone":{"id":5,"title":"v1"}}"#,
            "",
        ),
        response("200 OK", r#"{"id":1,"milestone":null}"#, ""),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &clear, "7"))
        .unwrap();
    assert_eq!(
        request_body(&fixture.requests.lock().unwrap()[1]),
        json!({"milestone_id": 0})
    );

    let set = Action::SetMilestone {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        milestone_id: Some("6".to_owned()),
        expected_milestone_id: None,
    };
    // Someone set a milestone meanwhile: nothing is sent.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"id":1,"milestone":{"id":5,"title":"v1"}}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &set, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    let fixture = Fixture::new(vec![
        response("200 OK", r#"{"id":1,"milestone":null}"#, ""),
        response(
            "200 OK",
            r#"{"id":1,"milestone":{"id":6,"title":"v2"}}"#,
            "",
        ),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &set, "7"))
        .unwrap();
    assert_eq!(
        request_body(&fixture.requests.lock().unwrap()[1]),
        json!({"milestone_id": 6})
    );
}

#[test]
fn review_requests_use_graphql_with_values_as_variables_after_checking_the_project_path() {
    let merge_request = || {
        response(
            "200 OK",
            r#"{"id":1,"references":{"full":"group/app!9"},"reviewers":[{"id":8}]}"#,
            "",
        )
    };
    let request_changes = Action::RequestChanges {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        project_path: "group/app".to_owned(),
    };
    let fixture = Fixture::new_at_path(
        vec![
            merge_request(),
            response(
                "200 OK",
                r#"{"data":{"mergeRequestRequestChanges":{"errors":[],"mergeRequest":{"id":"gid://gitlab/MergeRequest/1"}}}}"#,
                "",
            ),
        ],
        "/GitLab/api/v4/",
    );
    runtime()
        .block_on(mutate(
            &Client::new(),
            &fixture.url(),
            &request_changes,
            "7",
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[1].starts_with("POST /GitLab/api/graphql "));
    let body = request_body(&requests[1]);
    assert!(body["query"]
        .as_str()
        .unwrap()
        .contains("mergeRequestRequestChanges"));
    assert!(!body["query"].as_str().unwrap().contains("group/app"));
    assert_eq!(
        body["variables"],
        json!({"projectPath": "group/app", "iid": "9"})
    );
    drop(requests);

    let rerequest = |user_id: &str| Action::RerequestReview {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        project_path: "group/app".to_owned(),
        user_id: user_id.to_owned(),
    };
    let fixture = Fixture::new(vec![
        merge_request(),
        response(
            "200 OK",
            r#"{"data":{"mergeRequestReviewerRereview":{"errors":[],"mergeRequest":{"id":"gid://gitlab/MergeRequest/1"}}}}"#,
            "",
        ),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &rerequest("8"), "7"))
        .unwrap();
    assert_eq!(
        request_body(&fixture.requests.lock().unwrap()[1])["variables"]["userId"],
        "gid://gitlab/User/8"
    );

    // No longer a reviewer, or another project at that path: nothing is sent.
    for (current, action) in [
        (merge_request(), rerequest("5")),
        (
            response(
                "200 OK",
                r#"{"id":1,"references":{"full":"group/other!9"}}"#,
                "",
            ),
            request_changes.clone(),
        ),
    ] {
        let fixture = Fixture::new(vec![current]);
        let error = runtime()
            .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
            .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");
        assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    }

    for (body, code) in [
        // Older GitLab: the schema has no such mutation.
        (
            r#"{"errors":[{"message":"Field 'mergeRequestRequestChanges' doesn't exist on type 'Mutation'"}]}"#,
            "UNSUPPORTED",
        ),
        (
            r#"{"data":{"mergeRequestRequestChanges":{"errors":["Reviewer not found"],"mergeRequest":{"id":"1"}}}}"#,
            "UNSUPPORTED",
        ),
        (r#"{"data":{}}"#, "UNKNOWN_OUTCOME"),
    ] {
        let fixture = Fixture::new(vec![merge_request(), response("200 OK", body, "")]);
        let error = runtime()
            .block_on(mutate(
                &Client::new(),
                &fixture.url(),
                &request_changes,
                "7",
            ))
            .unwrap_err();
        assert_eq!(error.code, code, "{body}");
        assert!(!error.message.contains("Reviewer not found"));
    }
}

#[test]
fn merge_request_carries_what_the_merge_controls_need() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let (url, _) = build_query_url(
        &api,
        &Query::Mr {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
        },
    )
    .unwrap();
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(
        params.get("include_diverged_commits_count").unwrap(),
        "true"
    );
    assert_eq!(params.get("include_rebase_in_progress").unwrap(), "true");

    let user = json!({"id": 7, "username": "alice", "name": "Alice"});
    let mut mr = json!({"id": 11, "iid": 3, "project_id": 2, "title": "Review", "state": "opened", "author": user});
    let normalized = normalize_merge_request(&mr).unwrap();
    assert!(normalized["detailedMergeStatus"].is_null());
    assert!(normalized["canMerge"].is_null());
    assert!(normalized["milestone"].is_null());
    mr["detailed_merge_status"] = "ci_still_running".into();
    mr["merge_status"] = "can_be_merged".into();
    mr["has_conflicts"] = false.into();
    mr["blocking_discussions_resolved"] = true.into();
    mr["squash"] = false.into();
    mr["squash_on_merge"] = true.into();
    mr["force_remove_source_branch"] = true.into();
    mr["merge_when_pipeline_succeeds"] = false.into();
    mr["rebase_in_progress"] = false.into();
    mr["diverged_commits_count"] = 2.into();
    mr["user"] = json!({"can_merge": true});
    mr["milestone"] = json!({"id": 5, "iid": 1, "title": "v1.0", "state": "active", "due_date": "2026-11-01", "web_url": "https://gitlab.example/m/1"});
    let normalized = normalize_merge_request(&mr).unwrap();
    assert_eq!(normalized["detailedMergeStatus"], "ci_still_running");
    assert_eq!(normalized["squashOnMerge"], true);
    assert_eq!(normalized["forceRemoveSourceBranch"], true);
    assert_eq!(normalized["autoMerge"], false);
    assert_eq!(normalized["divergedCommitsCount"], 2);
    assert_eq!(normalized["canMerge"], true);
    assert_eq!(normalized["milestone"]["id"], "5");
    assert_eq!(normalized["milestone"]["title"], "v1.0");
    assert_eq!(normalized["milestone"]["dueDate"], "2026-11-01");
    mr["milestone"] = json!("v1.0");
    assert!(normalize_merge_request(&mr).is_err());
}

#[test]
fn label_and_milestone_candidates_include_ancestor_groups() {
    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let (url, kind) = build_query_url(
        &api,
        &Query::Labels {
            project_id: "42".to_owned(),
            search: "bu".to_owned(),
            page: 1,
        },
    )
    .unwrap();
    assert_eq!(url.path(), "/api/v4/projects/42/labels");
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("include_ancestor_groups").unwrap(), "true");
    assert_eq!(params.get("search").unwrap(), "bu");
    assert_eq!(params.get("per_page").unwrap(), "100");
    let labels = normalize_response(
        kind,
        json!([
            {"id": 1, "name": "bug", "color": "#dc143c", "text_color": "#FFFFFF", "description": null},
            {"id": 2, "name": "odd", "color": "red; background: url(x)"},
        ]),
    )
    .unwrap();
    assert_eq!(labels[0]["color"], "#dc143c");
    assert_eq!(labels[0]["description"], "");
    assert!(labels[1]["color"].is_null());

    let (url, kind) = build_query_url(
        &api,
        &Query::Milestones {
            project_id: "42".to_owned(),
            search: String::new(),
            page: 2,
        },
    )
    .unwrap();
    assert_eq!(url.path(), "/api/v4/projects/42/milestones");
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(params.get("state").unwrap(), "active");
    assert_eq!(params.get("include_parent_milestones").unwrap(), "true");
    assert!(!params.contains_key("include_ancestors"));
    assert!(!params.contains_key("search"));
    let milestones = normalize_response(
        kind,
        json!([{"id": 5, "title": "v1.0", "state": "active", "due_date": null}]),
    )
    .unwrap();
    assert_eq!(milestones[0]["id"], "5");
    assert!(milestones[0]["dueDate"].is_null());
    assert!(build_query_url(
        &api,
        &Query::Labels {
            project_id: "x".to_owned(),
            search: String::new(),
            page: 1,
        },
    )
    .is_err());
}

fn range_position(start: LineRangePoint, end: LineRangePoint) -> Position {
    Position {
        base_sha: HEAD_SHA.to_owned(),
        start_sha: HEAD_SHA.to_owned(),
        head_sha: HEAD_SHA.to_owned(),
        old_path: "src/a.ts".to_owned(),
        new_path: "src/a.ts".to_owned(),
        old_line: end.old_line,
        new_line: end.new_line,
        position_type: PositionType::Text,
        line_range: Some(LineRange {
            start,
            end,
            hunk: crate::dto::DiffHunk {
                old_start: 10,
                old_count: 4,
                new_start: 10,
                new_count: 6,
            },
        }),
    }
}

fn point(old_line: Option<u32>, new_line: Option<u32>, old: u32, new: u32) -> LineRangePoint {
    LineRangePoint {
        old_line,
        new_line,
        old_position: old,
        new_position: new,
    }
}

#[test]
fn line_codes_hash_the_file_path_and_count_both_sides() {
    assert_eq!(sha1_hex(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    assert_eq!(sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    assert_eq!(
        sha1_hex(&[b'a'; 1000]),
        "291e9a6c66994949b57ba5e650361e98fc36b1ba"
    );
    // From a context line to an added line: the added line counts the old side's next line.
    let position = range_position(
        point(Some(11), Some(11), 11, 11),
        point(None, Some(13), 12, 13),
    );
    assert!(validate_position(&position).is_ok());
    let value = position_to_api_value(&position);
    let hash = sha1_hex(b"src/a.ts");
    assert_eq!(
        value["line_range"],
        json!({
            "start": {"line_code": format!("{hash}_11_11"), "type": "old", "old_line": 11, "new_line": 11},
            "end": {"line_code": format!("{hash}_12_13"), "type": "new", "new_line": 13},
        })
    );
    assert_eq!(value["new_line"], 13);
    assert!(value.get("old_line").is_none());
}

#[test]
fn line_ranges_must_stay_in_one_hunk_and_end_at_the_commented_line() {
    let valid = range_position(point(Some(10), None, 10, 10), point(None, Some(12), 11, 12));
    assert!(validate_position(&valid).is_ok());
    let invalid = [
        // Starts after it ends.
        range_position(point(None, Some(12), 11, 12), point(Some(10), None, 10, 10)),
        // Starts in an earlier hunk.
        range_position(point(Some(3), Some(3), 3, 3), point(None, Some(12), 11, 12)),
        // A shown number that is not the line's own position.
        range_position(
            point(Some(10), Some(9), 10, 10),
            point(None, Some(12), 11, 12),
        ),
        // A line without numbers.
        range_position(point(None, None, 10, 10), point(None, Some(12), 11, 12)),
    ];
    for position in invalid {
        assert_eq!(
            validate_position(&position).unwrap_err().code,
            "INVALID_INPUT"
        );
    }
    let mut elsewhere = valid.clone();
    elsewhere.new_line = Some(13);
    assert_eq!(
        validate_position(&elsewhere).unwrap_err().code,
        "INVALID_INPUT"
    );
}

#[test]
fn multi_line_comment_checks_refs_then_posts_line_codes_once() {
    let refs = format!(
        r#"{{"diff_refs":{{"base_sha":"{HEAD_SHA}","start_sha":"{HEAD_SHA}","head_sha":"{HEAD_SHA}"}}}}"#
    );
    let fixture = Fixture::new(vec![
        response("200 OK", &refs, ""),
        response("201 Created", r#"{"id":"abc123"}"#, ""),
    ]);
    let action = Action::SaveDraft {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        body: "この3行をまとめてください".to_owned(),
        discussion_id: None,
        position: Some(range_position(
            point(Some(11), Some(11), 11, 11),
            point(None, Some(13), 12, 13),
        )),
    };
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].starts_with("GET /api/v4/projects/42/merge_requests/9 "));
    assert!(requests[1].starts_with("POST /api/v4/projects/42/merge_requests/9/draft_notes "));
    let raw = &requests[1];
    let body: Value = serde_json::from_str(&raw[raw.find("{\"note\"").unwrap()..]).unwrap();
    let hash = sha1_hex(b"src/a.ts");
    assert_eq!(
        body["position"]["line_range"]["start"]["line_code"],
        format!("{hash}_11_11")
    );
    assert_eq!(body["position"]["line_range"]["end"]["type"], "new");
    drop(requests);

    // The MR moved on: nothing is written.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"diff_refs":{"base_sha":"fedcba9876543210fedcba9876543210fedcba98","start_sha":"fedcba9876543210fedcba9876543210fedcba98","head_sha":"fedcba9876543210fedcba9876543210fedcba98"}}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &action, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn notes_keep_their_line_range_and_suggestions() {
    let user = json!({"id": 9, "username": "alice", "name": "Alice"});
    let note = normalize_note(&json!({
        "id": 5,
        "body": "```suggestion:-1+0\nconst a = 1\nconst b = 2\n```",
        "author": user,
        "position": {
            "base_sha": HEAD_SHA, "start_sha": HEAD_SHA, "head_sha": HEAD_SHA,
            "old_path": "a.ts", "new_path": "a.ts", "position_type": "text", "new_line": 13,
            "line_range": {
                "start": {"line_code": "x_11_12", "type": "new", "old_line": null, "new_line": 12},
                "end": {"line_code": "x_11_13", "type": "new", "old_line": null, "new_line": 13},
            },
        },
        "suggestions": [
            {"id": 41, "from_line": 12, "to_line": 13, "appliable": true, "applied": false, "from_content": "a\nb\n", "to_content": "const a = 1\nconst b = 2\n"},
            {"id": 0, "from_line": 1, "to_line": 1},
        ],
    }))
    .unwrap();
    assert_eq!(
        note["position"]["lineRange"],
        json!({"start": {"newLine": 12, "type": "new"}, "end": {"newLine": 13, "type": "new"}})
    );
    assert_eq!(
        note["suggestions"],
        json!([{"id": "41", "fromLine": 12, "toLine": 13, "appliable": true, "applied": false, "fromContent": "a\nb\n", "toContent": "const a = 1\nconst b = 2\n"}])
    );
    let plain = normalize_note(&json!({"id": 6, "body": "ok", "author": user})).unwrap();
    assert!(plain.get("suggestions").is_none());
}

#[test]
fn versions_are_listed_per_page_and_compared_by_their_heads() {
    let other_sha = "fedcba9876543210fedcba9876543210fedcba98";
    let versions = format!(
        r#"[{{"id":110,"head_commit_sha":"{HEAD_SHA}","base_commit_sha":"{other_sha}","start_commit_sha":"{other_sha}","created_at":"2026-10-01T00:00:00Z","merge_request_id":105,"state":"collected","real_size":"3"}}]"#
    );
    let diff = r#"{"old_path":"a.ts","new_path":"a.ts","diff":"@@ -1 +1 @@\n-a\n+b\n","new_file":false,"deleted_file":false,"renamed_file":false,"too_large":false}"#;
    let compare = format!(
        r#"{{"commit":null,"commits":[],"diffs":[{}],"compare_timeout":true,"compare_same_ref":false}}"#,
        vec![diff; 31].join(",")
    );
    let fixture = Fixture::new(vec![
        response("200 OK", &versions, ""),
        response("200 OK", &compare, ""),
        response("200 OK", &compare, ""),
    ]);
    let client = Client::new();
    let listed = runtime()
        .block_on(fetch(
            &client,
            &fixture.url(),
            &Query::MrVersions {
                project_id: "42".to_owned(),
                iid: "9".to_owned(),
                page: 1,
            },
        ))
        .unwrap();
    assert_eq!(listed.data[0]["id"], "110");
    assert_eq!(listed.data[0]["headCommitSha"], HEAD_SHA);
    assert_eq!(listed.data[0]["realSize"], "3");
    let compare_query = |page| Query::VersionCompare {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        from_sha: other_sha.to_owned(),
        to_sha: HEAD_SHA.to_owned(),
        page,
    };
    let first = runtime()
        .block_on(fetch(&client, &fixture.url(), &compare_query(1)))
        .unwrap();
    assert_eq!(first.data.as_array().unwrap().len(), 30);
    assert_eq!(first.next_page, Some(2));
    assert_eq!(first.total_pages, Some(2));
    assert!(first.truncated);
    let second = runtime()
        .block_on(fetch(&client, &fixture.url(), &compare_query(2)))
        .unwrap();
    assert_eq!(second.data.as_array().unwrap().len(), 1);
    assert_eq!(second.next_page, None);
    let requests = fixture.requests.lock().unwrap();
    assert!(
        requests[0].contains("/api/v4/projects/42/merge_requests/9/versions?page=1&per_page=30 ")
    );
    assert!(requests[1].contains(&format!(
        "/api/v4/projects/42/repository/compare?from={other_sha}&to={HEAD_SHA}&straight=true "
    )));
    drop(requests);

    let api = Url::parse("https://gitlab.example/api/v4/").unwrap();
    let mut invalid = compare_query(1);
    if let Query::VersionCompare { from_sha, .. } = &mut invalid {
        *from_sha = "main".to_owned();
    }
    assert_eq!(
        build_query_url(&api, &invalid).unwrap_err().code,
        "INVALID_INPUT"
    );
}

#[test]
fn suggestions_are_applied_once_only_on_the_head_they_were_read_on() {
    let head = format!(r#"{{"diff_refs":{{"head_sha":"{HEAD_SHA}"}}}}"#);
    let single = Action::ApplySuggestions {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        suggestion_ids: vec!["41".to_owned()],
        head_sha: HEAD_SHA.to_owned(),
        commit_message: Some("Apply suggestion".to_owned()),
    };
    let fixture = Fixture::new(vec![
        response("200 OK", &head, ""),
        response(
            "200 OK",
            r#"{"id":41,"applied":true,"appliable":false}"#,
            "",
        ),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &single, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[0].starts_with("GET /api/v4/projects/42/merge_requests/9 "));
    assert!(requests[1].starts_with("PUT /api/v4/suggestions/41/apply "));
    assert!(requests[1].ends_with(r#"{"commit_message":"Apply suggestion"}"#));
    drop(requests);

    let batch = Action::ApplySuggestions {
        project_id: "42".to_owned(),
        iid: "9".to_owned(),
        suggestion_ids: vec!["41".to_owned(), "42".to_owned()],
        head_sha: HEAD_SHA.to_owned(),
        commit_message: None,
    };
    let fixture = Fixture::new(vec![
        response("200 OK", &head, ""),
        response(
            "200 OK",
            r#"[{"id":41,"applied":true},{"id":42,"applied":true}]"#,
            "",
        ),
    ]);
    runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &batch, "7"))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[1].starts_with("PUT /api/v4/suggestions/batch_apply "));
    assert!(requests[1].ends_with(r#"{"ids":[41,42]}"#));
    drop(requests);

    // The MR has a newer head: nothing is applied.
    let fixture = Fixture::new(vec![response(
        "200 OK",
        r#"{"diff_refs":{"head_sha":"fedcba9876543210fedcba9876543210fedcba98"}}"#,
        "",
    )]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &single, "7"))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);

    // A reply that does not say the suggestion was applied is not a confirmation.
    let fixture = Fixture::new(vec![
        response("200 OK", &head, ""),
        response("200 OK", r#"{"id":41,"applied":false}"#, ""),
    ]);
    let error = runtime()
        .block_on(mutate(&Client::new(), &fixture.url(), &single, "7"))
        .unwrap_err();
    assert_eq!(error.code, "UNKNOWN_OUTCOME");
    assert_eq!(fixture.requests.lock().unwrap().len(), 2);

    for invalid in [
        Action::ApplySuggestions {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            suggestion_ids: Vec::new(),
            head_sha: HEAD_SHA.to_owned(),
            commit_message: None,
        },
        Action::ApplySuggestions {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            suggestion_ids: vec!["41".to_owned(), "41".to_owned()],
            head_sha: HEAD_SHA.to_owned(),
            commit_message: None,
        },
        Action::ApplySuggestions {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            suggestion_ids: vec!["41".to_owned()],
            head_sha: "main".to_owned(),
            commit_message: None,
        },
        Action::ApplySuggestions {
            project_id: "42".to_owned(),
            iid: "9".to_owned(),
            suggestion_ids: vec!["41".to_owned()],
            head_sha: HEAD_SHA.to_owned(),
            commit_message: Some("  ".to_owned()),
        },
    ] {
        assert_eq!(validate_action(&invalid).unwrap_err().code, "INVALID_INPUT");
    }
}

#[test]
fn description_templates_are_listed_then_read_one_by_one() {
    let fixture = Fixture::new(vec![
        response(
            "200 OK",
            r#"[{"key":"Default","name":"Default"},{"key":"Bug fix","name":"Bug fix"}]"#,
            "",
        ),
        response(
            "200 OK",
            r###"{"name":"Default","content":"## Summary\n"}"###,
            "",
        ),
        response(
            "200 OK",
            r###"{"name":"Bug fix","content":"## Cause\n"}"###,
            "",
        ),
    ]);
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::DescriptionTemplates {
                project_id: "7".to_owned(),
            },
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert!(
        requests[0].starts_with("GET /api/v4/projects/7/templates/merge_requests?per_page=100 ")
    );
    assert!(requests[1].starts_with("GET /api/v4/projects/7/templates/merge_requests/Default "));
    assert!(requests[2].starts_with("GET /api/v4/projects/7/templates/merge_requests/Bug%20fix "));
    assert!(!result.truncated);
    assert_eq!(
        result.data,
        json!([
            {"id": "Default", "name": "Default", "content": "## Summary\n", "scope": "project"},
            {"id": "Bug fix", "name": "Bug fix", "content": "## Cause\n", "scope": "project"},
        ])
    );
}

#[test]
fn comment_templates_fall_back_to_the_users_own_when_project_templates_are_unknown() {
    let fixture = Fixture::new_at_path(
        vec![
            response(
                "200 OK",
                r#"{"errors":[{"message":"Field 'savedReplies' doesn't exist on type 'Project'"}]}"#,
                "",
            ),
            response(
                "200 OK",
                r#"{"data":{"currentUser":{"savedReplies":{"pageInfo":{"hasNextPage":true},"nodes":[{"id":"gid://gitlab/Users::SavedReply/1","name":"LGTM","content":"Looks good"}]}}}}"#,
                "",
            ),
        ],
        "/GitLab/api/v4/",
    );
    let result = runtime()
        .block_on(fetch(
            &Client::new(),
            &fixture.url(),
            &Query::CommentTemplates {
                project_path: "group/sub/app".to_owned(),
            },
        ))
        .unwrap();
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    let raw = &requests[0];
    let body: Value = serde_json::from_str(&raw[raw.find("{\"query\"").unwrap()..]).unwrap();
    assert_eq!(body["variables"]["project"], "group/sub/app");
    assert_eq!(body["variables"]["group"], "group/sub");
    assert!(!requests[1].contains("project(fullPath"));
    assert!(result.truncated);
    assert_eq!(
        result.data,
        json!([{"id": "gid://gitlab/Users::SavedReply/1", "name": "LGTM", "content": "Looks good", "scope": "user"}])
    );
}
