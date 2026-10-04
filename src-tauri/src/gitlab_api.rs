use crate::dto::{Action, AppError, MergeRequestState, Position, PositionType, Query};
use reqwest::{header::HeaderMap, Client, Method, Response, StatusCode};
use serde_json::{json, Map, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

/// Keep individual GitLab responses bounded even when a server ignores its
/// pagination defaults.  The caller can request subsequent pages using the
/// `next_page` value in the returned result.
pub const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_PAGE: u32 = 1_000_000;
pub const MAX_ACTION_BODY_BYTES: usize = 64 * 1024;
const MAX_GET_RETRIES: usize = 2;
const PER_PAGE: u32 = 30;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResult {
    pub data: Value,
    pub next_page: Option<u32>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy)]
enum ResponseKind {
    Projects,
    Mrs,
    Mr,
    Diffs,
    Discussions,
    Commits,
    Drafts,
    CommitDiff,
    Approvals,
}

#[derive(Debug, Clone, Copy)]
enum MutationPreflight<'a> {
    None,
    HeadSha(&'a str),
    Position(&'a Position),
    Draft(&'a str),
}

type QueryUrl = (Url, ResponseKind, Vec<(String, String)>);

/// Fetch one bounded page of a GitLab API resource.
///
/// The `reqwest::Client` is constructed by the session owner.  In particular,
/// this adapter never adds credentials, changes TLS policy, or follows a
/// redirect itself.
pub async fn fetch(client: &Client, api_base: &Url, query: &Query) -> Result<ApiResult, AppError> {
    let (url, response_kind) = build_query_url(api_base, query)?;

    let diff_revision = match query {
        Query::Diffs {
            project_id,
            iid,
            head_sha,
            ..
        } => Some((project_id.as_str(), iid.as_str(), head_sha.as_str())),
        _ => None,
    };
    if let Some((project_id, iid, head_sha)) = diff_revision {
        ensure_head_sha(client, api_base, project_id, iid, head_sha).await?;
    }

    if matches!(query, Query::File { .. }) {
        let (bytes, _headers) = get_bytes(client, &url, MAX_FILE_BYTES).await?;
        let content = String::from_utf8(bytes).map_err(|_| {
            AppError::new(
                "UNSUPPORTED",
                "GitLab returned file content that is not UTF-8.",
            )
        })?;
        return Ok(ApiResult {
            data: json!({ "content": content }),
            next_page: None,
            truncated: false,
        });
    }

    let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
    if let Some((project_id, iid, head_sha)) = diff_revision {
        ensure_head_sha(client, api_base, project_id, iid, head_sha).await?;
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLab returned an unsupported response format.",
        )
    })?;
    let data = normalize_response(response_kind, value)?;
    let next_page = parse_next_page(&headers)?;
    let truncated = contains_truncation_marker(&data);

    Ok(ApiResult {
        data,
        next_page,
        truncated,
    })
}

/// Apply one mutation.  Writes are intentionally sent exactly once.  A
/// transport failure or a server-side 5xx response is reported as
/// `UNKNOWN_OUTCOME` because the request may have reached GitLab.
pub async fn mutate(
    client: &Client,
    api_base: &Url,
    action: &Action,
    user_id: &str,
) -> Result<(), AppError> {
    validate_action(action)?;

    let (method, url, body, preflight) = match action {
        Action::Comment {
            project_id,
            iid,
            body,
            thread,
            position,
        } => {
            let path = if *thread || position.is_some() {
                "discussions"
            } else {
                "notes"
            };
            let url = endpoint(
                api_base,
                &["projects", project_id, "merge_requests", iid, path],
            )?;
            let mut payload = Map::new();
            payload.insert("body".to_owned(), Value::String(body.clone()));
            if let Some(position) = position {
                payload.insert("position".to_owned(), position_to_api_value(position));
            }
            (
                Method::POST,
                url,
                Value::Object(payload),
                position
                    .as_ref()
                    .map_or(MutationPreflight::None, MutationPreflight::Position),
            )
        }
        Action::Reply {
            project_id,
            iid,
            discussion_id,
            body,
        } => {
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "discussions",
                    discussion_id,
                    "notes",
                ],
            )?;
            (
                Method::POST,
                url,
                json!({ "body": body }),
                MutationPreflight::None,
            )
        }
        Action::EditNote {
            project_id,
            iid,
            note_id,
            body,
        } => {
            validate_user_id(user_id)?;
            ensure_note_owner(client, api_base, project_id, iid, note_id, user_id).await?;
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "notes",
                    note_id,
                ],
            )?;
            (
                Method::PUT,
                url,
                json!({ "body": body }),
                MutationPreflight::None,
            )
        }
        Action::DeleteNote {
            project_id,
            iid,
            note_id,
        } => {
            validate_user_id(user_id)?;
            ensure_note_owner(client, api_base, project_id, iid, note_id, user_id).await?;
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "notes",
                    note_id,
                ],
            )?;
            (Method::DELETE, url, Value::Null, MutationPreflight::None)
        }
        Action::Resolve {
            project_id,
            iid,
            discussion_id,
            resolved,
        } => {
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "discussions",
                    discussion_id,
                ],
            )?;
            (
                Method::PUT,
                url,
                json!({ "resolved": resolved }),
                MutationPreflight::None,
            )
        }
        Action::SaveDraft {
            project_id,
            iid,
            body,
            discussion_id,
            position,
        } => {
            let url = endpoint(
                api_base,
                &["projects", project_id, "merge_requests", iid, "draft_notes"],
            )?;
            let mut payload = Map::new();
            payload.insert("note".to_owned(), Value::String(body.clone()));
            if let Some(discussion_id) = discussion_id {
                payload.insert(
                    "in_reply_to_discussion_id".to_owned(),
                    Value::String(discussion_id.clone()),
                );
            }
            if let Some(position) = position {
                payload.insert("position".to_owned(), position_to_api_value(position));
            }
            (
                Method::POST,
                url,
                Value::Object(payload),
                position
                    .as_ref()
                    .map_or(MutationPreflight::None, MutationPreflight::Position),
            )
        }
        Action::EditDraft {
            project_id,
            iid,
            draft_id,
            body,
        } => {
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "draft_notes",
                    draft_id,
                ],
            )?;
            (
                Method::PUT,
                url,
                json!({ "note": body }),
                MutationPreflight::None,
            )
        }
        Action::DeleteDraft {
            project_id,
            iid,
            draft_id,
        } => {
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "draft_notes",
                    draft_id,
                ],
            )?;
            (Method::DELETE, url, Value::Null, MutationPreflight::None)
        }
        Action::PublishDraft {
            project_id,
            iid,
            draft_id,
        } => {
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "draft_notes",
                    draft_id,
                    "publish",
                ],
            )?;
            (
                Method::PUT,
                url,
                Value::Null,
                MutationPreflight::Draft(draft_id),
            )
        }
        Action::Approve {
            project_id,
            iid,
            sha,
        } => {
            let url = endpoint(
                api_base,
                &["projects", project_id, "merge_requests", iid, "approve"],
            )?;
            (
                Method::POST,
                url,
                json!({ "sha": sha }),
                MutationPreflight::HeadSha(sha),
            )
        }
        Action::Unapprove { project_id, iid } => {
            let url = endpoint(
                api_base,
                &["projects", project_id, "merge_requests", iid, "unapprove"],
            )?;
            (Method::POST, url, Value::Null, MutationPreflight::None)
        }
    };

    let (project_id, iid) = action_project_and_iid(action);
    match preflight {
        MutationPreflight::None => {}
        MutationPreflight::HeadSha(expected_head_sha) => {
            ensure_head_sha(client, api_base, project_id, iid, expected_head_sha).await?
        }
        MutationPreflight::Position(position) => {
            ensure_position_refs(client, api_base, project_id, iid, position).await?
        }
        MutationPreflight::Draft(draft_id) => {
            ensure_draft_is_current(client, api_base, project_id, iid, draft_id).await?
        }
    }

    let allows_empty = matches!(
        action,
        Action::DeleteNote { .. } | Action::DeleteDraft { .. } | Action::PublishDraft { .. }
    );
    send_mutation(client, method, url, body, allows_empty).await
}

fn action_project_and_iid(action: &Action) -> (&str, &str) {
    match action {
        Action::Comment {
            project_id, iid, ..
        }
        | Action::Reply {
            project_id, iid, ..
        }
        | Action::EditNote {
            project_id, iid, ..
        }
        | Action::DeleteNote {
            project_id, iid, ..
        }
        | Action::Resolve {
            project_id, iid, ..
        }
        | Action::SaveDraft {
            project_id, iid, ..
        }
        | Action::EditDraft {
            project_id, iid, ..
        }
        | Action::DeleteDraft {
            project_id, iid, ..
        }
        | Action::PublishDraft {
            project_id, iid, ..
        }
        | Action::Approve {
            project_id, iid, ..
        }
        | Action::Unapprove {
            project_id, iid, ..
        } => (project_id, iid),
    }
}

fn build_query_url(api_base: &Url, query: &Query) -> Result<(Url, ResponseKind), AppError> {
    let (url, response_kind, params) = match query {
        Query::Projects {
            search,
            membership,
            include_archived,
            page,
        } => {
            validate_page(*page)?;
            let mut params = vec![
                ("membership".to_owned(), membership.to_string()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), PER_PAGE.to_string()),
            ];
            if !include_archived {
                params.push(("archived".to_owned(), "false".to_owned()));
            }
            if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
            }
            (
                endpoint(api_base, &["projects"])?,
                ResponseKind::Projects,
                params,
            )
        }
        Query::Mrs {
            search,
            state,
            project_id,
            reviewer_id,
            author_id,
            updated_after,
            updated_before,
            page,
        } => {
            validate_page(*page)?;
            if let Some(project_id) = project_id {
                validate_id(project_id, "projectId")?;
            }
            if let Some(reviewer_id) = reviewer_id {
                validate_id(reviewer_id, "reviewerId")?;
            }
            if let Some(author_id) = author_id {
                validate_id(author_id, "authorId")?;
            }
            let mut params = vec![
                ("scope".to_owned(), "all".to_owned()),
                ("state".to_owned(), state_to_string(state).to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), PER_PAGE.to_string()),
            ];
            if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
            }
            let url = if let Some(project_id) = project_id {
                endpoint(api_base, &["projects", project_id, "merge_requests"])?
            } else {
                endpoint(api_base, &["merge_requests"])?
            };
            add_optional_param(&mut params, "reviewer_id", reviewer_id);
            add_optional_param(&mut params, "author_id", author_id);
            add_optional_param(&mut params, "updated_after", updated_after);
            add_optional_param(&mut params, "updated_before", updated_before);
            (url, ResponseKind::Mrs, params)
        }
        Query::Mr { project_id, iid } => {
            validate_id(project_id, "projectId")?;
            validate_id(iid, "iid")?;
            (
                endpoint(api_base, &["projects", project_id, "merge_requests", iid])?,
                ResponseKind::Mr,
                Vec::new(),
            )
        }
        Query::Diffs {
            project_id,
            iid,
            head_sha,
            page,
        } => {
            validate_sha(head_sha, "headSha")?;
            paged_mr_query(
                api_base,
                project_id,
                iid,
                *page,
                "diffs",
                ResponseKind::Diffs,
            )?
        }
        Query::Discussions {
            project_id,
            iid,
            page,
        } => paged_mr_query(
            api_base,
            project_id,
            iid,
            *page,
            "discussions",
            ResponseKind::Discussions,
        )?,
        Query::Commits {
            project_id,
            iid,
            page,
        } => paged_mr_query(
            api_base,
            project_id,
            iid,
            *page,
            "commits",
            ResponseKind::Commits,
        )?,
        Query::Drafts {
            project_id,
            iid,
            page,
        } => paged_mr_query(
            api_base,
            project_id,
            iid,
            *page,
            "draft_notes",
            ResponseKind::Drafts,
        )?,
        Query::CommitDiff {
            project_id,
            iid,
            sha,
            page,
        } => {
            validate_id(project_id, "projectId")?;
            validate_id(iid, "iid")?;
            validate_sha(sha, "sha")?;
            validate_page(*page)?;
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "repository", "commits", sha, "diff"],
                )?,
                ResponseKind::CommitDiff,
                vec![
                    ("page".to_owned(), page.to_string()),
                    ("per_page".to_owned(), PER_PAGE.to_string()),
                ],
            )
        }
        Query::File {
            project_id,
            path,
            sha,
        } => {
            validate_id(project_id, "projectId")?;
            validate_path(path)?;
            validate_sha(sha, "sha")?;
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "repository", "files", path, "raw"],
                )?,
                ResponseKind::CommitDiff,
                vec![("ref".to_owned(), sha.clone())],
            )
        }
        Query::Approvals { project_id, iid } => {
            validate_id(project_id, "projectId")?;
            validate_id(iid, "iid")?;
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "merge_requests", iid, "approvals"],
                )?,
                ResponseKind::Approvals,
                Vec::new(),
            )
        }
    };

    Ok((append_query(url, params), response_kind))
}

fn paged_mr_query(
    api_base: &Url,
    project_id: &str,
    iid: &str,
    page: u32,
    resource: &str,
    response_kind: ResponseKind,
) -> Result<QueryUrl, AppError> {
    validate_id(project_id, "projectId")?;
    validate_id(iid, "iid")?;
    validate_page(page)?;
    Ok((
        endpoint(
            api_base,
            &["projects", project_id, "merge_requests", iid, resource],
        )?,
        response_kind,
        vec![
            ("page".to_owned(), page.to_string()),
            ("per_page".to_owned(), PER_PAGE.to_string()),
        ],
    ))
}

fn add_optional_param(params: &mut Vec<(String, String)>, name: &str, value: &Option<String>) {
    if let Some(value) = value {
        params.push((name.to_owned(), value.clone()));
    }
}

fn append_query(mut url: Url, params: Vec<(String, String)>) -> Url {
    if !params.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in params {
            pairs.append_pair(&name, &value);
        }
    }
    url
}

/// Build an endpoint from a base URL while preserving an existing `/api/v4/`
/// prefix.  `Url::join` with a leading slash would silently discard that
/// prefix, so segments are appended through `path_segments_mut`, which also
/// percent-encodes each untrusted segment.
fn endpoint(api_base: &Url, segments: &[&str]) -> Result<Url, AppError> {
    if api_base.host_str().is_none() || api_base.cannot_be_a_base() {
        return Err(AppError::new(
            "INVALID_INPUT",
            "The GitLab API base URL is invalid.",
        ));
    }

    let mut url = api_base.clone();
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().to_owned();
    if path.is_empty() {
        path.push('/');
    }
    if !path.ends_with('/') {
        path.push('/');
    }
    url.set_path(&path);

    {
        let mut path_segments = url
            .path_segments_mut()
            .map_err(|_| AppError::new("INVALID_INPUT", "The GitLab API base URL is invalid."))?;
        path_segments.pop_if_empty();
        for segment in segments {
            path_segments.push(segment);
        }
    }
    Ok(url)
}

async fn get_bytes(
    client: &Client,
    url: &Url,
    max_bytes: usize,
) -> Result<(Vec<u8>, HeaderMap), AppError> {
    let mut retries = 0;
    loop {
        match client.get(url.clone()).send().await {
            Ok(response) => {
                let status = response.status();
                if is_recoverable_server_error(status) && retries < MAX_GET_RETRIES {
                    retries += 1;
                    wait_for_get_retry(retries).await;
                    continue;
                }
                if !status.is_success() {
                    return Err(status_error(status, response.headers(), false));
                }
                let headers = response.headers().clone();
                match read_limited(response, max_bytes).await {
                    Ok(bytes) => return Ok((bytes, headers)),
                    Err(error)
                        if matches!(error.code.as_str(), "NETWORK" | "TIMEOUT")
                            && retries < MAX_GET_RETRIES =>
                    {
                        retries += 1;
                        wait_for_get_retry(retries).await;
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => {
                let is_timeout = error.is_timeout();
                if retries < MAX_GET_RETRIES {
                    retries += 1;
                    wait_for_get_retry(retries).await;
                    continue;
                }
                return Err(transport_error(is_timeout));
            }
        }
    }
}

async fn get_json_once(client: &Client, url: &Url) -> Result<Value, AppError> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| transport_error(error.is_timeout()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(status_error(status, response.headers(), false));
    }
    let bytes = read_limited(response, MAX_RESPONSE_BYTES).await?;
    serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLab returned an unsupported response format.",
        )
    })
}

async fn send_mutation(
    client: &Client,
    method: Method,
    url: Url,
    body: Value,
    allows_empty: bool,
) -> Result<(), AppError> {
    let request = client.request(method, url);
    let response = if body.is_null() {
        request.send().await
    } else {
        request.json(&body).send().await
    };
    match response {
        Ok(response) if response.status().is_success() => {
            let status = response.status();
            if status == StatusCode::NO_CONTENT && allows_empty {
                return Ok(());
            }
            // A proxy login page, malformed/truncated body, or asynchronous
            // acceptance is not confirmation that this write completed.
            if !matches!(status, StatusCode::OK | StatusCode::CREATED) {
                return Err(unknown_mutation_result());
            }
            let bytes = read_limited(response, 2 * 1024 * 1024)
                .await
                .map_err(|_| unknown_mutation_result())?;
            let value: Value =
                serde_json::from_slice(&bytes).map_err(|_| unknown_mutation_result())?;
            let identified_object = value.is_object()
                && value.get("id").is_some_and(|id| {
                    id.as_u64().is_some_and(|id| id > 0)
                        || id.as_str().is_some_and(|id| !id.is_empty())
                });
            if identified_object {
                Ok(())
            } else {
                Err(unknown_mutation_result())
            }
        }
        Ok(response) => {
            let status = response.status();
            if is_recoverable_server_error(status) || status == StatusCode::REQUEST_TIMEOUT {
                Err(AppError::new(
                    "UNKNOWN_OUTCOME",
                    "GitLab did not confirm the result of the change.",
                ))
            } else {
                Err(status_error(status, response.headers(), true))
            }
        }
        Err(error) => Err(AppError::new(
            "UNKNOWN_OUTCOME",
            if error.is_timeout() {
                "The change may have reached GitLab, but the request timed out."
            } else {
                "The change may have reached GitLab, but its result could not be confirmed."
            },
        )),
    }
}

fn unknown_mutation_result() -> AppError {
    AppError::new(
        "UNKNOWN_OUTCOME",
        "GitLab did not confirm the result of the change. Verify it before sending again.",
    )
}

async fn read_limited(mut response: Response, max_bytes: usize) -> Result<Vec<u8>, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(AppError::new(
            "TOO_LARGE",
            "The GitLab response is larger than the supported limit.",
        ));
    }

    let mut output = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(error.is_timeout()))?
    {
        if output.len().saturating_add(chunk.len()) > max_bytes {
            return Err(AppError::new(
                "TOO_LARGE",
                "The GitLab response is larger than the supported limit.",
            ));
        }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}

fn is_recoverable_server_error(status: StatusCode) -> bool {
    status.is_server_error()
        && !matches!(
            status,
            StatusCode::NOT_IMPLEMENTED | StatusCode::HTTP_VERSION_NOT_SUPPORTED
        )
}

async fn wait_for_get_retry(retry_number: usize) {
    let exponential = 20_u64.saturating_mul(1_u64 << retry_number.saturating_sub(1));
    let jitter = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::from(duration.subsec_nanos() % 16))
        .unwrap_or(0);
    tokio::time::sleep(Duration::from_millis(exponential.saturating_add(jitter))).await;
}

fn status_error(status: StatusCode, headers: &HeaderMap, mutation: bool) -> AppError {
    match status {
        StatusCode::UNAUTHORIZED => AppError::new(
            "AUTH_REQUIRED",
            "GitLab requires authentication for this request.",
        ),
        StatusCode::FORBIDDEN => {
            AppError::new("FORBIDDEN", "GitLab denied access to this resource.")
        }
        StatusCode::NOT_FOUND => AppError::new("NOT_FOUND", "GitLab could not find this resource."),
        StatusCode::TOO_MANY_REQUESTS => {
            let error = AppError::new("RATE_LIMITED", "GitLab rate limited this request.");
            retry_after_ms(error, headers)
        }
        StatusCode::METHOD_NOT_ALLOWED
        | StatusCode::NOT_IMPLEMENTED
        | StatusCode::HTTP_VERSION_NOT_SUPPORTED => {
            AppError::new("UNSUPPORTED", "This GitLab API operation is not supported.")
        }
        _ if status.is_server_error() && mutation => AppError::new(
            "UNKNOWN_OUTCOME",
            "GitLab did not confirm the result of the change.",
        ),
        _ if status.is_server_error() => {
            AppError::new("NETWORK", "GitLab returned a temporary server error.")
        }
        StatusCode::BAD_REQUEST | StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY => {
            AppError::new("INVALID_INPUT", "GitLab rejected the request.")
        }
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => {
            AppError::new("TIMEOUT", "The GitLab request timed out.")
        }
        _ => AppError::new("UNSUPPORTED", "GitLab rejected the request."),
    }
}

fn retry_after_ms(mut error: AppError, headers: &HeaderMap) -> AppError {
    if let Some(value) = headers.get(reqwest::header::RETRY_AFTER) {
        if let Ok(value) = value.to_str() {
            if let Ok(seconds) = value.trim().parse::<u64>() {
                error.retry_after_ms = Some(seconds.saturating_mul(1_000));
                return error;
            }
        }
    }

    if let Some(value) = headers.get("x-ratelimit-reset") {
        if let Ok(value) = value.to_str() {
            if let Ok(reset_at) = value.trim().parse::<u64>() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0);
                error.retry_after_ms = Some(reset_at.saturating_sub(now).saturating_mul(1_000));
            }
        }
    }
    error
}

fn transport_error(timeout: bool) -> AppError {
    if timeout {
        AppError::new("TIMEOUT", "The GitLab request timed out.")
    } else {
        AppError::new("NETWORK", "The GitLab request could not be completed.")
    }
}

fn parse_next_page(headers: &HeaderMap) -> Result<Option<u32>, AppError> {
    let Some(value) = headers.get("x-next-page") else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| AppError::new("UNSUPPORTED", "GitLab returned an invalid page header."))?;
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let page = value
        .parse::<u32>()
        .map_err(|_| AppError::new("UNSUPPORTED", "GitLab returned an invalid page header."))?;
    if page == 0 || page > MAX_PAGE {
        return Err(AppError::new(
            "UNSUPPORTED",
            "GitLab returned an unsupported next page.",
        ));
    }
    Ok(Some(page))
}

fn normalize_response(kind: ResponseKind, value: Value) -> Result<Value, AppError> {
    match kind {
        ResponseKind::Projects => normalize_array(value, None, normalize_project),
        ResponseKind::Mrs => normalize_array(value, None, normalize_merge_request),
        ResponseKind::Mr => normalize_merge_request(&value),
        ResponseKind::Diffs => normalize_array(value, Some("changes"), normalize_diff),
        ResponseKind::Discussions => normalize_array(value, None, normalize_discussion),
        ResponseKind::Commits => normalize_array(value, None, normalize_commit),
        ResponseKind::CommitDiff => normalize_array(value, None, normalize_diff),
        ResponseKind::Drafts => normalize_array(value, None, normalize_draft),
        ResponseKind::Approvals => normalize_approvals(&value),
    }
}

fn contains_truncation_marker(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(contains_truncation_marker),
        Value::Object(object) => {
            object
                .get("tooLarge")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || object
                    .get("collapsed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                || object.values().any(contains_truncation_marker)
        }
        _ => false,
    }
}

fn normalize_array(
    value: Value,
    wrapper: Option<&str>,
    normalize_item: fn(&Value) -> Result<Value, AppError>,
) -> Result<Value, AppError> {
    let value = if let Some(wrapper) = wrapper {
        if value.is_array() {
            value
        } else {
            value
                .get(wrapper)
                .cloned()
                .ok_or_else(|| unsupported_response("GitLab returned an unexpected list shape."))?
        }
    } else {
        value
    };
    let values = value
        .as_array()
        .ok_or_else(|| unsupported_response("GitLab returned an unexpected list shape."))?;
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        normalized.push(normalize_item(value)?);
    }
    Ok(Value::Array(normalized))
}

fn normalize_project(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLab returned an invalid project.")?;
    let id = required_id_field(value, "id", "project")?;
    let name = required_string_field(value, "name", "project")?;
    let path_with_namespace = required_string_field(value, "path_with_namespace", "project")?;
    Ok(json!({
        "id": id,
        "name": name,
        "pathWithNamespace": path_with_namespace,
        "description": string_field(value, "description"),
        "webUrl": string_field(value, "web_url"),
        "archived": bool_field(value, "archived"),
    }))
}

fn normalize_merge_request(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLab returned an invalid merge request.")?;
    let id = required_id_field(value, "id", "merge request")?;
    let iid = required_id_field(value, "iid", "merge request")?;
    let project_id = required_id_field(value, "project_id", "merge request")?;
    let title = required_string_field(value, "title", "merge request")?;
    let state = required_string_field(value, "state", "merge request")?;
    let author = normalize_user(value.get("author").ok_or_else(|| {
        unsupported_response("GitLab returned an invalid merge request author.")
    })?)?;
    let diff_refs = value.get("diff_refs").and_then(|diff_refs| {
        if diff_refs.is_null() {
            None
        } else {
            Some(json!({
                "baseSha": string_field(diff_refs, "base_sha"),
                "startSha": string_field(diff_refs, "start_sha"),
                "headSha": string_field(diff_refs, "head_sha"),
            }))
        }
    });
    let head_sha = string_field(value, "sha");
    let head_sha = if head_sha.is_empty() {
        diff_refs
            .as_ref()
            .and_then(|refs| refs.get("headSha"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    } else {
        head_sha
    };
    Ok(json!({
        "id": id,
        "iid": iid,
        "projectId": project_id,
        "title": title,
        "description": string_field(value, "description"),
        "state": state,
        "webUrl": string_field(value, "web_url"),
        "author": author,
        "sourceBranch": string_field(value, "source_branch"),
        "targetBranch": string_field(value, "target_branch"),
        "updatedAt": string_field(value, "updated_at"),
        "headSha": if head_sha.is_empty() { Value::Null } else { Value::String(head_sha) },
        "diffRefs": diff_refs.unwrap_or(Value::Null),
    }))
}

fn normalize_diff(value: &Value) -> Result<Value, AppError> {
    Ok(json!({
        "oldPath": string_field(value, "old_path"),
        "newPath": string_field(value, "new_path"),
        "diff": string_field(value, "diff"),
        "newFile": bool_field(value, "new_file"),
        "deletedFile": bool_field(value, "deleted_file"),
        "renamedFile": bool_field(value, "renamed_file"),
        "tooLarge": bool_field(value, "too_large"),
        "collapsed": bool_field(value, "collapsed"),
    }))
}

fn normalize_discussion(value: &Value) -> Result<Value, AppError> {
    let notes = value
        .get("notes")
        .and_then(Value::as_array)
        .ok_or_else(|| unsupported_response("GitLab returned an invalid discussion."))?;
    let notes = notes
        .iter()
        .map(normalize_note)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "id": string_field(value, "id"),
        "individualNote": bool_field(value, "individual_note"),
        "notes": notes,
    }))
}

fn normalize_note(value: &Value) -> Result<Value, AppError> {
    let author = normalize_user(
        value
            .get("author")
            .ok_or_else(|| unsupported_response("GitLab returned an invalid note author."))?,
    )?;
    Ok(json!({
        "id": string_field(value, "id"),
        "body": string_field(value, "body"),
        "author": author,
        "createdAt": string_field(value, "created_at"),
        "system": bool_field(value, "system"),
        "resolvable": bool_field(value, "resolvable"),
        "resolved": bool_field(value, "resolved"),
        "position": value.get("position").and_then(normalize_position),
    }))
}

fn normalize_position(value: &Value) -> Option<Value> {
    if value.is_null() || !value.is_object() {
        return None;
    }
    let has_reference = ["base_sha", "start_sha", "head_sha", "old_path", "new_path"]
        .iter()
        .any(|field| scalar_field(value, field).is_some());
    if !has_reference {
        return None;
    }
    let mut position = Map::new();
    position.insert(
        "baseSha".to_owned(),
        Value::String(string_field(value, "base_sha")),
    );
    position.insert(
        "startSha".to_owned(),
        Value::String(string_field(value, "start_sha")),
    );
    position.insert(
        "headSha".to_owned(),
        Value::String(string_field(value, "head_sha")),
    );
    position.insert(
        "oldPath".to_owned(),
        Value::String(string_field(value, "old_path")),
    );
    position.insert(
        "newPath".to_owned(),
        Value::String(string_field(value, "new_path")),
    );
    if let Some(line) = value.get("old_line").and_then(Value::as_u64) {
        position.insert("oldLine".to_owned(), Value::Number(line.into()));
    }
    if let Some(line) = value.get("new_line").and_then(Value::as_u64) {
        position.insert("newLine".to_owned(), Value::Number(line.into()));
    }
    let position_type = string_field(value, "position_type");
    position.insert(
        "positionType".to_owned(),
        Value::String(
            if position_type == "text" {
                "text"
            } else {
                "file"
            }
            .to_owned(),
        ),
    );
    Some(Value::Object(position))
}

fn normalize_commit(value: &Value) -> Result<Value, AppError> {
    Ok(json!({
        "id": string_field(value, "id"),
        "title": string_field(value, "title"),
        "createdAt": string_field(value, "created_at"),
    }))
}

fn normalize_draft(value: &Value) -> Result<Value, AppError> {
    let body = value
        .get("body")
        .and_then(scalar_to_string)
        .or_else(|| value.get("note").and_then(scalar_to_string))
        .unwrap_or_default();
    Ok(json!({
        "id": string_field(value, "id"),
        "body": body,
        "discussionId": value
            .get("discussion_id")
            .and_then(scalar_to_string)
            .map(Value::String),
        "position": value.get("position").and_then(normalize_position),
    }))
}

fn normalize_approvals(value: &Value) -> Result<Value, AppError> {
    let approved_by = value
        .get("approved_by")
        .and_then(Value::as_array)
        .ok_or_else(|| unsupported_response("GitLab returned an invalid approval response."))?;
    let approved_by = approved_by
        .iter()
        .map(|item| normalize_user(item.get("user").unwrap_or(item)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "approved": bool_field(value, "approved"),
        "approvedBy": approved_by,
    }))
}

fn normalize_user(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLab returned an invalid user.")?;
    Ok(json!({
        "id": required_id_field(value, "id", "user")?,
        "username": required_string_field(value, "username", "user")?,
        "name": required_string_field(value, "name", "user")?,
    }))
}

fn require_object(value: &Value, message: &str) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(unsupported_response(message));
    }
    Ok(())
}

fn required_id_field(value: &Value, field: &str, resource: &str) -> Result<String, AppError> {
    let id = value.get(field).and_then(scalar_to_string).ok_or_else(|| {
        unsupported_response(&format!("GitLab returned an invalid {resource} ID."))
    })?;
    if !id.bytes().all(|byte| byte.is_ascii_digit()) || !id.parse::<u64>().is_ok_and(|id| id > 0) {
        return Err(unsupported_response(&format!(
            "GitLab returned an invalid {resource} ID."
        )));
    }
    Ok(id)
}

fn required_string_field(value: &Value, field: &str, resource: &str) -> Result<String, AppError> {
    let string = value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            unsupported_response(&format!("GitLab returned an invalid {resource} response."))
        })?;
    Ok(string.to_owned())
}

fn string_field(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(scalar_to_string)
        .unwrap_or_default()
}

fn scalar_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn bool_field(value: &Value, field: &str) -> bool {
    value.get(field).and_then(Value::as_bool).unwrap_or(false)
}

fn unsupported_response(message: &str) -> AppError {
    AppError::new("UNSUPPORTED", message)
}

fn position_to_api_value(position: &Position) -> Value {
    let mut value = Map::new();
    value.insert(
        "base_sha".to_owned(),
        Value::String(position.base_sha.clone()),
    );
    value.insert(
        "start_sha".to_owned(),
        Value::String(position.start_sha.clone()),
    );
    value.insert(
        "head_sha".to_owned(),
        Value::String(position.head_sha.clone()),
    );
    value.insert(
        "old_path".to_owned(),
        Value::String(position.old_path.clone()),
    );
    value.insert(
        "new_path".to_owned(),
        Value::String(position.new_path.clone()),
    );
    value.insert(
        "position_type".to_owned(),
        Value::String(match position.position_type {
            PositionType::Text => "text".to_owned(),
            PositionType::File => "file".to_owned(),
        }),
    );
    if let Some(line) = position.old_line {
        value.insert("old_line".to_owned(), Value::Number(line.into()));
    }
    if let Some(line) = position.new_line {
        value.insert("new_line".to_owned(), Value::Number(line.into()));
    }
    Value::Object(value)
}

fn validate_action(action: &Action) -> Result<(), AppError> {
    let (project_id, iid) = action_project_and_iid(action);
    validate_id(project_id, "projectId")?;
    validate_id(iid, "iid")?;

    match action {
        Action::Comment { body, position, .. } | Action::SaveDraft { body, position, .. } => {
            validate_body(body)?;
            if let Some(position) = position {
                validate_position(position)?;
            }
        }
        Action::Reply {
            discussion_id,
            body,
            ..
        } => {
            validate_discussion_id(discussion_id)?;
            validate_body(body)?;
        }
        Action::Resolve { discussion_id, .. } => {
            validate_discussion_id(discussion_id)?;
        }
        Action::EditNote { note_id, body, .. } => {
            validate_id(note_id, "noteId")?;
            validate_body(body)?;
        }
        Action::DeleteNote { note_id, .. } => validate_id(note_id, "noteId")?,
        Action::EditDraft { draft_id, body, .. } => {
            validate_id(draft_id, "draftId")?;
            validate_body(body)?;
        }
        Action::DeleteDraft { draft_id, .. } | Action::PublishDraft { draft_id, .. } => {
            validate_id(draft_id, "draftId")?
        }
        Action::Approve { sha, .. } => validate_sha(sha, "sha")?,
        Action::Unapprove { .. } => {}
    }
    if let Action::SaveDraft {
        discussion_id: Some(discussion_id),
        ..
    } = action
    {
        validate_discussion_id(discussion_id)?;
    }
    Ok(())
}

fn validate_position(position: &Position) -> Result<(), AppError> {
    validate_sha(&position.base_sha, "position.baseSha")?;
    validate_sha(&position.start_sha, "position.startSha")?;
    validate_sha(&position.head_sha, "position.headSha")?;
    validate_path(&position.old_path)?;
    validate_path(&position.new_path)?;
    if position.old_line == Some(0) || position.new_line == Some(0) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "Line numbers must be greater than zero.",
        ));
    }
    if matches!(position.position_type, PositionType::Text)
        && position.old_line.is_none()
        && position.new_line.is_none()
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "A line position must include an oldLine or newLine.",
        ));
    }
    Ok(())
}

fn validate_user_id(user_id: &str) -> Result<(), AppError> {
    validate_id(user_id, "userId")
}

fn validate_body(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::new(
            "INVALID_INPUT",
            "The comment body must not be empty.",
        ));
    }
    if value.len() > MAX_ACTION_BODY_BYTES {
        return Err(AppError::new(
            "INVALID_INPUT",
            "The comment body is larger than the supported limit.",
        ));
    }
    Ok(())
}

fn validate_id(value: &str, field: &str) -> Result<(), AppError> {
    if value.parse::<u64>().ok().is_none_or(|id| id == 0)
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            &format!("{field} must be a decimal identifier."),
        ));
    }
    Ok(())
}

fn validate_discussion_id(value: &str) -> Result<(), AppError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "discussionId must be an opaque hexadecimal identifier.",
        ));
    }
    Ok(())
}

fn validate_sha(value: &str, field: &str) -> Result<(), AppError> {
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            &format!("{field} must be a full hexadecimal commit SHA."),
        ));
    }
    Ok(())
}

fn validate_path(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.starts_with('/')
        || value.ends_with('/')
        || value.contains('\\')
        || value.bytes().any(|byte| byte.is_ascii_control())
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "The repository file path is invalid.",
        ));
    }
    Ok(())
}

fn validate_page(page: u32) -> Result<(), AppError> {
    if page == 0 || page > MAX_PAGE {
        return Err(AppError::new(
            "INVALID_INPUT",
            "page must be between 1 and the supported maximum.",
        ));
    }
    Ok(())
}

fn state_to_string(state: &MergeRequestState) -> &'static str {
    match state {
        MergeRequestState::All => "all",
        MergeRequestState::Opened => "opened",
        MergeRequestState::Closed => "closed",
        MergeRequestState::Merged => "merged",
    }
}

async fn ensure_head_sha(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    expected: &str,
) -> Result<(), AppError> {
    let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
    let value = get_json_once(client, &url).await?;
    let actual = value
        .get("diff_refs")
        .and_then(|diff_refs| diff_refs.get("head_sha"))
        .and_then(scalar_to_string)
        .or_else(|| value.get("sha").and_then(scalar_to_string));
    if actual.as_deref() != Some(expected) {
        return Err(stale_merge_request());
    }
    Ok(())
}

async fn ensure_position_refs(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    expected: &Position,
) -> Result<(), AppError> {
    let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
    let value = get_json_once(client, &url).await?;
    let refs = value.get("diff_refs").ok_or_else(stale_merge_request)?;
    let matches = scalar_field(refs, "base_sha").as_deref() == Some(expected.base_sha.as_str())
        && scalar_field(refs, "start_sha").as_deref() == Some(expected.start_sha.as_str())
        && scalar_field(refs, "head_sha").as_deref() == Some(expected.head_sha.as_str());
    if !matches {
        return Err(stale_merge_request());
    }
    Ok(())
}

async fn ensure_draft_is_current(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    draft_id: &str,
) -> Result<(), AppError> {
    let draft_url = endpoint(
        api_base,
        &[
            "projects",
            project_id,
            "merge_requests",
            iid,
            "draft_notes",
            draft_id,
        ],
    )?;
    let draft = get_json_once(client, &draft_url).await?;
    let draft = draft
        .as_array()
        .and_then(|drafts| drafts.first())
        .unwrap_or(&draft);
    let Some(position) = draft
        .get("position")
        .filter(|position| position.is_object())
    else {
        return Ok(());
    };
    let Some(head_sha) = scalar_field(position, "head_sha") else {
        // GitLab represents a regular (non-diff) draft note with a position
        // object whose SHA and path fields are all null.  That draft has no
        // revision precondition to check.
        if scalar_field(position, "base_sha").is_none()
            && scalar_field(position, "start_sha").is_none()
        {
            return Ok(());
        }
        return Err(stale_merge_request());
    };
    let mr_url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
    let merge_request = get_json_once(client, &mr_url).await?;
    let refs = merge_request
        .get("diff_refs")
        .ok_or_else(stale_merge_request)?;
    let head_matches = scalar_field(refs, "head_sha").as_deref() == Some(head_sha.as_str());
    let base_matches = position
        .get("base_sha")
        .and_then(|value| scalar_field(value, "base_sha"))
        .is_none_or(|sha| scalar_field(refs, "base_sha").as_deref() == Some(sha.as_str()));
    let start_matches = position
        .get("start_sha")
        .and_then(|value| scalar_field(value, "start_sha"))
        .is_none_or(|sha| scalar_field(refs, "start_sha").as_deref() == Some(sha.as_str()));
    if !(head_matches && base_matches && start_matches) {
        return Err(stale_merge_request());
    }
    Ok(())
}

fn scalar_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(scalar_to_string)
}

fn stale_merge_request() -> AppError {
    AppError::new(
        "INVALID_INPUT",
        "The merge request changed. Refresh it and try again.",
    )
}

async fn ensure_note_owner(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    note_id: &str,
    user_id: &str,
) -> Result<(), AppError> {
    let url = endpoint(
        api_base,
        &[
            "projects",
            project_id,
            "merge_requests",
            iid,
            "notes",
            note_id,
        ],
    )?;
    let value = get_json_once(client, &url).await?;
    let author_id = value
        .get("author")
        .and_then(|author| author.get("id"))
        .and_then(scalar_to_string)
        .or_else(|| value.get("author_id").and_then(scalar_to_string));
    if author_id.as_deref() != Some(user_id) {
        return Err(AppError::new(
            "FORBIDDEN",
            "Only the comment author can change this note.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
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
            let thread = thread::spawn(move || {
                for response in responses {
                    let (mut stream, _) = listener.accept().unwrap();
                    let request = read_request(&mut stream);
                    captured.lock().unwrap().push(request);
                    stream.write_all(response.as_bytes()).unwrap();
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

    fn read_request(stream: &mut TcpStream) -> String {
        let mut buffer = [0_u8; 8192];
        let length = stream.read(&mut buffer).unwrap_or(0);
        String::from_utf8_lossy(&buffer[..length]).to_string()
    }

    fn response(status: &str, body: &str, headers: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\n{headers}\r\n{}",
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
            r#"[{"id":7,"name":"Demo","path_with_namespace":"group/demo","description":null,"web_url":"https://gitlab.example/group/demo","archived":false}]"#,
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
        assert!(fixture.requests.lock().unwrap()[0].contains("/api/v4/projects?"));
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
        assert!(requests[0].contains(
            "/gitlab/api/v4/projects/42/repository/files/docs%2Fspec%20%231.md/raw?ref="
        ));
    }

    #[test]
    fn diff_fetch_requires_the_expected_head_before_and_after_loading() {
        let merge_request = format!(r#"{{"diff_refs":{{"head_sha":"{HEAD_SHA}"}}}}"#);
        let fixture = Fixture::new(vec![
            response("200 OK", &merge_request, ""),
            response(
                "200 OK",
                r#"[{"old_path":"src/a.ts","new_path":"src/a.ts","diff":"@@","new_file":false,"deleted_file":false,"renamed_file":false,"too_large":false}]"#,
                "X-Next-Page: 2\r\n",
            ),
            response("200 OK", &merge_request, ""),
        ]);
        let client = Client::builder().build().unwrap();
        let result = runtime()
            .block_on(fetch(
                &client,
                &fixture.url(),
                &Query::Diffs {
                    project_id: "42".to_owned(),
                    iid: "9".to_owned(),
                    head_sha: HEAD_SHA.to_owned(),
                    page: 1,
                },
            ))
            .unwrap();

        assert_eq!(result.data[0]["newPath"], "src/a.ts");
        assert_eq!(result.next_page, Some(2));
        let requests = fixture.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[0].contains("/projects/42/merge_requests/9 HTTP/1.1"));
        assert!(requests[1].contains("/projects/42/merge_requests/9/diffs?"));
        assert!(requests[2].contains("/projects/42/merge_requests/9 HTTP/1.1"));
    }

    #[test]
    fn diff_fetch_rejects_data_if_the_head_changes_while_loading() {
        let before = format!(r#"{{"diff_refs":{{"head_sha":"{HEAD_SHA}"}}}}"#);
        let changed = r#"{"diff_refs":{"head_sha":"fedcba9876543210fedcba9876543210fedcba98"}}"#;
        let fixture = Fixture::new(vec![
            response("200 OK", &before, ""),
            response(
                "200 OK",
                r#"[{"old_path":"src/old.ts","new_path":"src/old.ts","diff":"@@","new_file":false,"deleted_file":false,"renamed_file":false,"too_large":false}]"#,
                "",
            ),
            response("200 OK", changed, ""),
        ]);
        let client = Client::builder().build().unwrap();
        let error = runtime()
            .block_on(fetch(
                &client,
                &fixture.url(),
                &Query::Diffs {
                    project_id: "42".to_owned(),
                    iid: "9".to_owned(),
                    head_sha: HEAD_SHA.to_owned(),
                    page: 1,
                },
            ))
            .unwrap_err();

        assert_eq!(error.code, "INVALID_INPUT");
        assert!(error.message.contains("Refresh"));
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
            reviewer_id: None,
            author_id: None,
            updated_after: None,
            updated_before: None,
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
                .build().unwrap();
            let api = Url::parse("https://gitlab.com/api/v4/").unwrap();
            let project_id = "278964".to_owned();
            let started = std::time::Instant::now();
            let list = fetch(&client, &api, &Query::Mrs {
                search: String::new(), state: MergeRequestState::Merged,
                project_id: Some(project_id.clone()), reviewer_id: None, author_id: None,
                updated_after: None, updated_before: None, page: 1,
            }).await.unwrap();
            let rows = list.data.as_array().unwrap();
            let iid = rows.first().unwrap()["iid"].as_str().unwrap().to_owned();
            let mr = fetch(&client, &api, &Query::Mr {project_id: project_id.clone(), iid: iid.clone()}).await.unwrap();
            assert_eq!(mr.data["iid"].as_str(), Some(iid.as_str()));
            let head_sha = mr.data["diffRefs"]["headSha"].as_str().unwrap().to_owned();
            let discussions = fetch(&client, &api, &Query::Discussions {project_id: project_id.clone(), iid: iid.clone(), page: 1}).await.unwrap();
            let diffs = fetch(&client, &api, &Query::Diffs {project_id, iid, head_sha, page: 1}).await.unwrap();
            assert!(discussions.data.is_array());
            assert!(diffs.data.is_array());
            println!("Public MR flow: {} list rows, {} discussions, {} files; network+normalization {} ms", rows.len(), discussions.data.as_array().unwrap().len(), diffs.data.as_array().unwrap().len(), started.elapsed().as_millis());
        });
    }
}
