use crate::dto::{
    Action, AppError, LineRange, LineRangePoint, MergeRequestState, MrPathRef, Position,
    PositionType, Query, StateEvent,
};
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
/// Group candidates for the search condition picker.
const GROUP_PER_PAGE: u32 = 20;
const MAX_PEOPLE: usize = 100;
/// The description and the one it replaces are both kept in the send record, which holds 256 KiB.
const MAX_DESCRIPTION_BYTES: usize = 96 * 1024;
/// GitLab's largest page; a pipeline's jobs are read whole, so fewer requests.
const JOB_PER_PAGE: u32 = 100;
const MAX_JOB_PAGES: u32 = 10;
const MAX_TRIGGER_JOB_PAGES: u32 = 3;
/// The end of a job log that is kept for display; the start of a longer log is omitted.
pub const MAX_TRACE_BYTES: usize = 512 * 1024;
/// A server that ignores the range request sends the whole log; beyond this it is not read.
const MAX_TRACE_DOWNLOAD_BYTES: usize = 16 * 1024 * 1024;
const MAX_TRACE_LINES: usize = 20_000;
/// Job states GitLab can cancel, and the pipeline states whose jobs it can cancel.
const CANCELABLE_STATUSES: &[&str] = &[
    "created",
    "waiting_for_resource",
    "waiting_for_callback",
    "preparing",
    "pending",
    "running",
    "scheduled",
];
const CI_FORBIDDEN_MESSAGE: &str = "この操作の権限がありません。パイプラインやジョブの操作には、プロジェクトでの実行権限（通常はDeveloper以上）と api スコープのトークンが必要です。";
/// GitLab limits merge request titles to 255 characters.
const MAX_TITLE_CHARS: usize = 255;
/// Labels are looked up for their colours too, so a page holds GitLab's maximum.
const LABEL_PER_PAGE: u32 = 100;
/// Entries of a repository folder per page; most folders fit on one.
const TREE_PER_PAGE: u32 = 100;
/// GitLab's largest page, so the notification count covers most pending To-Dos in one request.
const TODO_PER_PAGE: u32 = 100;
const MAX_LABEL_CHANGES: usize = 100;
/// Suggestions applied together in one commit.
const MAX_SUGGESTIONS: usize = 100;
const MAX_COMMIT_MESSAGE_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResult {
    pub data: Value,
    pub next_page: Option<u32>,
    /// `X-Total-Pages`, when GitLab reports it. GitLab omits it for very large
    /// collections, so callers must also cope with `None`.
    #[serde(default)]
    pub total_pages: Option<u32>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy)]
enum ResponseKind {
    Users,
    Groups,
    Project,
    Todos,
    Branches,
    Notes,
    Projects,
    Mrs,
    Mr,
    Diffs,
    Discussions,
    Commits,
    Blame,
    CommitMergeRequests,
    Drafts,
    CommitDiff,
    Approvals,
    Awards,
    Pipelines,
    Pipeline,
    Labels,
    Milestones,
    Versions,
    Compare,
    Tree,
}

#[derive(Debug, Clone, Copy)]
enum MutationPreflight<'a> {
    None,
    HeadSha(&'a str),
    Position(&'a Position),
    Draft(&'a str),
    People(&'static str, &'a [String]),
    Description(&'a str),
    State(&'static str),
    AutoMerge,
    Title(&'a str),
    Milestone(Option<&'a str>),
    /// The project path a GraphQL write names, and a reviewer it must still have.
    ProjectPath(&'a str, Option<&'a str>),
    /// The job or pipeline (by project and ID) must still allow the operation.
    Ci(CiTarget, &'a str, &'a str, CiOperation),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CiTarget {
    Job,
    Pipeline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CiOperation {
    Retry,
    Cancel,
    Play,
}

type QueryUrl = (Url, ResponseKind, Vec<(String, String)>);

/// Fetch one bounded page of a GitLab API resource.
///
/// The `reqwest::Client` is constructed by the session owner.  In particular,
/// this adapter never adds credentials, changes TLS policy, or follows a
/// redirect itself.
pub async fn fetch(client: &Client, api_base: &Url, query: &Query) -> Result<ApiResult, AppError> {
    if let Query::MrApprovals { items } = query {
        return fetch_mr_approvals(client, api_base, items).await;
    }
    if let Query::NoteAwards {
        project_path,
        iid,
        since_note_id,
    } = query
    {
        return fetch_note_awards(client, api_base, project_path, iid, since_note_id).await;
    }
    if let Query::PipelineJobs {
        project_id,
        pipeline_id,
    } = query
    {
        return fetch_pipeline_jobs(client, api_base, project_id, pipeline_id).await;
    }
    if let Query::JobTrace { project_id, job_id } = query {
        return fetch_job_trace(client, api_base, project_id, job_id).await;
    }
    if let Query::Mrs {
        search,
        project_id,
        page,
        ..
    } = query
    {
        match merge_request_number(search) {
            Some((iid, false)) => {
                return fetch_mrs_matching_number(client, api_base, query, iid).await;
            }
            Some((iid, true)) if project_id.is_none() => {
                build_query_url(api_base, query)?;
                return fetch_mrs_numbered_outside_project(client, api_base, query, iid, *page)
                    .await;
            }
            _ => {}
        }
    }
    if let Query::VersionCompare { page, .. } = query {
        return fetch_version_compare(client, api_base, query, *page).await;
    }
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

    if matches!(query, Query::File { .. } | Query::Blob { .. }) {
        let (bytes, _headers) = get_bytes(client, &url, MAX_FILE_BYTES).await?;
        let content = decode_file_text(bytes)?;
        return Ok(ApiResult {
            data: json!({ "content": content }),
            next_page: None,
            total_pages: None,
            truncated: false,
        });
    }

    let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
    if let Some((project_id, iid, head_sha)) = diff_revision {
        ensure_head_sha(client, api_base, project_id, iid, head_sha).await?;
    }
    decode_page(response_kind, &bytes, &headers)
}

/// Repository files are shown as UTF-8, or as Shift_JIS (Windows-31J) when
/// they are not valid UTF-8, which is common for older Japanese SQL files.
fn decode_file_text(bytes: Vec<u8>) -> Result<String, AppError> {
    let bytes = match String::from_utf8(bytes) {
        Ok(text) => return Ok(text),
        Err(error) => error.into_bytes(),
    };
    if !bytes.contains(&0) {
        if let Some(text) =
            encoding_rs::SHIFT_JIS.decode_without_bom_handling_and_without_replacement(&bytes)
        {
            return Ok(text.into_owned());
        }
    }
    Err(AppError::new(
        "UNSUPPORTED",
        "GitLabから返されたファイルはUTF-8またはShift_JISのテキストではないため表示できません。",
    ))
}

/// GitLab returns a comparison in one response, so its files are split into
/// pages here like the MR's own diff pages.
async fn fetch_version_compare(
    client: &Client,
    api_base: &Url,
    query: &Query,
    page: u32,
) -> Result<ApiResult, AppError> {
    let (url, _) = build_query_url(api_base, query)?;
    let (bytes, _headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLabから対応していない形式の応答が返されました。",
        )
    })?;
    if !value.is_object() {
        return Err(unsupported_response(
            "GitLabから想定外の形式の比較結果が返されました。",
        ));
    }
    // GitLab stopped comparing at its size or time limit: some files are missing.
    let timed_out = bool_field(&value, "compare_timeout");
    let normalized = normalize_array(value, Some("diffs"), normalize_diff)?;
    let diffs = normalized.as_array().map(Vec::as_slice).unwrap_or_default();
    let per_page = PER_PAGE as usize;
    let start = (page as usize).saturating_sub(1).saturating_mul(per_page);
    let data = Value::Array(diffs.iter().skip(start).take(per_page).cloned().collect());
    Ok(ApiResult {
        truncated: timed_out || contains_truncation_marker(&data),
        data,
        next_page: (start.saturating_add(per_page) < diffs.len()).then_some(page + 1),
        total_pages: u32::try_from(diffs.len().div_ceil(per_page).max(1)).ok(),
    })
}

fn decode_page(
    response_kind: ResponseKind,
    bytes: &[u8],
    headers: &HeaderMap,
) -> Result<ApiResult, AppError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLabから対応していない形式の応答が返されました。",
        )
    })?;
    let data = normalize_response(response_kind, value)?;
    let next_page = parse_next_page(headers)?;
    let total_pages = parse_total_pages(headers);
    let truncated = contains_truncation_marker(&data);

    Ok(ApiResult {
        data,
        next_page,
        total_pages,
        truncated,
    })
}

/// A bare number matches both the MRs with that iid and titles or descriptions
/// containing it. The iid matches lead page 1 and are dropped from the text
/// pages, which decide paging.
async fn fetch_mrs_matching_number(
    client: &Client,
    api_base: &Url,
    query: &Query,
    iid: &str,
) -> Result<ApiResult, AppError> {
    let mut by_iid = query.clone();
    let Query::Mrs {
        search,
        page,
        project_id,
        ..
    } = &mut by_iid
    else {
        unreachable!("only merge request searches match MR numbers");
    };
    *search = format!("!{iid}");
    let first_page = *page == 1;
    let in_project = project_id.is_some();

    let (url, response_kind) = build_query_url(api_base, query)?;
    let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
    let mut result = decode_page(response_kind, &bytes, &headers)?;
    let mut items: Vec<Value> = result
        .data
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["iid"].as_str() != Some(iid))
        .cloned()
        .collect();
    if first_page {
        let matches = if in_project {
            let (url, response_kind) = build_query_url(api_base, &by_iid)?;
            let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
            decode_page(response_kind, &bytes, &headers)?
        } else {
            fetch_mrs_numbered_outside_project(client, api_base, query, iid, 1).await?
        };
        result.truncated |= matches.truncated;
        if let Value::Array(mut matched) = matches.data {
            matched.append(&mut items);
            items = matched;
        }
    }
    result.data = Value::Array(items);
    Ok(result)
}

/// How many MRs one page of an MR-number search outside a project reads. That
/// search cannot filter by person, label or branch, so it reads a wide page
/// before those conditions are applied here.
const NUMBER_SEARCH_PER_PAGE: u32 = 100;

/// Outside a project GitLab's MR lists ignore `iids[]`, but its search treats
/// `#123` as an MR number in every project the user can see, or in a group and
/// its subgroups. That search takes only the state, so the list's other
/// conditions are applied to the page it returns.
async fn fetch_mrs_numbered_outside_project(
    client: &Client,
    api_base: &Url,
    query: &Query,
    iid: &str,
    page: u32,
) -> Result<ApiResult, AppError> {
    let Query::Mrs {
        state, group_id, ..
    } = query
    else {
        unreachable!("only merge request searches match MR numbers");
    };
    let url = match group_id {
        Some(group_id) => endpoint(api_base, &["groups", group_id, "search"])?,
        None => endpoint(api_base, &["search"])?,
    };
    let mut params = vec![
        ("scope".to_owned(), "merge_requests".to_owned()),
        ("search".to_owned(), format!("#{iid}")),
        ("page".to_owned(), page.to_string()),
        ("per_page".to_owned(), NUMBER_SEARCH_PER_PAGE.to_string()),
    ];
    if *state != MergeRequestState::All {
        params.push(("state".to_owned(), state_to_string(state).to_owned()));
    }
    let url = append_query(url, params);
    let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
    let mut result = decode_page(ResponseKind::Mrs, &bytes, &headers)?;
    let mut items = Vec::new();
    for item in result.data.as_array().into_iter().flatten() {
        if item["iid"].as_str() == Some(iid) && meets_mr_conditions(item, query)? {
            items.push(item.clone());
        }
    }
    result.data = Value::Array(items);
    // Filtered pages shrink, so GitLab's page count no longer applies.
    result.total_pages = None;
    Ok(result)
}

/// Whether a normalized MR meets the list conditions GitLab's search cannot apply.
fn meets_mr_conditions(mr: &Value, query: &Query) -> Result<bool, AppError> {
    let Query::Mrs {
        state,
        labels,
        source_branch,
        target_branch,
        reviewer_id,
        assignee_id,
        author_id,
        updated_after,
        updated_before,
        ..
    } = query
    else {
        unreachable!("only merge request searches have list conditions");
    };
    let has_user = |field: &str, id: &str| {
        mr[field]
            .as_array()
            .is_some_and(|users| users.iter().any(|user| user["id"].as_str() == Some(id)))
    };
    let timestamp = |value: &str| {
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()
    };
    let updated = mr["updatedAt"].as_str().and_then(timestamp);
    let within = |bound: &Option<String>, after: bool| -> Result<bool, AppError> {
        let Some(bound) = bound else { return Ok(true) };
        let bound = timestamp(bound).ok_or_else(|| {
            AppError::new("INVALID_INPUT", "MRの更新日の指定が正しくありません。")
        })?;
        Ok(updated.is_some_and(|updated| {
            if after {
                updated >= bound
            } else {
                updated <= bound
            }
        }))
    };
    Ok(
        (*state == MergeRequestState::All || mr["state"].as_str() == Some(state_to_string(state)))
            && labels.iter().flatten().all(|label| {
                mr["labels"]
                    .as_array()
                    .is_some_and(|labels| labels.iter().any(|value| value.as_str() == Some(label)))
            })
            && source_branch
                .as_deref()
                .is_none_or(|branch| mr["sourceBranch"].as_str() == Some(branch))
            && target_branch
                .as_deref()
                .is_none_or(|branch| mr["targetBranch"].as_str() == Some(branch))
            && author_id
                .as_deref()
                .is_none_or(|id| mr["author"]["id"].as_str() == Some(id))
            && assignee_id
                .as_deref()
                .is_none_or(|id| has_user("assignees", id))
            && reviewer_id
                .as_deref()
                .is_none_or(|id| has_user("reviewers", id))
            && within(updated_after, true)?
            && within(updated_before, false)?,
    )
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
        Action::UploadAttachment { .. } => {
            return Err(AppError::new("INVALID_INPUT", "添付データが必要です。"));
        }
        Action::SetAssignees {
            project_id,
            iid,
            user_ids,
            expected_user_ids,
        }
        | Action::SetReviewers {
            project_id,
            iid,
            user_ids,
            expected_user_ids,
        } => {
            let (field, ids_field) = people_fields(action);
            let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
            let ids = user_ids
                .iter()
                .map(|id| id.parse::<u64>().map(Value::from))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| {
                    AppError::new("INVALID_INPUT", "ユーザーIDの形式が正しくありません。")
                })?;
            (
                Method::PUT,
                url,
                json!({ ids_field: ids }),
                MutationPreflight::People(field, expected_user_ids),
            )
        }
        Action::SetDescription {
            project_id,
            iid,
            description,
            expected_description,
        } => {
            let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
            (
                Method::PUT,
                url,
                json!({ "description": description }),
                MutationPreflight::Description(expected_description),
            )
        }
        Action::AddAward {
            project_id,
            iid,
            note_id,
            name,
        } => {
            validate_user_id(user_id)?;
            let note_id = note_id.as_deref();
            if find_own_award(client, api_base, project_id, iid, note_id, name, user_id)
                .await?
                .is_some()
            {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "このリアクションは既に付いています。再読み込みしてください。",
                ));
            }
            let url = award_endpoint(api_base, project_id, iid, note_id, None)?;
            (
                Method::POST,
                url,
                json!({ "name": name }),
                MutationPreflight::None,
            )
        }
        Action::RemoveAward {
            project_id,
            iid,
            note_id,
            name,
        } => {
            validate_user_id(user_id)?;
            let note_id = note_id.as_deref();
            let award_id =
                find_own_award(client, api_base, project_id, iid, note_id, name, user_id)
                    .await?
                    .ok_or_else(|| {
                        AppError::new(
                            "INVALID_INPUT",
                            "このリアクションは既に外されています。再読み込みしてください。",
                        )
                    })?;
            let url = award_endpoint(api_base, project_id, iid, note_id, Some(&award_id))?;
            (Method::DELETE, url, Value::Null, MutationPreflight::None)
        }
        Action::MarkTodoDone {
            project_id,
            iid,
            todo_id,
        } => {
            ensure_pending_merge_request_todo(client, api_base, project_id, iid, todo_id).await?;
            let url = endpoint(api_base, &["todos", todo_id, "mark_as_done"])?;
            (Method::POST, url, Value::Null, MutationPreflight::None)
        }
        Action::RetryJob {
            pipeline_project_id,
            job_id,
            ..
        }
        | Action::CancelJob {
            pipeline_project_id,
            job_id,
            ..
        }
        | Action::PlayJob {
            pipeline_project_id,
            job_id,
            ..
        } => {
            let (operation, path) = match action {
                Action::RetryJob { .. } => (CiOperation::Retry, "retry"),
                Action::CancelJob { .. } => (CiOperation::Cancel, "cancel"),
                _ => (CiOperation::Play, "play"),
            };
            let url = endpoint(
                api_base,
                &["projects", pipeline_project_id, "jobs", job_id, path],
            )?;
            (
                Method::POST,
                url,
                Value::Null,
                MutationPreflight::Ci(CiTarget::Job, pipeline_project_id, job_id, operation),
            )
        }
        Action::RetryPipeline {
            pipeline_project_id,
            pipeline_id,
            ..
        }
        | Action::CancelPipeline {
            pipeline_project_id,
            pipeline_id,
            ..
        } => {
            let (operation, path) = match action {
                Action::RetryPipeline { .. } => (CiOperation::Retry, "retry"),
                _ => (CiOperation::Cancel, "cancel"),
            };
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    pipeline_project_id,
                    "pipelines",
                    pipeline_id,
                    path,
                ],
            )?;
            (
                Method::POST,
                url,
                Value::Null,
                MutationPreflight::Ci(
                    CiTarget::Pipeline,
                    pipeline_project_id,
                    pipeline_id,
                    operation,
                ),
            )
        }
        Action::Merge {
            project_id,
            iid,
            sha,
            squash,
            remove_source_branch,
            merge_commit_message,
            auto_merge,
        } => {
            let url = endpoint(
                api_base,
                &["projects", project_id, "merge_requests", iid, "merge"],
            )?;
            let mut payload = Map::new();
            payload.insert("sha".to_owned(), Value::String(sha.clone()));
            payload.insert(
                "should_remove_source_branch".to_owned(),
                Value::Bool(*remove_source_branch),
            );
            // GitLab applies only `squash: true`; false keeps the MR's setting.
            if *squash {
                payload.insert("squash".to_owned(), Value::Bool(true));
            }
            if let Some(message) = merge_commit_message {
                payload.insert(
                    "merge_commit_message".to_owned(),
                    Value::String(message.clone()),
                );
            }
            if *auto_merge {
                // GitLab 17.11 renamed `merge_when_pipeline_succeeds` to
                // `auto_merge` and reads either one; older versions ignore
                // `auto_merge`, so both are sent and no version merges at once
                // by ignoring the request to wait.
                payload.insert("auto_merge".to_owned(), Value::Bool(true));
                payload.insert("merge_when_pipeline_succeeds".to_owned(), Value::Bool(true));
            }
            (
                Method::PUT,
                url,
                Value::Object(payload),
                MutationPreflight::HeadSha(sha),
            )
        }
        Action::CancelAutoMerge { project_id, iid } => {
            // `cancel_auto_merge` exists only from GitLab 19.5; this endpoint,
            // deprecated there, works on every version.
            let url = endpoint(
                api_base,
                &[
                    "projects",
                    project_id,
                    "merge_requests",
                    iid,
                    "cancel_merge_when_pipeline_succeeds",
                ],
            )?;
            (Method::POST, url, Value::Null, MutationPreflight::AutoMerge)
        }
        Action::Rebase {
            project_id,
            iid,
            sha,
        } => {
            let url = endpoint(
                api_base,
                &["projects", project_id, "merge_requests", iid, "rebase"],
            )?;
            (
                Method::PUT,
                url,
                Value::Null,
                MutationPreflight::HeadSha(sha),
            )
        }
        Action::SetState {
            project_id,
            iid,
            state_event,
        } => {
            let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
            let (event, expected) = state_change(*state_event);
            (
                Method::PUT,
                url,
                json!({ "state_event": event }),
                MutationPreflight::State(expected),
            )
        }
        Action::SetTitle {
            project_id,
            iid,
            title,
            expected_title,
        } => {
            let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
            (
                Method::PUT,
                url,
                json!({ "title": title }),
                MutationPreflight::Title(expected_title),
            )
        }
        Action::SetLabels {
            project_id,
            iid,
            add_labels,
            remove_labels,
        } => {
            // Only the difference is sent, so labels someone else changed
            // meanwhile are kept.
            let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
            let mut payload = Map::new();
            if !add_labels.is_empty() {
                payload.insert("add_labels".to_owned(), add_labels.join(",").into());
            }
            if !remove_labels.is_empty() {
                payload.insert("remove_labels".to_owned(), remove_labels.join(",").into());
            }
            (
                Method::PUT,
                url,
                Value::Object(payload),
                MutationPreflight::None,
            )
        }
        Action::SetMilestone {
            project_id,
            iid,
            milestone_id,
            expected_milestone_id,
        } => {
            let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
            // GitLab clears the milestone for 0.
            let id = milestone_id
                .as_deref()
                .unwrap_or("0")
                .parse::<u64>()
                .map_err(|_| {
                    AppError::new("INVALID_INPUT", "milestoneIdは数値のIDで指定してください。")
                })?;
            (
                Method::PUT,
                url,
                json!({ "milestone_id": id }),
                MutationPreflight::Milestone(expected_milestone_id.as_deref()),
            )
        }
        Action::RequestChanges {
            iid, project_path, ..
        } => (
            Method::POST,
            graphql_url(api_base)?,
            json!({
                "query": "mutation($projectPath: ID!, $iid: String!) { mergeRequestRequestChanges(input: {projectPath: $projectPath, iid: $iid}) { errors mergeRequest { id } } }",
                "variables": { "projectPath": project_path, "iid": iid },
            }),
            MutationPreflight::ProjectPath(project_path, None),
        ),
        Action::RerequestReview {
            iid,
            project_path,
            user_id: reviewer_id,
            ..
        } => (
            Method::POST,
            graphql_url(api_base)?,
            json!({
                "query": "mutation($projectPath: ID!, $iid: String!, $userId: UserID!) { mergeRequestReviewerRereview(input: {projectPath: $projectPath, iid: $iid, userId: $userId}) { errors mergeRequest { id } } }",
                "variables": {
                    "projectPath": project_path,
                    "iid": iid,
                    "userId": format!("gid://gitlab/User/{reviewer_id}"),
                },
            }),
            MutationPreflight::ProjectPath(project_path, Some(reviewer_id)),
        ),
        Action::ApplySuggestions {
            suggestion_ids,
            head_sha,
            commit_message,
            ..
        } => {
            let mut payload = Map::new();
            let url = if let [suggestion_id] = suggestion_ids.as_slice() {
                endpoint(api_base, &["suggestions", suggestion_id, "apply"])?
            } else {
                let ids = suggestion_ids
                    .iter()
                    .map(|id| id.parse::<u64>().map(Value::from))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| {
                        AppError::new("INVALID_INPUT", "提案IDの形式が正しくありません。")
                    })?;
                payload.insert("ids".to_owned(), Value::Array(ids));
                endpoint(api_base, &["suggestions", "batch_apply"])?
            };
            if let Some(message) = commit_message {
                payload.insert("commit_message".to_owned(), Value::String(message.clone()));
            }
            (
                Method::PUT,
                url,
                Value::Object(payload),
                MutationPreflight::HeadSha(head_sha),
            )
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
        MutationPreflight::People(field, expected) => {
            ensure_people(client, api_base, project_id, iid, field, expected).await?
        }
        MutationPreflight::Description(expected) => {
            ensure_description(client, api_base, project_id, iid, expected).await?
        }
        MutationPreflight::Ci(target, ci_project_id, id, operation) => {
            ensure_ci_operation_allowed(client, api_base, target, ci_project_id, id, operation)
                .await?
        }
        MutationPreflight::State(expected) => {
            ensure_merge_request(client, api_base, project_id, iid, |value| {
                value.get("state").and_then(Value::as_str) == Some(expected)
            })
            .await?
        }
        MutationPreflight::AutoMerge => {
            ensure_merge_request(client, api_base, project_id, iid, |value| {
                bool_field(value, "merge_when_pipeline_succeeds")
            })
            .await?
        }
        MutationPreflight::Title(expected) => {
            ensure_merge_request(client, api_base, project_id, iid, |value| {
                value.get("title").and_then(Value::as_str) == Some(expected)
            })
            .await?
        }
        MutationPreflight::Milestone(expected) => {
            ensure_merge_request(client, api_base, project_id, iid, |value| {
                milestone_id(value).as_deref() == expected
            })
            .await?
        }
        MutationPreflight::ProjectPath(path, reviewer) => {
            // GraphQL names the MR by its project path, so the path must
            // still be the project the receipt was recorded for.
            let reference = format!("{path}!{iid}");
            ensure_merge_request(client, api_base, project_id, iid, |value| {
                value
                    .get("references")
                    .and_then(|refs| refs.get("full"))
                    .and_then(Value::as_str)
                    == Some(reference.as_str())
                    && reviewer.is_none_or(|reviewer| {
                        user_id_set(value, "reviewers").is_some_and(|ids| ids.contains(reviewer))
                    })
            })
            .await?
        }
    }

    let refusal = write_refusal(action);
    match action {
        Action::Rebase { .. } => {
            return confirm_rebase(send_write(client, method, url, body, refusal).await?).await;
        }
        Action::CancelAutoMerge { .. } => {
            let response = send_write(client, method, url, body, refusal).await?;
            return confirm_cancel_auto_merge(response).await;
        }
        Action::RequestChanges { .. } => {
            let response = send_write(client, method, url, body, refusal).await?;
            return confirm_graphql_write(response, "mergeRequestRequestChanges").await;
        }
        Action::RerequestReview { .. } => {
            let response = send_write(client, method, url, body, refusal).await?;
            return confirm_graphql_write(response, "mergeRequestReviewerRereview").await;
        }
        _ => {}
    }

    let allows_empty = matches!(
        action,
        Action::DeleteNote { .. }
            | Action::DeleteDraft { .. }
            | Action::PublishDraft { .. }
            | Action::RemoveAward { .. }
    );
    let is_ci = matches!(preflight, MutationPreflight::Ci(..));
    // Several suggestions are applied together and come back as a list.
    let returns_list = matches!(action, Action::ApplySuggestions { suggestion_ids, .. } if suggestion_ids.len() > 1);
    let response = send_mutation(
        client,
        method,
        url,
        body,
        allows_empty,
        refusal,
        returns_list,
    )
    .await
    .map_err(|error| {
        // The generic write message names comments and approvals.
        if is_ci && error.code == "FORBIDDEN" {
            AppError::new("FORBIDDEN", CI_FORBIDDEN_MESSAGE)
        } else {
            error
        }
    })?;
    if !saved_as_requested(action, response.as_ref()) {
        return Err(AppError::new(
            "UNSUPPORTED",
            "GitLabに保存された内容が要求と異なります。権限や接続先の設定で反映されなかった可能性があります。再読み込みして確認してください。",
        ));
    }
    if let Action::ApplySuggestions { .. } = action {
        // GitLab answers with the suggestions; each must now be applied.
        let applied = |item: &Value| item.get("applied") == Some(&Value::Bool(true));
        let confirmed = match response.as_ref() {
            Some(Value::Array(items)) => items.iter().all(applied),
            Some(item) => applied(item),
            None => false,
        };
        if !confirmed {
            return Err(unknown_mutation_result());
        }
    }
    if let Action::SetAssignees { user_ids, .. } | Action::SetReviewers { user_ids, .. } = action {
        // GitLab silently drops users it cannot assign (no access, or a plan
        // that allows only one), so the saved list is checked.
        let saved = response
            .as_ref()
            .and_then(|value| user_id_set(value, people_fields(action).0));
        if saved.as_ref() != Some(&user_ids.iter().cloned().collect()) {
            return Err(AppError::new(
                "UNSUPPORTED",
                "GitLabに保存されたユーザーが選択と異なります。アクセス権のないユーザーが含まれているか、プランで1人しか設定できない可能性があります。再読み込みして保存内容を確認してください。",
            ));
        }
    }
    Ok(())
}

/// The response field and the request field for an assignee or reviewer change.
fn people_fields(action: &Action) -> (&'static str, &'static str) {
    match action {
        Action::SetReviewers { .. } => ("reviewers", "reviewer_ids"),
        _ => ("assignees", "assignee_ids"),
    }
}

fn user_id_set(value: &Value, field: &str) -> Option<std::collections::BTreeSet<String>> {
    value
        .get(field)?
        .as_array()?
        .iter()
        .map(|user| user.get("id").and_then(scalar_to_string))
        .collect()
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
        }
        | Action::SetAssignees {
            project_id, iid, ..
        }
        | Action::SetReviewers {
            project_id, iid, ..
        }
        | Action::UploadAttachment {
            project_id, iid, ..
        }
        | Action::SetDescription {
            project_id, iid, ..
        }
        | Action::AddAward {
            project_id, iid, ..
        }
        | Action::RemoveAward {
            project_id, iid, ..
        }
        | Action::MarkTodoDone {
            project_id, iid, ..
        }
        | Action::RetryJob {
            project_id, iid, ..
        }
        | Action::CancelJob {
            project_id, iid, ..
        }
        | Action::PlayJob {
            project_id, iid, ..
        }
        | Action::RetryPipeline {
            project_id, iid, ..
        }
        | Action::CancelPipeline {
            project_id, iid, ..
        }
        | Action::Merge {
            project_id, iid, ..
        }
        | Action::CancelAutoMerge { project_id, iid }
        | Action::Rebase {
            project_id, iid, ..
        }
        | Action::SetState {
            project_id, iid, ..
        }
        | Action::SetTitle {
            project_id, iid, ..
        }
        | Action::SetLabels {
            project_id, iid, ..
        }
        | Action::SetMilestone {
            project_id, iid, ..
        }
        | Action::RequestChanges {
            project_id, iid, ..
        }
        | Action::RerequestReview {
            project_id, iid, ..
        }
        | Action::ApplySuggestions {
            project_id, iid, ..
        } => (project_id, iid),
    }
}

/// The `state_event` sent for a state change and the state the MR must be in.
fn state_change(event: StateEvent) -> (&'static str, &'static str) {
    match event {
        StateEvent::Close => ("close", "opened"),
        StateEvent::Reopen => ("reopen", "closed"),
    }
}

/// What the merge endpoints mean by their client errors. They answer `401`
/// for a user who may not merge, which must not read as an expired token: the
/// preflight read with the same token has just succeeded.
fn write_refusal(action: &Action) -> fn(StatusCode) -> Option<AppError> {
    match action {
        Action::Merge { .. } => |status| {
            match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Some(AppError::new(
                "FORBIDDEN",
                "このMRをマージする権限がありません。",
            )),
            StatusCode::METHOD_NOT_ALLOWED => Some(AppError::new(
                "INVALID_INPUT",
                "GitLabがマージを受け付けませんでした。現在はマージできない状態です。再読み込みして理由を確認してください。",
            )),
            StatusCode::CONFLICT => Some(stale_merge_request()),
            StatusCode::BAD_REQUEST
            | StatusCode::NOT_ACCEPTABLE
            | StatusCode::UNPROCESSABLE_ENTITY => Some(AppError::new(
                "INVALID_INPUT",
                "GitLabでマージできませんでした。再読み込みしてMRの状態を確認してください。",
            )),
            _ => None,
        }
        },
        Action::CancelAutoMerge { .. } => |status| {
            matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
                .then(|| AppError::new("FORBIDDEN", "自動マージを取り消す権限がありません。"))
        },
        Action::Rebase { .. } => |status| {
            match status {
            StatusCode::FORBIDDEN => Some(AppError::new(
                "FORBIDDEN",
                "ソースブランチにプッシュできないため、リベースできません。権限とブランチの保護設定を確認してください。",
            )),
            StatusCode::CONFLICT => Some(AppError::new(
                "INVALID_INPUT",
                "GitLabがリベースを開始できませんでした。しばらくしてから再試行してください。",
            )),
            _ => None,
        }
        },
        _ => |_| None,
    }
}

/// Whether GitLab's response shows the change the action asked for. GitLab
/// can accept an update without applying all of it (for example, a reopen
/// it refuses or a label the user may not set).
fn saved_as_requested(action: &Action, response: Option<&Value>) -> bool {
    let Some(value) = response else {
        return true;
    };
    match action {
        Action::Merge { auto_merge, .. } => {
            let state = value.get("state").and_then(Value::as_str);
            state == Some("merged")
                || (*auto_merge && bool_field(value, "merge_when_pipeline_succeeds"))
        }
        Action::SetState { state_event, .. } => {
            let expected = match state_event {
                StateEvent::Close => "closed",
                StateEvent::Reopen => "opened",
            };
            value.get("state").and_then(Value::as_str) == Some(expected)
        }
        Action::SetLabels {
            add_labels,
            remove_labels,
            ..
        } => {
            let Some(saved) = value.get("labels").and_then(Value::as_array) else {
                return false;
            };
            let saved = saved
                .iter()
                .filter_map(|label| {
                    label
                        .as_str()
                        .or_else(|| label.get("name").and_then(Value::as_str))
                })
                .collect::<std::collections::BTreeSet<_>>();
            add_labels
                .iter()
                .all(|label| saved.contains(label.as_str()))
                && !remove_labels
                    .iter()
                    .any(|label| saved.contains(label.as_str()))
        }
        Action::SetMilestone {
            milestone_id: id, ..
        } => milestone_id(value) == *id,
        _ => true,
    }
}

fn milestone_id(value: &Value) -> Option<String> {
    value
        .get("milestone")
        .filter(|milestone| milestone.is_object())
        .and_then(|milestone| milestone.get("id"))
        .and_then(scalar_to_string)
}

/// GitLab's GraphQL endpoint beside the REST base (`…/api/v4/` → `…/api/graphql`).
fn graphql_url(api_base: &Url) -> Result<Url, AppError> {
    api_base
        .join("../graphql")
        .map_err(|_| AppError::new("INVALID_INPUT", "GitLab GraphQLのURLが正しくありません。"))
}

fn build_query_url(api_base: &Url, query: &Query) -> Result<(Url, ResponseKind), AppError> {
    let (url, response_kind, params) = match query {
        Query::Users { search, page } => {
            validate_page(*page)?;
            (
                endpoint(api_base, &["users"])?,
                ResponseKind::Users,
                vec![
                    ("search".to_owned(), search.clone()),
                    ("active".to_owned(), "true".to_owned()),
                    ("page".to_owned(), page.to_string()),
                    ("per_page".to_owned(), PER_PAGE.to_string()),
                ],
            )
        }
        Query::Groups { search, page } => {
            validate_page(*page)?;
            // Every group the user can see, like the project picker; GitLab
            // otherwise lists only groups the user is a member of.
            (
                endpoint(api_base, &["groups"])?,
                ResponseKind::Groups,
                vec![
                    ("search".to_owned(), search.clone()),
                    ("all_available".to_owned(), "true".to_owned()),
                    ("page".to_owned(), page.to_string()),
                    ("per_page".to_owned(), GROUP_PER_PAGE.to_string()),
                ],
            )
        }
        Query::Project { path } => {
            validate_project_path(path)?;
            (
                endpoint(api_base, &["projects", path])?,
                ResponseKind::Project,
                Vec::new(),
            )
        }
        Query::Todos { page, done } => {
            validate_page(*page)?;
            (
                endpoint(api_base, &["todos"])?,
                ResponseKind::Todos,
                vec![
                    ("type".to_owned(), "MergeRequest".to_owned()),
                    (
                        "state".to_owned(),
                        if *done { "done" } else { "pending" }.to_owned(),
                    ),
                    ("page".to_owned(), page.to_string()),
                    ("per_page".to_owned(), TODO_PER_PAGE.to_string()),
                ],
            )
        }
        Query::Branches {
            project_id,
            search,
            page,
        } => {
            validate_id(project_id, "projectId")?;
            validate_page(*page)?;
            // Recently updated branches first; GitLab versions without this
            // sort ignore it and list by name.
            let mut params = vec![
                ("sort".to_owned(), "updated_desc".to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), PER_PAGE.to_string()),
            ];
            if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
            }
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "repository", "branches"],
                )?,
                ResponseKind::Branches,
                params,
            )
        }
        Query::Notes {
            project_id,
            iid,
            page,
        } => {
            let (url, kind, mut params) = paged_mr_query(
                api_base,
                project_id,
                iid,
                *page,
                "notes",
                ResponseKind::Notes,
            )?;
            params.push(("sort".to_owned(), "desc".to_owned()));
            params.push(("order_by".to_owned(), "updated_at".to_owned()));
            (url, kind, params)
        }
        Query::Projects {
            search,
            membership,
            include_archived,
            page,
        } => {
            validate_page(*page)?;
            let mut params = vec![
                ("membership".to_owned(), membership.to_string()),
                ("order_by".to_owned(), "last_activity_at".to_owned()),
                ("sort".to_owned(), "desc".to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), PER_PAGE.to_string()),
            ];
            if !include_archived {
                params.push(("archived".to_owned(), "false".to_owned()));
            }
            if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
                params.push(("search_namespaces".to_owned(), "true".to_owned()));
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
            group_id,
            labels,
            source_branch,
            target_branch,
            reviewer_id,
            assignee_id,
            author_id,
            updated_after,
            updated_before,
            order_by,
            sort,
            page,
        } => {
            validate_page(*page)?;
            let order_by = order_by.as_deref().unwrap_or("updated_at");
            let sort = sort.as_deref().unwrap_or("desc");
            if !matches!(order_by, "updated_at" | "created_at") || !matches!(sort, "asc" | "desc") {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "MRの並び順の指定が正しくありません。",
                ));
            }
            if let Some(project_id) = project_id {
                validate_id(project_id, "projectId")?;
            }
            if project_id.is_some() && group_id.is_some() {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "MR検索ではグループとプロジェクトを同時に指定できません。",
                ));
            }
            if let Some(group_id) = group_id {
                validate_group_id(group_id)?;
            }
            if let Some(labels) = labels {
                validate_labels(labels)?;
            }
            if let Some(reviewer_id) = reviewer_id {
                validate_id(reviewer_id, "reviewerId")?;
            }
            if let Some(assignee_id) = assignee_id {
                validate_id(assignee_id, "assigneeId")?;
            }
            if let Some(author_id) = author_id {
                validate_id(author_id, "authorId")?;
            }
            let mut params = vec![
                ("scope".to_owned(), "all".to_owned()),
                ("order_by".to_owned(), order_by.to_owned()),
                ("sort".to_owned(), sort.to_owned()),
                ("state".to_owned(), state_to_string(state).to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), PER_PAGE.to_string()),
            ];
            if let (Some(_), Some((iid, true))) = (project_id, merge_request_number(search)) {
                params.push(("iids[]".to_owned(), iid.to_owned()));
            } else if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
            }
            let url = if let Some(project_id) = project_id {
                endpoint(api_base, &["projects", project_id, "merge_requests"])?
            } else if let Some(group_id) = group_id {
                endpoint(api_base, &["groups", group_id, "merge_requests"])?
            } else {
                endpoint(api_base, &["merge_requests"])?
            };
            if let Some(labels) = labels {
                if !labels.is_empty() {
                    params.push(("labels".to_owned(), labels.join(",")));
                }
            }
            add_optional_param(&mut params, "source_branch", source_branch);
            add_optional_param(&mut params, "target_branch", target_branch);
            add_optional_param(&mut params, "reviewer_id", reviewer_id);
            add_optional_param(&mut params, "assignee_id", assignee_id);
            add_optional_param(&mut params, "author_id", author_id);
            add_optional_param(&mut params, "updated_after", updated_after);
            add_optional_param(&mut params, "updated_before", updated_before);
            (url, ResponseKind::Mrs, params)
        }
        Query::Mr { project_id, iid } => {
            validate_id(project_id, "projectId")?;
            validate_id(iid, "iid")?;
            // The merge controls need to know whether a rebase is running and
            // how far the source branch is behind.
            (
                endpoint(api_base, &["projects", project_id, "merge_requests", iid])?,
                ResponseKind::Mr,
                vec![
                    (
                        "include_diverged_commits_count".to_owned(),
                        "true".to_owned(),
                    ),
                    ("include_rebase_in_progress".to_owned(), "true".to_owned()),
                ],
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
        Query::Blame { project_id, path, sha, start_line, end_line } => {
            validate_id(project_id, "projectId")?;
            validate_path(path)?;
            validate_sha(sha, "sha")?;
            if *start_line == 0 || *end_line < *start_line || end_line.saturating_sub(*start_line) >= 100 || *end_line > 1_000_000 {
                return Err(AppError::new("INVALID_INPUT", "Blameは1回につき100行以内で指定してください。"));
            }
            (
                endpoint(api_base, &["projects", project_id, "repository", "files", path, "blame"])?,
                ResponseKind::Blame,
                vec![
                    ("ref".to_owned(), sha.clone()),
                    ("range[start]".to_owned(), start_line.to_string()),
                    ("range[end]".to_owned(), end_line.to_string()),
                ],
            )
        }
        Query::CommitMergeRequests { project_id, sha } => {
            validate_id(project_id, "projectId")?;
            validate_sha(sha, "sha")?;
            (
                endpoint(api_base, &["projects", project_id, "repository", "commits", sha, "merge_requests"])?,
                ResponseKind::CommitMergeRequests,
                vec![("per_page".to_owned(), "20".to_owned())],
            )
        }
        Query::Tree {
            project_id,
            git_ref,
            path,
            page,
        } => {
            validate_id(project_id, "projectId")?;
            validate_page(*page)?;
            let mut params = vec![
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), TREE_PER_PAGE.to_string()),
            ];
            if !path.is_empty() {
                validate_path(path)?;
                params.push(("path".to_owned(), path.clone()));
            }
            if let Some(git_ref) = git_ref {
                validate_ref(git_ref)?;
                params.push(("ref".to_owned(), git_ref.clone()));
            }
            (
                endpoint(api_base, &["projects", project_id, "repository", "tree"])?,
                ResponseKind::Tree,
                params,
            )
        }
        Query::Blob { project_id, sha } => {
            validate_id(project_id, "projectId")?;
            validate_sha(sha, "sha")?;
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "repository", "blobs", sha, "raw"],
                )?,
                ResponseKind::CommitDiff,
                Vec::new(),
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
        Query::MrApprovals { .. } => {
            return Err(AppError::new(
                "INVALID_INPUT",
                "MRの承認状況はこの方法では取得できません。",
            ))
        }
        Query::MrAwards { project_id, iid } => {
            validate_id(project_id, "projectId")?;
            validate_id(iid, "iid")?;
            (
                award_endpoint(api_base, project_id, iid, None, None)?,
                ResponseKind::Awards,
                vec![
                    ("page".to_owned(), "1".to_owned()),
                    ("per_page".to_owned(), "100".to_owned()),
                ],
            )
        }
        Query::NoteAwards { .. } => {
            return Err(AppError::new(
                "INVALID_INPUT",
                "コメントのリアクションはこの方法では取得できません。",
            ))
        }
        Query::MrPipelines {
            project_id,
            iid,
            page,
        } => paged_mr_query(
            api_base,
            project_id,
            iid,
            *page,
            "pipelines",
            ResponseKind::Pipelines,
        )?,
        Query::Pipeline {
            project_id,
            pipeline_id,
        } => {
            validate_id(project_id, "projectId")?;
            validate_id(pipeline_id, "pipelineId")?;
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "pipelines", pipeline_id],
                )?,
                ResponseKind::Pipeline,
                Vec::new(),
            )
        }
        Query::PipelineJobs { .. } | Query::JobTrace { .. } => {
            return Err(AppError::new(
                "INVALID_INPUT",
                "ジョブの情報はこの方法では取得できません。",
            ))
        }
        Query::Labels {
            project_id,
            search,
            page,
        } => {
            validate_id(project_id, "projectId")?;
            validate_page(*page)?;
            let mut params = vec![
                ("include_ancestor_groups".to_owned(), "true".to_owned()),
                ("with_counts".to_owned(), "false".to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), LABEL_PER_PAGE.to_string()),
            ];
            if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
            }
            (
                endpoint(api_base, &["projects", project_id, "labels"])?,
                ResponseKind::Labels,
                params,
            )
        }
        Query::Milestones {
            project_id,
            search,
            page,
        } => {
            validate_id(project_id, "projectId")?;
            validate_page(*page)?;
            // GitLab deprecated this for `include_ancestors` but still reads
            // it; the two are mutually exclusive and older versions know only
            // this one.
            let mut params = vec![
                ("state".to_owned(), "active".to_owned()),
                ("include_parent_milestones".to_owned(), "true".to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), PER_PAGE.to_string()),
            ];
            if !search.is_empty() {
                params.push(("search".to_owned(), search.clone()));
            }
            (
                endpoint(api_base, &["projects", project_id, "milestones"])?,
                ResponseKind::Milestones,
                params,
            )
        }
        Query::MrVersions {
            project_id,
            iid,
            page,
        } => paged_mr_query(
            api_base,
            project_id,
            iid,
            *page,
            "versions",
            ResponseKind::Versions,
        )?,
        Query::VersionCompare {
            project_id,
            iid,
            from_sha,
            to_sha,
            page,
        } => {
            validate_id(project_id, "projectId")?;
            validate_id(iid, "iid")?;
            validate_sha(from_sha, "fromSha")?;
            validate_sha(to_sha, "toSha")?;
            validate_page(*page)?;
            // A direct comparison of the two heads, as GitLab compares
            // versions: after a rebase it also holds target branch changes.
            (
                endpoint(api_base, &["projects", project_id, "repository", "compare"])?,
                ResponseKind::Compare,
                vec![
                    ("from".to_owned(), from_sha.clone()),
                    ("to".to_owned(), to_sha.clone()),
                    ("straight".to_owned(), "true".to_owned()),
                ],
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

/// A search of only an MR number, and whether it was written as `!123`, which
/// names the MR alone, rather than `123`, which also matches text. GitLab
/// filters by `iids[]` only in project lists; group and global lists find the
/// number through GitLab's search instead.
fn merge_request_number(search: &str) -> Option<(&str, bool)> {
    let search = search.trim();
    let (iid, explicit) = match search.strip_prefix('!') {
        Some(iid) => (iid, true),
        None => (search, false),
    };
    (!iid.is_empty() && iid.len() <= 18 && iid.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some((iid, explicit))
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
pub(crate) fn endpoint(api_base: &Url, segments: &[&str]) -> Result<Url, AppError> {
    if api_base.host_str().is_none() || api_base.cannot_be_a_base() {
        return Err(AppError::new(
            "INVALID_INPUT",
            "GitLab APIのURLが正しくありません。",
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
            .map_err(|_| AppError::new("INVALID_INPUT", "GitLab APIのURLが正しくありません。"))?;
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
                if retries < MAX_GET_RETRIES {
                    retries += 1;
                    wait_for_get_retry(retries).await;
                    continue;
                }
                return Err(transport_error(&error));
            }
        }
    }
}

/// Reads who approved up to one page of merge requests with a single GraphQL
/// query. Values travel as variables, never inside the query text. A merge
/// request GitLab does not return (no access, deleted) gets `approvedBy: null`.
async fn fetch_mr_approvals(
    client: &Client,
    api_base: &Url,
    items: &[MrPathRef],
) -> Result<ApiResult, AppError> {
    if items.is_empty() || items.len() > PER_PAGE as usize {
        return Err(AppError::new(
            "INVALID_INPUT",
            "承認状況は1ページ分のMRごとに取得してください。",
        ));
    }
    let mut declarations = Vec::new();
    let mut fields = Vec::new();
    let mut variables = Map::new();
    for (index, item) in items.iter().enumerate() {
        validate_project_path(&item.project_path)?;
        validate_id(&item.iid, "iid")?;
        declarations.push(format!("$p{index}: ID!, $i{index}: String!"));
        fields.push(format!(
            "m{index}: project(fullPath: $p{index}) {{ mergeRequest(iid: $i{index}) {{ approvedBy {{ nodes {{ id }} }} }} }}"
        ));
        variables.insert(format!("p{index}"), item.project_path.clone().into());
        variables.insert(format!("i{index}"), item.iid.clone().into());
    }
    let body = json!({
        "query": format!("query({}) {{ {} }}", declarations.join(", "), fields.join(" ")),
        "variables": variables,
    });
    let data = post_graphql(
        client,
        api_base,
        &body,
        "GitLabから対応していない形式の承認情報が返されました。",
        "GitLabから承認情報が返されませんでした。",
    )
    .await?;
    let data = &data;
    let results = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let approved_by = data
                .get(format!("m{index}"))
                .and_then(|project| project.get("mergeRequest"))
                .and_then(|merge_request| merge_request.get("approvedBy"))
                .and_then(|approved_by| approved_by.get("nodes"))
                .and_then(Value::as_array)
                .map(|nodes| {
                    nodes
                        .iter()
                        .filter_map(|node| node.get("id").and_then(Value::as_str))
                        .filter_map(|id| id.rsplit('/').next())
                        .filter(|id| validate_id(id, "userId").is_ok())
                        .map(|id| Value::String(id.to_owned()))
                        .collect::<Vec<_>>()
                });
            json!({
                "projectPath": item.project_path,
                "iid": item.iid,
                "approvedBy": approved_by,
            })
        })
        .collect::<Vec<_>>();
    Ok(ApiResult {
        data: Value::Array(results),
        next_page: None,
        total_pages: None,
        truncated: false,
    })
}

/// Sends one read-only GraphQL query and returns its `data` object. A response
/// with only `errors` (an unknown field on an older GitLab, a complexity limit)
/// is reported as unsupported rather than as empty data.
async fn post_graphql(
    client: &Client,
    api_base: &Url,
    body: &Value,
    malformed_message: &str,
    missing_message: &str,
) -> Result<Value, AppError> {
    let url = api_base
        .join("../graphql")
        .map_err(|_| AppError::new("INVALID_INPUT", "GitLab GraphQLのURLが正しくありません。"))?;
    let response = client
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|error| transport_error(&error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(status_error(status, response.headers(), false));
    }
    let bytes = read_limited(response, MAX_RESPONSE_BYTES).await?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| unsupported_response(malformed_message))?;
    value
        .get("data")
        .filter(|data| data.is_object())
        .cloned()
        .ok_or_else(|| unsupported_response(missing_message))
}

/// Comments per GraphQL page when reading reactions; GitLab's page size limit.
const NOTE_AWARD_PAGE_SIZE: u32 = 100;
/// Pages read back from the newest comment before the result is marked truncated.
const MAX_NOTE_AWARD_PAGES: usize = 5;
const NOTE_AWARDS_QUERY: &str = "query($path: ID!, $iid: String!, $last: Int!, $before: String) { project(fullPath: $path) { mergeRequest(iid: $iid) { notes(filter: ONLY_COMMENTS, last: $last, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { id awardEmoji { nodes { name user { id username name } } } } } } } }";

/// Reads the reactions on the comments of one merge request from the newest
/// comment back to `since_note_id`, the oldest comment on screen. The REST
/// discussions carry no reactions and the REST reaction list is per comment,
/// so the shown threads cost one GraphQL request per 100 comments instead.
/// GitLab lists comments oldest first; each page reads further back.
async fn fetch_note_awards(
    client: &Client,
    api_base: &Url,
    project_path: &str,
    iid: &str,
    since_note_id: &str,
) -> Result<ApiResult, AppError> {
    validate_project_path(project_path)?;
    validate_id(iid, "iid")?;
    validate_id(since_note_id, "sinceNoteId")?;
    let since = since_note_id.parse::<u64>().unwrap_or(u64::MAX);
    let mut results = Vec::new();
    let mut before: Option<String> = None;
    let mut reached = false;
    for _ in 0..MAX_NOTE_AWARD_PAGES {
        let body = json!({
            "query": NOTE_AWARDS_QUERY,
            "variables": { "path": project_path, "iid": iid, "last": NOTE_AWARD_PAGE_SIZE, "before": before },
        });
        let data = post_graphql(
            client,
            api_base,
            &body,
            "GitLabから対応していない形式のリアクションが返されました。",
            "GitLabからリアクションが返されませんでした。",
        )
        .await?;
        let notes = data
            .get("project")
            .and_then(|project| project.get("mergeRequest"))
            .and_then(|merge_request| merge_request.get("notes"))
            .filter(|notes| notes.is_object())
            .ok_or_else(|| {
                unsupported_response(
                    "GitLabからこのMRのリアクションが返されませんでした。GitLabで確認してください。",
                )
            })?;
        let nodes = notes
            .get("nodes")
            .and_then(Value::as_array)
            .ok_or_else(|| unsupported_response("GitLabから不正なリアクションが返されました。"))?;
        for node in nodes {
            let note_id = node
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| id.rsplit('/').next())
                .filter(|id| validate_id(id, "noteId").is_ok())
                .ok_or_else(|| {
                    unsupported_response("GitLabから不正なコメントIDが返されました。")
                })?;
            let numeric = note_id.parse::<u64>().unwrap_or(0);
            if numeric <= since {
                reached = true;
            }
            if numeric < since {
                continue;
            }
            let awards = node
                .get("awardEmoji")
                .and_then(|awards| awards.get("nodes"))
                .and_then(Value::as_array)
                .map(|awards| awards.iter().map(normalize_graphql_award).collect())
                .unwrap_or_else(|| Ok(Vec::new()))?;
            results.push(json!({ "noteId": note_id, "awards": awards }));
        }
        let page_info = notes.get("pageInfo");
        let has_previous = page_info
            .and_then(|info| info.get("hasPreviousPage"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        before = page_info
            .and_then(|info| info.get("startCursor"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if !has_previous || before.is_none() {
            reached = true;
        }
        if reached {
            break;
        }
    }
    Ok(ApiResult {
        data: Value::Array(results),
        next_page: None,
        total_pages: None,
        truncated: !reached,
    })
}

/// A GraphQL reaction: GitLab's global user ID becomes the REST user ID.
fn normalize_graphql_award(value: &Value) -> Result<Value, AppError> {
    let user = value
        .get("user")
        .filter(|user| user.is_object())
        .ok_or_else(|| unsupported_response("GitLabから不正なリアクションが返されました。"))?;
    let id = user
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| id.rsplit('/').next())
        .unwrap_or_default();
    Ok(json!({
        "name": required_string_field(value, "name", "award emoji")?,
        "user": normalize_user(&json!({
            "id": id,
            "username": user.get("username"),
            "name": user.get("name"),
        }))?,
    }))
}

/// The REST address of the reactions on the MR, or on one of its comments.
fn award_endpoint(
    api_base: &Url,
    project_id: &str,
    iid: &str,
    note_id: Option<&str>,
    award_id: Option<&str>,
) -> Result<Url, AppError> {
    let mut segments = vec!["projects", project_id, "merge_requests", iid];
    if let Some(note_id) = note_id {
        segments.extend(["notes", note_id]);
    }
    segments.push("award_emoji");
    if let Some(award_id) = award_id {
        segments.push(award_id);
    }
    endpoint(api_base, &segments)
}

/// Pages of reactions or To-Dos read when looking for one of them before a write.
const MAX_LOOKUP_PAGES: u32 = 10;

/// The ID of the user's own reaction of that name, read from GitLab, since
/// the reactions on screen may be stale and GraphQL does not return IDs.
async fn find_own_award(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    note_id: Option<&str>,
    name: &str,
    user_id: &str,
) -> Result<Option<String>, AppError> {
    let base = award_endpoint(api_base, project_id, iid, note_id, None)?;
    let mut page = 1;
    while page <= MAX_LOOKUP_PAGES {
        let url = append_query(
            base.clone(),
            vec![
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), "100".to_owned()),
            ],
        );
        let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
        let awards: Value = serde_json::from_slice(&bytes)
            .map_err(|_| unsupported_response("GitLabから不正なリアクションが返されました。"))?;
        let awards = awards
            .as_array()
            .ok_or_else(|| unsupported_response("GitLabから不正なリアクションが返されました。"))?;
        let own = awards.iter().find(|award| {
            award.get("name").and_then(Value::as_str) == Some(name)
                && award
                    .get("user")
                    .and_then(|user| user.get("id"))
                    .and_then(scalar_to_string)
                    .as_deref()
                    == Some(user_id)
        });
        if let Some(own) = own {
            return Ok(Some(required_id_field(own, "id", "award emoji")?));
        }
        match parse_next_page(&headers)? {
            Some(next) if next > page => page = next,
            _ => return Ok(None),
        }
    }
    Err(AppError::new(
        "UNSUPPORTED",
        "リアクションが多すぎるため確認できません。GitLabで操作してください。",
    ))
}

/// Confirms the To-Do is still pending and belongs to the named merge request,
/// so a stale list or another target type never marks the wrong To-Do done.
async fn ensure_pending_merge_request_todo(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    todo_id: &str,
) -> Result<(), AppError> {
    let base = endpoint(api_base, &["todos"])?;
    let mut page = 1;
    while page <= MAX_LOOKUP_PAGES {
        let url = append_query(
            base.clone(),
            vec![
                ("type".to_owned(), "MergeRequest".to_owned()),
                ("state".to_owned(), "pending".to_owned()),
                ("project_id".to_owned(), project_id.to_owned()),
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), "100".to_owned()),
            ],
        );
        let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
        let todos: Value = serde_json::from_slice(&bytes)
            .map_err(|_| unsupported_response("GitLabから不正なToDo一覧が返されました。"))?;
        let todos = todos
            .as_array()
            .ok_or_else(|| unsupported_response("GitLabから不正なToDo一覧が返されました。"))?;
        if let Some(todo) = todos
            .iter()
            .find(|todo| todo.get("id").and_then(scalar_to_string).as_deref() == Some(todo_id))
        {
            let matches = todo.get("target_type").and_then(Value::as_str) == Some("MergeRequest")
                && todo
                    .get("target")
                    .and_then(|target| target.get("iid"))
                    .and_then(scalar_to_string)
                    .as_deref()
                    == Some(iid)
                && todo
                    .get("project")
                    .and_then(|project| project.get("id"))
                    .and_then(scalar_to_string)
                    .as_deref()
                    == Some(project_id);
            if !matches {
                break;
            }
            return Ok(());
        }
        match parse_next_page(&headers)? {
            Some(next) if next > page => page = next,
            _ => break,
        }
    }
    Err(AppError::new(
        "INVALID_INPUT",
        "このTo-Doは完了済みか、このMRのものではありません。To-Do一覧を更新してください。",
    ))
}

async fn get_json_once(client: &Client, url: &Url) -> Result<Value, AppError> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| transport_error(&error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(status_error(status, response.headers(), false));
    }
    let bytes = read_limited(response, MAX_RESPONSE_BYTES).await?;
    serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED",
            "GitLabから対応していない形式の応答が返されました。",
        )
    })
}

async fn send_mutation(
    client: &Client,
    method: Method,
    url: Url,
    body: Value,
    allows_empty: bool,
    refusal: fn(StatusCode) -> Option<AppError>,
    returns_list: bool,
) -> Result<Option<Value>, AppError> {
    let response = send_write(client, method, url, body, refusal).await?;
    let status = response.status();
    if status == StatusCode::NO_CONTENT && allows_empty {
        return Ok(None);
    }
    // A proxy login page, malformed/truncated body, or asynchronous
    // acceptance is not confirmation that this write completed.
    if !matches!(status, StatusCode::OK | StatusCode::CREATED) {
        return Err(unknown_mutation_result());
    }
    let value = read_write_response(response).await?;
    let identified_object = |value: &Value| {
        value.is_object()
            && value.get("id").is_some_and(|id| {
                id.as_u64().is_some_and(|id| id > 0) || id.as_str().is_some_and(|id| !id.is_empty())
            })
    };
    let confirmed = if returns_list {
        value
            .as_array()
            .is_some_and(|items| !items.is_empty() && items.iter().all(identified_object))
    } else {
        identified_object(&value)
    };
    if confirmed {
        Ok(Some(value))
    } else {
        Err(unknown_mutation_result())
    }
}

/// The JSON body of a successful write; anything unreadable leaves the outcome unknown.
async fn read_write_response(response: Response) -> Result<Value, AppError> {
    let bytes = read_limited(response, 2 * 1024 * 1024)
        .await
        .map_err(|_| unknown_mutation_result())?;
    serde_json::from_slice(&bytes).map_err(|_| unknown_mutation_result())
}

/// GitLab accepts a rebase with `202 Accepted` and finishes it in the background.
async fn confirm_rebase(response: Response) -> Result<(), AppError> {
    if response.status() != StatusCode::ACCEPTED {
        return Err(unknown_mutation_result());
    }
    let value = read_write_response(response).await?;
    if value
        .get("rebase_in_progress")
        .is_some_and(Value::is_boolean)
    {
        Ok(())
    } else {
        Err(unknown_mutation_result())
    }
}

/// The cancel endpoint answers `201` with a status instead of the MR: `success`
/// when it cancelled, `error` when nothing was set to merge automatically.
async fn confirm_cancel_auto_merge(response: Response) -> Result<(), AppError> {
    if response.status() != StatusCode::CREATED {
        return Err(unknown_mutation_result());
    }
    let value = read_write_response(response).await?;
    match value.get("status").and_then(Value::as_str) {
        Some("success") => Ok(()),
        Some("error") => Err(AppError::new(
            "INVALID_INPUT",
            "このMRは自動マージに設定されていません。再読み込みして状態を確認してください。",
        )),
        _ => Err(unknown_mutation_result()),
    }
}

/// A GraphQL write answers `200` even when it failed. Errors before or inside
/// the mutation mean GitLab did not apply it; a reply that shows neither the
/// result nor an error leaves the outcome unknown.
async fn confirm_graphql_write(response: Response, field: &str) -> Result<(), AppError> {
    if response.status() != StatusCode::OK {
        return Err(unknown_mutation_result());
    }
    let value = read_write_response(response).await?;
    let payload = value
        .get("data")
        .and_then(|data| data.get(field))
        .filter(|payload| payload.is_object());
    let request_errors = value
        .get("errors")
        .and_then(Value::as_array)
        .filter(|errors| !errors.is_empty());
    match (payload, request_errors) {
        (Some(payload), _) => {
            let errors = payload.get("errors").and_then(Value::as_array);
            match errors {
                Some(errors) if errors.is_empty() && payload["mergeRequest"].is_object() => Ok(()),
                Some(errors) if !errors.is_empty() => Err(AppError::new(
                    "UNSUPPORTED",
                    "GitLabがこの操作を受け付けませんでした。レビュアーに指定されているか、権限と接続先のプランを確認してください。",
                )),
                _ => Err(unknown_mutation_result()),
            }
        }
        (None, Some(errors)) => {
            // GitLab names an unknown field in its schema check, before running anything.
            let unknown_field = errors.iter().any(|error| {
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("doesn't exist on type"))
            });
            Err(AppError::new(
                "UNSUPPORTED",
                if unknown_field {
                    "接続先のGitLabはこの操作に対応していません。GitLabで開いて操作してください。"
                } else {
                    "GitLabがこの操作を受け付けませんでした。権限と接続先の版・プランを確認してください。"
                },
            ))
        }
        (None, None) => Err(unknown_mutation_result()),
    }
}

/// Sends one write and returns a successful response. Failures that may have
/// reached GitLab are reported as `UNKNOWN_OUTCOME`; nothing is retried.
/// `refusal` names what an endpoint means by a client error status, where
/// that differs from the general meaning.
async fn send_write(
    client: &Client,
    method: Method,
    url: Url,
    body: Value,
    refusal: fn(StatusCode) -> Option<AppError>,
) -> Result<Response, AppError> {
    let request = client.request(method, url);
    let response = if body.is_null() {
        request.send().await
    } else {
        request.json(&body).send().await
    };
    match response {
        Ok(response) if response.status().is_success() => Ok(response),
        Ok(response) => {
            let status = response.status();
            if is_recoverable_server_error(status) || status == StatusCode::REQUEST_TIMEOUT {
                Err(AppError::new(
                    "UNKNOWN_OUTCOME",
                    "GitLabから変更結果の確認が得られませんでした。",
                ))
            } else {
                Err(refusal(status)
                    .unwrap_or_else(|| status_error(status, response.headers(), true)))
            }
        }
        Err(error) => Err(AppError::new(
            "UNKNOWN_OUTCOME",
            if error.is_timeout() {
                "変更がGitLabに届いた可能性がありますが、応答がタイムアウトしました。"
            } else {
                "変更がGitLabに届いた可能性がありますが、結果を確認できませんでした。"
            },
        )),
    }
}

fn unknown_mutation_result() -> AppError {
    AppError::new(
        "UNKNOWN_OUTCOME",
        "GitLabから変更結果の確認が得られませんでした。再送する前にGitLabで結果を確認してください。",
    )
}

pub(crate) async fn read_limited(
    mut response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(AppError::new(
            "TOO_LARGE",
            "GitLabの応答が対応できるサイズの上限を超えています。",
        ));
    }

    let mut output = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(&error))?
    {
        if output.len().saturating_add(chunk.len()) > max_bytes {
            return Err(AppError::new(
                "TOO_LARGE",
                "GitLabの応答が対応できるサイズの上限を超えています。",
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

pub(crate) fn status_error(status: StatusCode, headers: &HeaderMap, mutation: bool) -> AppError {
    match status {
        StatusCode::UNAUTHORIZED => AppError::new(
            "AUTH_REQUIRED",
            "GitLabの認証が切れました。再接続してください。",
        ),
        StatusCode::FORBIDDEN if mutation => AppError::new(
            "FORBIDDEN",
            "この操作の権限がありません。コメントや承認には api スコープのトークンが必要です。",
        ),
        StatusCode::FORBIDDEN => AppError::new("FORBIDDEN", "表示する権限がありません。"),
        StatusCode::NOT_FOUND => AppError::new(
            "NOT_FOUND",
            "対象が見つからないか、表示する権限がありません。",
        ),
        StatusCode::TOO_MANY_REQUESTS => {
            let mut error = retry_after_ms(AppError::new("RATE_LIMITED", ""), headers);
            error.message = rate_limited_message(error.retry_after_ms);
            error
        }
        StatusCode::METHOD_NOT_ALLOWED
        | StatusCode::NOT_IMPLEMENTED
        | StatusCode::HTTP_VERSION_NOT_SUPPORTED => AppError::new(
            "UNSUPPORTED",
            "この操作は接続先のGitLabでは利用できません。",
        ),
        _ if status.is_server_error() && mutation => AppError::new(
            "UNKNOWN_OUTCOME",
            "GitLabから変更結果の確認が得られませんでした。",
        ),
        _ if status.is_server_error() => AppError::new(
            "NETWORK",
            "GitLabで一時的なサーバーエラーが発生しました。しばらくしてから再試行してください。",
        ),
        StatusCode::BAD_REQUEST | StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY => {
            AppError::new(
                "INVALID_INPUT",
                "GitLabがリクエストを受け付けませんでした。入力内容を確認してください。",
            )
        }
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => {
            AppError::new("TIMEOUT", TIMEOUT_MESSAGE)
        }
        _ => AppError::new("UNSUPPORTED", "GitLabがリクエストを受け付けませんでした。"),
    }
}

/// The message for a rate-limited request, naming the wait when GitLab gave one.
pub(crate) fn rate_limited_message(retry_after_ms: Option<u64>) -> String {
    match retry_after_ms {
        Some(ms) => format!(
            "GitLabのリクエスト制限に達しました。{}秒後に再試行してください。",
            ms.div_ceil(1_000).max(1)
        ),
        None => {
            "GitLabのリクエスト制限に達しました。しばらく待ってから再試行してください。".to_owned()
        }
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

const TIMEOUT_MESSAGE: &str =
    "GitLabからの応答がタイムアウトしました。しばらくしてから再試行してください。";

fn transport_error(error: &reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::new("TIMEOUT", TIMEOUT_MESSAGE)
    } else if error.is_connect() {
        AppError::new(
            "NETWORK",
            "GitLabに接続できません。ネットワーク接続を確認してください。",
        )
    } else {
        AppError::new("NETWORK", "GitLabへのリクエストを完了できませんでした。")
    }
}

/// The total page count is only a navigation hint, so a missing or malformed
/// header is ignored rather than failing the page that was fetched.
fn parse_total_pages(headers: &HeaderMap) -> Option<u32> {
    headers
        .get("x-total-pages")?
        .to_str()
        .ok()?
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|pages| *pages > 0 && *pages <= MAX_PAGE)
}

fn parse_next_page(headers: &HeaderMap) -> Result<Option<u32>, AppError> {
    let Some(value) = headers.get("x-next-page") else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| AppError::new("UNSUPPORTED", "GitLabから不正なページ情報が返されました。"))?;
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let page = value
        .parse::<u32>()
        .map_err(|_| AppError::new("UNSUPPORTED", "GitLabから不正なページ情報が返されました。"))?;
    if page == 0 || page > MAX_PAGE {
        return Err(AppError::new(
            "UNSUPPORTED",
            "GitLabから対応していないページ番号が返されました。",
        ));
    }
    Ok(Some(page))
}

fn normalize_response(kind: ResponseKind, value: Value) -> Result<Value, AppError> {
    match kind {
        ResponseKind::Users => normalize_array(value, None, normalize_user),
        ResponseKind::Groups => normalize_array(value, None, normalize_group),
        ResponseKind::Project => normalize_project(&value),
        ResponseKind::Todos => normalize_todos(value),
        ResponseKind::Branches => normalize_array(value, None, normalize_branch),
        ResponseKind::Notes => normalize_array(value, None, normalize_note),
        ResponseKind::Projects => normalize_array(value, None, normalize_project),
        ResponseKind::Mrs => normalize_array(value, None, normalize_merge_request),
        ResponseKind::Mr => normalize_merge_request(&value),
        ResponseKind::Diffs => normalize_array(value, Some("changes"), normalize_diff),
        ResponseKind::Discussions => normalize_array(value, None, normalize_discussion),
        ResponseKind::Commits => normalize_array(value, None, normalize_commit),
        ResponseKind::Blame => normalize_array(value, None, normalize_blame_block),
        ResponseKind::CommitMergeRequests => normalize_array(value, None, normalize_associated_merge_request),
        ResponseKind::CommitDiff => normalize_array(value, None, normalize_diff),
        ResponseKind::Drafts => normalize_array(value, None, normalize_draft),
        ResponseKind::Approvals => normalize_approvals(&value),
        ResponseKind::Awards => normalize_array(value, None, normalize_award),
        ResponseKind::Pipelines => normalize_array(value, None, normalize_pipeline),
        ResponseKind::Pipeline => normalize_pipeline(&value),
        ResponseKind::Labels => normalize_array(value, None, normalize_label),
        ResponseKind::Milestones => normalize_array(value, None, normalize_milestone),
        ResponseKind::Versions => normalize_array(value, None, normalize_version),
        ResponseKind::Compare => normalize_array(value, Some("diffs"), normalize_diff),
        ResponseKind::Tree => normalize_array(value, None, normalize_tree_entry),
    }
}

fn normalize_label(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なラベル情報が返されました。")?;
    Ok(json!({
        "id": required_id_field(value, "id", "label")?,
        "name": required_string_field(value, "name", "label")?,
        "color": label_color(value),
        "description": string_field(value, "description"),
    }))
}

/// A label colour GitLab reports as `#rgb` or `#rrggbb`; anything else is
/// dropped so the interface never renders an arbitrary style value.
fn label_color(value: &Value) -> Option<String> {
    value
        .get("color")
        .and_then(Value::as_str)
        .filter(|color| {
            matches!(color.len(), 4 | 7)
                && color.starts_with('#')
                && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .map(str::to_owned)
}

fn normalize_milestone(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なマイルストーン情報が返されました。")?;
    Ok(json!({
        "id": required_id_field(value, "id", "milestone")?,
        "title": required_string_field(value, "title", "milestone")?,
        "state": string_field(value, "state"),
        "dueDate": value.get("due_date").and_then(Value::as_str),
        "webUrl": value.get("web_url").and_then(Value::as_str),
    }))
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
            value.get(wrapper).cloned().ok_or_else(|| {
                unsupported_response("GitLabから想定外の形式の一覧が返されました。")
            })?
        }
    } else {
        value
    };
    let values = value
        .as_array()
        .ok_or_else(|| unsupported_response("GitLabから想定外の形式の一覧が返されました。"))?;
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        normalized.push(normalize_item(value)?);
    }
    Ok(Value::Array(normalized))
}

fn normalize_project(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なプロジェクト情報が返されました。")?;
    let id = required_id_field(value, "id", "project")?;
    let name = required_string_field(value, "name", "project")?;
    let path_with_namespace = required_string_field(value, "path_with_namespace", "project")?;
    let mut project = json!({
        "id": id,
        "name": name,
        "pathWithNamespace": path_with_namespace,
        "description": string_field(value, "description"),
        "webUrl": string_field(value, "web_url"),
        "archived": bool_field(value, "archived"),
    });
    if let Some(last_activity_at) = value.get("last_activity_at").and_then(Value::as_str) {
        project["lastActivityAt"] = last_activity_at.into();
    }
    // `never`, `always`, `default_on` or `default_off`; decides whether a merge squashes.
    if let Some(squash_option) = value.get("squash_option").and_then(Value::as_str) {
        project["squashOption"] = squash_option.into();
    }
    Ok(project)
}

fn normalize_group(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なグループ情報が返されました。")?;
    Ok(json!({
        "id": required_id_field(value, "id", "group")?,
        "name": required_string_field(value, "name", "group")?,
        "fullPath": required_string_field(value, "full_path", "group")?,
        "fullName": string_field(value, "full_name"),
        "webUrl": string_field(value, "web_url"),
    }))
}

fn normalize_branch(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なブランチ情報が返されました。")?;
    let name = required_string_field(value, "name", "branch")?;
    let commit = value.get("commit").filter(|commit| commit.is_object());
    Ok(json!({
        "name": name,
        "default": bool_field(value, "default"),
        "merged": bool_field(value, "merged"),
        "protected": bool_field(value, "protected"),
        "webUrl": string_field(value, "web_url"),
        "commit": commit.map(|commit| json!({
            "id": string_field(commit, "id"),
            "shortId": string_field(commit, "short_id"),
            "title": string_field(commit, "title"),
            "authorName": string_field(commit, "author_name"),
            "committedDate": string_field(commit, "committed_date"),
        })),
    }))
}

/// A folder entry: `tree` is a folder, `blob` a file and `commit` a submodule.
fn normalize_tree_entry(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なファイル一覧が返されました。")?;
    let kind = required_string_field(value, "type", "tree entry")?;
    if !matches!(kind.as_str(), "tree" | "blob" | "commit") {
        return Err(unsupported_response(
            "GitLabから対応していない種類のファイルが返されました。",
        ));
    }
    Ok(json!({
        "id": required_string_field(value, "id", "tree entry")?,
        "name": required_string_field(value, "name", "tree entry")?,
        "path": required_string_field(value, "path", "tree entry")?,
        "type": kind,
    }))
}

fn normalize_todos(value: Value) -> Result<Value, AppError> {
    let items = value
        .as_array()
        .ok_or_else(|| unsupported_response("GitLabから不正なToDo一覧が返されました。"))?;
    let mut normalized = Vec::new();
    for item in items {
        if item.get("target_type").and_then(Value::as_str) != Some("MergeRequest") {
            continue;
        }
        let target = item
            .get("target")
            .ok_or_else(|| unsupported_response("GitLabから不正なToDoの対象が返されました。"))?;
        let project = normalize_project(item.get("project").ok_or_else(|| {
            unsupported_response("GitLabから不正なToDoのプロジェクト情報が返されました。")
        })?)?;
        let author = normalize_user(item.get("author").ok_or_else(|| {
            unsupported_response("GitLabから不正なToDoの作成者情報が返されました。")
        })?)?;
        normalized.push(json!({
            "id": required_id_field(item, "id", "todo")?,
            "actionName": required_string_field(item, "action_name", "todo")?,
            "body": string_field(item, "body"),
            "createdAt": required_string_field(item, "created_at", "todo")?,
            "projectId": project["id"],
            "projectName": project["name"],
            "iid": required_id_field(target, "iid", "todo target")?,
            "title": required_string_field(target, "title", "todo target")?,
            "webUrl": required_string_field(item, "target_url", "todo")?,
            "author": author,
        }));
    }
    Ok(Value::Array(normalized))
}

fn optional_users(value: &Value, field: &str) -> Result<Vec<Value>, AppError> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(users)) => users.iter().map(normalize_user).collect(),
        _ => Err(unsupported_response(
            "GitLabから不正なユーザー一覧が返されました。",
        )),
    }
}

fn normalize_merge_request(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なMR情報が返されました。")?;
    let id = required_id_field(value, "id", "merge request")?;
    let iid = required_id_field(value, "iid", "merge request")?;
    let project_id = required_id_field(value, "project_id", "merge request")?;
    let title = required_string_field(value, "title", "merge request")?;
    let state = required_string_field(value, "state", "merge request")?;
    let author =
        normalize_user(value.get("author").ok_or_else(|| {
            unsupported_response("GitLabから不正なMRの作成者情報が返されました。")
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
    let project_path = value
        .get("references")
        .and_then(|refs| refs.get("full"))
        .and_then(Value::as_str)
        .and_then(|reference| reference.strip_suffix(&format!("!{iid}")))
        .filter(|path| validate_project_path(path).is_ok());
    let labels = match value.get("labels") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(labels)) => labels
            .iter()
            .map(|label| {
                label
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| unsupported_response("GitLabから不正なラベルが返されました。"))
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(unsupported_response(
                "GitLabから不正なラベルが返されました。",
            ))
        }
    };
    let pipeline = value
        .get("head_pipeline")
        .filter(|pipeline| pipeline.is_object())
        .map(|pipeline| {
            json!({
                "status": string_field(pipeline, "status"),
                "webUrl": string_field(pipeline, "web_url"),
            })
        });
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
    let mut merge_request = json!({
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
        "projectPath": project_path,
        "draft": bool_field(value, "draft"),
        "labels": labels,
        "assignees": optional_users(value, "assignees")?,
        "reviewers": optional_users(value, "reviewers")?,
        "pipeline": pipeline,
    });
    if let Some(created_at) = value.get("created_at").and_then(Value::as_str) {
        merge_request["createdAt"] = created_at.into();
    }
    // What the merge controls need. A field GitLab did not send stays null,
    // so the interface can tell "unknown" apart from false.
    let optional_bool = |field: &str| value.get(field).and_then(Value::as_bool);
    let optional_string = |field: &str| value.get(field).and_then(Value::as_str);
    let merge = json!({
        "detailedMergeStatus": optional_string("detailed_merge_status"),
        "mergeStatus": optional_string("merge_status"),
        "hasConflicts": optional_bool("has_conflicts"),
        "blockingDiscussionsResolved": optional_bool("blocking_discussions_resolved"),
        "squash": optional_bool("squash"),
        "squashOnMerge": optional_bool("squash_on_merge"),
        "forceRemoveSourceBranch": optional_bool("force_remove_source_branch"),
        "shouldRemoveSourceBranch": optional_bool("should_remove_source_branch"),
        "autoMerge": optional_bool("merge_when_pipeline_succeeds"),
        "rebaseInProgress": optional_bool("rebase_in_progress"),
        "divergedCommitsCount": value.get("diverged_commits_count").and_then(Value::as_u64),
        "canMerge": value.get("user").and_then(|user| user.get("can_merge")).and_then(Value::as_bool),
        "mergeError": optional_string("merge_error"),
    });
    if let (Value::Object(target), Value::Object(fields)) = (&mut merge_request, merge) {
        target.extend(fields);
    }
    merge_request["milestone"] = value
        .get("milestone")
        .filter(|milestone| milestone.is_object())
        .map(normalize_milestone)
        .transpose()?
        .unwrap_or(Value::Null);
    if merge_request["milestone"].is_null() && value.get("milestone").is_some_and(|m| !m.is_null())
    {
        return Err(unsupported_response(
            "GitLabから不正なマイルストーン情報が返されました。",
        ));
    }
    Ok(merge_request)
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
        .ok_or_else(|| unsupported_response("GitLabから不正なスレッドが返されました。"))?;
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
    let author = normalize_user(value.get("author").ok_or_else(|| {
        unsupported_response("GitLabから不正なコメントの作成者情報が返されました。")
    })?)?;
    let mut note = json!({
        "id": string_field(value, "id"),
        "body": string_field(value, "body"),
        "author": author,
        "createdAt": string_field(value, "created_at"),
        "updatedAt": value.get("updated_at").and_then(Value::as_str),
        "system": bool_field(value, "system"),
        "resolvable": bool_field(value, "resolvable"),
        "resolved": bool_field(value, "resolved"),
        "position": value.get("position").and_then(normalize_position),
    });
    // GitLab lists the suggestions of a diff comment in body order, with the
    // IDs that apply them.
    if let Some(suggestions) = value.get("suggestions").and_then(Value::as_array) {
        let suggestions = suggestions
            .iter()
            .filter_map(normalize_suggestion)
            .collect::<Vec<_>>();
        if !suggestions.is_empty() {
            note["suggestions"] = Value::Array(suggestions);
        }
    }
    Ok(note)
}

fn normalize_suggestion(value: &Value) -> Option<Value> {
    let id = value.get("id").and_then(scalar_to_string)?;
    validate_id(&id, "suggestionId").ok()?;
    Some(json!({
        "id": id,
        "fromLine": value.get("from_line").and_then(Value::as_u64),
        "toLine": value.get("to_line").and_then(Value::as_u64),
        // The entity names it `appliable`; the API documentation `applicable`.
        "appliable": bool_field(value, "appliable") || bool_field(value, "applicable"),
        "applied": bool_field(value, "applied"),
        "fromContent": string_field(value, "from_content"),
        "toContent": string_field(value, "to_content"),
    }))
}

fn normalize_version(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なバージョン情報が返されました。")?;
    let head_commit_sha = required_string_field(value, "head_commit_sha", "version")?;
    validate_sha(&head_commit_sha, "headCommitSha")
        .map_err(|_| unsupported_response("GitLabから不正なバージョン情報が返されました。"))?;
    Ok(json!({
        "id": required_id_field(value, "id", "version")?,
        "headCommitSha": head_commit_sha,
        "baseCommitSha": string_field(value, "base_commit_sha"),
        "startCommitSha": string_field(value, "start_commit_sha"),
        "createdAt": string_field(value, "created_at"),
        "state": string_field(value, "state"),
        "realSize": string_field(value, "real_size"),
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
    if let Some(range) = value.get("line_range").and_then(normalize_line_range) {
        position.insert("lineRange".to_owned(), range);
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

/// The first and last line of a multi-line comment, for showing its range.
fn normalize_line_range(value: &Value) -> Option<Value> {
    let point = |name: &str| {
        let point = value.get(name).filter(|point| point.is_object())?;
        let mut normalized = Map::new();
        for (field, key) in [("old_line", "oldLine"), ("new_line", "newLine")] {
            if let Some(line) = point.get(field).and_then(Value::as_u64) {
                normalized.insert(key.to_owned(), Value::Number(line.into()));
            }
        }
        if normalized.is_empty() {
            return None;
        }
        if let Some(kind) = point
            .get("type")
            .and_then(Value::as_str)
            .filter(|kind| matches!(*kind, "old" | "new"))
        {
            normalized.insert("type".to_owned(), Value::String(kind.to_owned()));
        }
        Some(Value::Object(normalized))
    };
    Some(json!({ "start": point("start")?, "end": point("end")? }))
}

fn normalize_blame_block(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なBlame情報が返されました。")?;
    let commit = value.get("commit").ok_or_else(|| unsupported_response("Blameのコミット情報がありません。"))?;
    require_object(commit, "Blameのコミット情報が不正です。")?;
    let lines = value.get("lines").and_then(Value::as_array)
        .ok_or_else(|| unsupported_response("Blameの行情報が不正です。"))?;
    if lines.len() > 100 {
        return Err(unsupported_response("Blameの行数が上限を超えています。"));
    }
    let mut text = Vec::with_capacity(lines.len());
    for line in lines {
        let Some(line) = line.as_str() else {
            return Err(unsupported_response("Blameの行情報が不正です。"));
        };
        text.push(line);
    }
    Ok(json!({
        "commitId": required_string_field(commit, "id", "blame commit")?,
        "title": string_field(commit, "title"),
        "authorName": string_field(commit, "author_name"),
        "committedAt": string_field(commit, "committed_date"),
        "lines": text,
    }))
}

fn normalize_associated_merge_request(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正な関連MR情報が返されました。")?;
    Ok(json!({
        "projectId": required_id_field(value, "project_id", "associated MR")?,
        "iid": required_id_field(value, "iid", "associated MR")?,
        "title": required_string_field(value, "title", "associated MR")?,
        "webUrl": required_string_field(value, "web_url", "associated MR")?,
        "state": string_field(value, "state"),
    }))
}

fn normalize_commit(value: &Value) -> Result<Value, AppError> {
    Ok(json!({
        "id": string_field(value, "id"),
        "title": string_field(value, "title"),
        "createdAt": string_field(value, "created_at"),
        "committedAt": value.get("committed_date").and_then(Value::as_str).unwrap_or_else(|| value.get("created_at").and_then(Value::as_str).unwrap_or("")),
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
        .ok_or_else(|| unsupported_response("GitLabから不正な承認情報が返されました。"))?;
    let approved_by = approved_by
        .iter()
        .map(|item| normalize_user(item.get("user").unwrap_or(item)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "approved": bool_field(value, "approved"),
        "approvedBy": approved_by,
    }))
}

fn normalize_award(value: &Value) -> Result<Value, AppError> {
    let user = normalize_user(value.get("user").ok_or_else(|| {
        unsupported_response("GitLabから不正なリアクションのユーザー情報が返されました。")
    })?)?;
    Ok(json!({
        "name": required_string_field(value, "name", "award emoji")?,
        "user": user,
    }))
}

fn normalize_pipeline(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なパイプライン情報が返されました。")?;
    Ok(json!({
        "id": required_id_field(value, "id", "pipeline")?,
        // Absent on old servers; the MR's project is then assumed.
        "projectId": value
            .get("project_id")
            .and_then(scalar_to_string)
            .filter(|id| validate_id(id, "projectId").is_ok()),
        "status": string_field(value, "status"),
        "ref": string_field(value, "ref"),
        "sha": string_field(value, "sha"),
        "source": value.get("source").and_then(Value::as_str),
        "createdAt": value.get("created_at").and_then(Value::as_str),
        "updatedAt": value.get("updated_at").and_then(Value::as_str),
        "startedAt": value.get("started_at").and_then(Value::as_str),
        "finishedAt": value.get("finished_at").and_then(Value::as_str),
        "duration": value.get("duration").and_then(Value::as_f64),
        "webUrl": string_field(value, "web_url"),
    }))
}

fn normalize_job(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なジョブ情報が返されました。")?;
    Ok(json!({
        "id": required_id_field(value, "id", "job")?,
        "kind": "job",
        "name": string_field(value, "name"),
        "stage": string_field(value, "stage"),
        "status": string_field(value, "status"),
        "allowFailure": bool_field(value, "allow_failure"),
        "createdAt": value.get("created_at").and_then(Value::as_str),
        "startedAt": value.get("started_at").and_then(Value::as_str),
        "finishedAt": value.get("finished_at").and_then(Value::as_str),
        "duration": value.get("duration").and_then(Value::as_f64),
        "failureReason": value.get("failure_reason").and_then(Value::as_str),
        "webUrl": string_field(value, "web_url"),
        "downstreamPipeline": Value::Null,
    }))
}

/// A trigger job ("bridge"), which starts a downstream pipeline instead of running a script.
fn normalize_trigger_job(value: &Value) -> Result<Value, AppError> {
    let mut job = normalize_job(value)?;
    job["kind"] = "bridge".into();
    if let Some(downstream) = value
        .get("downstream_pipeline")
        .filter(|pipeline| pipeline.is_object())
    {
        job["downstreamPipeline"] = json!({
            "id": string_field(downstream, "id"),
            "status": string_field(downstream, "status"),
            "webUrl": string_field(downstream, "web_url"),
        });
    }
    Ok(job)
}

fn normalize_user(value: &Value) -> Result<Value, AppError> {
    require_object(value, "GitLabから不正なユーザー情報が返されました。")?;
    let mut user = json!({
        "id": required_id_field(value, "id", "user")?,
        "username": required_string_field(value, "username", "user")?,
        "name": required_string_field(value, "name", "user")?,
    });
    if let Some(avatar) = value
        .get("avatar_url")
        .and_then(Value::as_str)
        .filter(|avatar| !avatar.is_empty() && avatar.len() <= 2048)
    {
        user["avatarUrl"] = avatar.into();
    }
    Ok(user)
}

fn require_object(value: &Value, message: &str) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(unsupported_response(message));
    }
    Ok(())
}

fn required_id_field(value: &Value, field: &str, resource: &str) -> Result<String, AppError> {
    let id = value.get(field).and_then(scalar_to_string).ok_or_else(|| {
        unsupported_response(&format!("GitLabから不正なIDが返されました（{resource}）。"))
    })?;
    if !id.bytes().all(|byte| byte.is_ascii_digit()) || !id.parse::<u64>().is_ok_and(|id| id > 0) {
        return Err(unsupported_response(&format!(
            "GitLabから不正なIDが返されました（{resource}）。"
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
            unsupported_response(&format!(
                "GitLabから不正な応答が返されました（{resource}）。"
            ))
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
    if let Some(range) = &position.line_range {
        let file_path = if position.new_path.is_empty() {
            &position.old_path
        } else {
            &position.new_path
        };
        let file_hash = sha1_hex(file_path.as_bytes());
        value.insert(
            "line_range".to_owned(),
            json!({
                "start": line_range_point_to_api_value(&file_hash, &range.start),
                "end": line_range_point_to_api_value(&file_hash, &range.end),
            }),
        );
    }
    Value::Object(value)
}

/// GitLab identifies a diff line by `<SHA-1 of the file path>_<old>_<new>`,
/// where an added line counts the old side's next line and a removed line the
/// new side's.
fn line_range_point_to_api_value(file_hash: &str, point: &LineRangePoint) -> Value {
    let mut value = Map::new();
    value.insert(
        "line_code".to_owned(),
        Value::String(format!(
            "{file_hash}_{}_{}",
            point.old_position, point.new_position
        )),
    );
    // GitLab's rule: `new` for an added line, otherwise `old`.
    let kind = if point.old_line.is_none() {
        "new"
    } else {
        "old"
    };
    value.insert("type".to_owned(), Value::String(kind.to_owned()));
    if let Some(line) = point.old_line {
        value.insert("old_line".to_owned(), Value::Number(line.into()));
    }
    if let Some(line) = point.new_line {
        value.insert("new_line".to_owned(), Value::Number(line.into()));
    }
    Value::Object(value)
}

/// SHA-1 as lowercase hex. Only used for GitLab's line codes, which are
/// identifiers rather than a security measure.
fn sha1_hex(data: &[u8]) -> String {
    let mut state: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut message = data.to_vec();
    let bit_length = (data.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());
    for block in message.as_chunks::<64>().0 {
        let mut words = [0_u32; 80];
        for (index, word) in block.as_chunks::<4>().0.iter().enumerate() {
            words[index] = u32::from_be_bytes(*word);
        }
        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (index, word) in words.iter().enumerate() {
            let (mixed, constant) = match index {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(mixed)
                .wrapping_add(e)
                .wrapping_add(constant)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (value, add) in state.iter_mut().zip([a, b, c, d, e]) {
            *value = value.wrapping_add(add);
        }
    }
    state.iter().map(|value| format!("{value:08x}")).collect()
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
        Action::UploadAttachment { file_name, .. } => {
            crate::attachments::validate_filename(file_name)?;
        }
        Action::SetAssignees {
            user_ids,
            expected_user_ids,
            ..
        }
        | Action::SetReviewers {
            user_ids,
            expected_user_ids,
            ..
        } => {
            validate_user_ids(user_ids)?;
            validate_user_ids(expected_user_ids)?;
        }
        Action::SetDescription {
            description,
            expected_description,
            ..
        } => {
            validate_description(description)?;
            validate_description(expected_description)?;
        }
        Action::AddAward { note_id, name, .. } | Action::RemoveAward { note_id, name, .. } => {
            if let Some(note_id) = note_id {
                validate_id(note_id, "noteId")?;
            }
            validate_award_name(name)?;
        }
        Action::MarkTodoDone { todo_id, .. } => validate_id(todo_id, "todoId")?,
        Action::RetryJob {
            pipeline_project_id,
            job_id,
            ..
        }
        | Action::CancelJob {
            pipeline_project_id,
            job_id,
            ..
        }
        | Action::PlayJob {
            pipeline_project_id,
            job_id,
            ..
        } => {
            validate_id(pipeline_project_id, "pipelineProjectId")?;
            validate_id(job_id, "jobId")?;
        }
        Action::RetryPipeline {
            pipeline_project_id,
            pipeline_id,
            ..
        }
        | Action::CancelPipeline {
            pipeline_project_id,
            pipeline_id,
            ..
        } => {
            validate_id(pipeline_project_id, "pipelineProjectId")?;
            validate_id(pipeline_id, "pipelineId")?;
        }
        Action::Merge {
            sha,
            merge_commit_message,
            ..
        } => {
            validate_sha(sha, "sha")?;
            if let Some(message) = merge_commit_message {
                if message.trim().is_empty() || message.len() > MAX_ACTION_BODY_BYTES {
                    return Err(AppError::new(
                        "INVALID_INPUT",
                        "マージコミットのメッセージは空にできず、上限を超えられません。",
                    ));
                }
            }
        }
        Action::Rebase { sha, .. } => validate_sha(sha, "sha")?,
        Action::CancelAutoMerge { .. } | Action::SetState { .. } => {}
        Action::SetTitle {
            title,
            expected_title,
            ..
        } => {
            validate_title(title)?;
            if expected_title.chars().count() > MAX_TITLE_CHARS {
                return Err(AppError::new("INVALID_INPUT", "タイトルが長すぎます。"));
            }
        }
        Action::SetLabels {
            add_labels,
            remove_labels,
            ..
        } => {
            validate_labels(add_labels)?;
            validate_labels(remove_labels)?;
            if add_labels.is_empty() && remove_labels.is_empty()
                || add_labels.len() + remove_labels.len() > MAX_LABEL_CHANGES
                || add_labels.iter().any(|label| remove_labels.contains(label))
            {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "追加または削除するラベルを重複なく指定してください。",
                ));
            }
        }
        Action::SetMilestone {
            milestone_id,
            expected_milestone_id,
            ..
        } => {
            for id in [milestone_id, expected_milestone_id].into_iter().flatten() {
                validate_id(id, "milestoneId")?;
            }
        }
        Action::RequestChanges { project_path, .. } => validate_project_path(project_path)?,
        Action::RerequestReview {
            project_path,
            user_id,
            ..
        } => {
            validate_project_path(project_path)?;
            validate_id(user_id, "userId")?;
        }
        Action::ApplySuggestions {
            suggestion_ids,
            head_sha,
            commit_message,
            ..
        } => {
            validate_suggestion_ids(suggestion_ids)?;
            validate_sha(head_sha, "headSha")?;
            if let Some(message) = commit_message {
                validate_commit_message(message)?;
            }
        }
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
            "行番号は1以上で指定してください。",
        ));
    }
    if matches!(position.position_type, PositionType::Text)
        && position.old_line.is_none()
        && position.new_line.is_none()
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "行の位置には変更前または変更後の行番号が必要です。",
        ));
    }
    if let Some(range) = &position.line_range {
        validate_line_range(position, range)?;
    }
    Ok(())
}

/// A multi-line comment covers lines of one hunk, ends at the commented line
/// and starts at or before it.
fn validate_line_range(position: &Position, range: &LineRange) -> Result<(), AppError> {
    let invalid = || {
        AppError::new(
            "INVALID_INPUT",
            "複数行コメントの範囲が正しくありません。同じ変更ブロック内の行を選び直してください。",
        )
    };
    if !matches!(position.position_type, PositionType::Text) {
        return Err(invalid());
    }
    let hunk = range.hunk;
    let old_end = hunk
        .old_start
        .checked_add(hunk.old_count)
        .ok_or_else(invalid)?;
    let new_end = hunk
        .new_start
        .checked_add(hunk.new_count)
        .ok_or_else(invalid)?;
    for point in [&range.start, &range.end] {
        let shown_matches = point.old_line.is_none_or(|line| line == point.old_position)
            && point.new_line.is_none_or(|line| line == point.new_position);
        let in_hunk = (hunk.old_start..=old_end).contains(&point.old_position)
            && (hunk.new_start..=new_end).contains(&point.new_position);
        if (point.old_line.is_none() && point.new_line.is_none())
            || point.old_line == Some(0)
            || point.new_line == Some(0)
            || !shown_matches
            || !in_hunk
        {
            return Err(invalid());
        }
    }
    let ends_at_position =
        range.end.old_line == position.old_line && range.end.new_line == position.new_line;
    let ordered = range.start.old_position <= range.end.old_position
        && range.start.new_position <= range.end.new_position;
    if !ends_at_position || !ordered {
        return Err(invalid());
    }
    Ok(())
}

fn validate_suggestion_ids(ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() || ids.len() > MAX_SUGGESTIONS {
        return Err(AppError::new(
            "INVALID_INPUT",
            "適用する提案を1件以上、100件以内で選んでください。",
        ));
    }
    for (index, id) in ids.iter().enumerate() {
        validate_id(id, "suggestionIds")?;
        if ids[..index].contains(id) {
            return Err(AppError::new(
                "INVALID_INPUT",
                "同じ提案が重複して選択されています。",
            ));
        }
    }
    Ok(())
}

fn validate_commit_message(message: &str) -> Result<(), AppError> {
    let has_control = message
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'));
    if message.trim().is_empty() || message.len() > MAX_COMMIT_MESSAGE_BYTES || has_control {
        return Err(AppError::new(
            "INVALID_INPUT",
            "コミットメッセージは空にせず、4 KiB以内で入力してください。",
        ));
    }
    Ok(())
}

fn validate_description(value: &str) -> Result<(), AppError> {
    if value.len() > MAX_DESCRIPTION_BYTES {
        return Err(AppError::new(
            "INVALID_INPUT",
            "説明が保存できるサイズの上限を超えています。",
        ));
    }
    Ok(())
}

fn validate_title(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty()
        || value.chars().count() > MAX_TITLE_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "タイトルは1〜255文字の1行で入力してください。",
        ));
    }
    Ok(())
}

fn validate_user_ids(ids: &[String]) -> Result<(), AppError> {
    if ids.len() > MAX_PEOPLE {
        return Err(AppError::new(
            "INVALID_INPUT",
            "選択したユーザーが多すぎます。",
        ));
    }
    for (index, id) in ids.iter().enumerate() {
        validate_id(id, "userIds")?;
        if ids[..index].contains(id) {
            return Err(AppError::new(
                "INVALID_INPUT",
                "同じユーザーが重複して選択されています。",
            ));
        }
    }
    Ok(())
}

/// GitLab emoji names such as `thumbsup`, `+1` or `flag_jp`, without colons.
fn validate_award_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.len() > 64
        || !name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'+' | b'-')
        })
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "リアクションの絵文字名が正しくありません。",
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
            "コメントを入力してください。",
        ));
    }
    if value.len() > MAX_ACTION_BODY_BYTES {
        return Err(AppError::new(
            "INVALID_INPUT",
            "コメントが送信できるサイズの上限を超えています。",
        ));
    }
    Ok(())
}

pub(crate) fn validate_id(value: &str, field: &str) -> Result<(), AppError> {
    if value.parse::<u64>().ok().is_none_or(|id| id == 0)
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            &format!("{field}は数値のIDで指定してください。"),
        ));
    }
    Ok(())
}

fn validate_group_id(value: &str) -> Result<(), AppError> {
    if value.bytes().all(|byte| byte.is_ascii_digit()) {
        return validate_id(value, "groupId");
    }
    if value.split('/').any(|segment| {
        segment.is_empty()
            || matches!(segment, "." | "..")
            || !segment
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    }) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "groupIdは数値のIDまたはグループのパスで指定してください。",
        ));
    }
    Ok(())
}

fn validate_labels(labels: &[String]) -> Result<(), AppError> {
    if labels.iter().any(|label| {
        label.trim().is_empty() || label.contains(',') || label.chars().any(char::is_control)
    }) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "ラベル名は空にできず、カンマも含められません。",
        ));
    }
    Ok(())
}

fn validate_discussion_id(value: &str) -> Result<(), AppError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "discussionIdの形式が正しくありません。",
        ));
    }
    Ok(())
}

fn validate_sha(value: &str, field: &str) -> Result<(), AppError> {
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            &format!("{field}は完全なコミットSHA（16進数）で指定してください。"),
        ));
    }
    Ok(())
}

/// A branch or tag name as Git allows it; it travels as a query parameter.
fn validate_ref(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 255
        || value.contains("..")
        || value.contains('\\')
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "ブランチ名が正しくありません。",
        ));
    }
    Ok(())
}

fn validate_project_path(value: &str) -> Result<(), AppError> {
    if value.chars().any(char::is_control)
        || value.contains('\\')
        || value.split('/').count() < 2
        || value
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "プロジェクトのパスが正しくありません。",
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
            "リポジトリのファイルパスが正しくありません。",
        ));
    }
    Ok(())
}

fn validate_page(page: u32) -> Result<(), AppError> {
    if page == 0 || page > MAX_PAGE {
        return Err(AppError::new(
            "INVALID_INPUT",
            "ページ番号が対応範囲外です。",
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

async fn ensure_people(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    field: &str,
    expected: &[String],
) -> Result<(), AppError> {
    let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
    let value = get_json_once(client, &url).await?;
    if user_id_set(&value, field) != Some(expected.iter().cloned().collect()) {
        return Err(stale_merge_request());
    }
    Ok(())
}

async fn ensure_description(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    expected: &str,
) -> Result<(), AppError> {
    let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
    let value = get_json_once(client, &url).await?;
    // GitLab returns null for an MR without a description.
    let current = match value.get("description") {
        Some(Value::String(text)) => text.as_str(),
        Some(Value::Null) | None => "",
        Some(_) => return Err(stale_merge_request()),
    };
    if current != expected {
        return Err(stale_merge_request());
    }
    Ok(())
}

/// Reads the MR once and refuses the write unless it is still as the user saw it.
async fn ensure_merge_request(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    iid: &str,
    unchanged: impl FnOnce(&Value) -> bool,
) -> Result<(), AppError> {
    let url = endpoint(api_base, &["projects", project_id, "merge_requests", iid])?;
    let value = get_json_once(client, &url).await?;
    if !unchanged(&value) {
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

/// Refuses an operation that the job or pipeline no longer allows, for
/// example cancelling one that already finished while the view was open.
async fn ensure_ci_operation_allowed(
    client: &Client,
    api_base: &Url,
    target: CiTarget,
    project_id: &str,
    id: &str,
    operation: CiOperation,
) -> Result<(), AppError> {
    let resource = match target {
        CiTarget::Job => "jobs",
        CiTarget::Pipeline => "pipelines",
    };
    let url = endpoint(api_base, &["projects", project_id, resource, id])?;
    let value = get_json_once(client, &url).await?;
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let archived = bool_field(&value, "archived");
    let allowed = match operation {
        CiOperation::Cancel => CANCELABLE_STATUSES.contains(&status),
        CiOperation::Retry => {
            !archived
                && match target {
                    CiTarget::Job => matches!(status, "success" | "failed" | "canceled"),
                    CiTarget::Pipeline => matches!(status, "failed" | "canceled"),
                }
        }
        CiOperation::Play => !archived && status == "manual",
    };
    if allowed {
        return Ok(());
    }
    let shown = if !status.is_empty()
        && status.len() <= 32
        && status
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
    {
        status
    } else {
        "不明"
    };
    let subject = match target {
        CiTarget::Job => "ジョブ",
        CiTarget::Pipeline => "パイプライン",
    };
    Err(AppError::new(
        "INVALID_INPUT",
        &if archived {
            format!("この{subject}はアーカイブ済みのため操作できません。")
        } else {
            format!("{subject}の状態が変わったため、この操作はできません（現在: {shown}）。再読み込みしてから操作してください。")
        },
    ))
}

/// Reads a pipeline's jobs and trigger jobs, each up to a page bound. More
/// jobs than the bound mark the result truncated rather than complete.
async fn fetch_pipeline_jobs(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    pipeline_id: &str,
) -> Result<ApiResult, AppError> {
    validate_id(project_id, "projectId")?;
    validate_id(pipeline_id, "pipelineId")?;
    let (mut items, mut truncated) = fetch_job_pages(
        client,
        api_base,
        project_id,
        pipeline_id,
        "jobs",
        MAX_JOB_PAGES,
        normalize_job,
    )
    .await?;
    // GitLab 19.2 renamed the trigger job list; older servers know only `bridges`.
    let trigger_jobs = match fetch_job_pages(
        client,
        api_base,
        project_id,
        pipeline_id,
        "bridges",
        MAX_TRIGGER_JOB_PAGES,
        normalize_trigger_job,
    )
    .await
    {
        Err(error) if error.code == "NOT_FOUND" => {
            fetch_job_pages(
                client,
                api_base,
                project_id,
                pipeline_id,
                "trigger_jobs",
                MAX_TRIGGER_JOB_PAGES,
                normalize_trigger_job,
            )
            .await?
        }
        result => result?,
    };
    items.extend(trigger_jobs.0);
    truncated |= trigger_jobs.1;
    Ok(ApiResult {
        data: Value::Array(items),
        next_page: None,
        total_pages: None,
        truncated,
    })
}

async fn fetch_job_pages(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    pipeline_id: &str,
    resource: &str,
    max_pages: u32,
    normalize_item: fn(&Value) -> Result<Value, AppError>,
) -> Result<(Vec<Value>, bool), AppError> {
    let mut items = Vec::new();
    let mut page = 1;
    loop {
        let url = append_query(
            endpoint(
                api_base,
                &["projects", project_id, "pipelines", pipeline_id, resource],
            )?,
            vec![
                ("page".to_owned(), page.to_string()),
                ("per_page".to_owned(), JOB_PER_PAGE.to_string()),
            ],
        );
        let (bytes, headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
            unsupported_response("GitLabから対応していない形式の応答が返されました。")
        })?;
        if let Value::Array(values) = normalize_array(value, None, normalize_item)? {
            items.extend(values);
        }
        match parse_next_page(&headers)? {
            None => return Ok((items, false)),
            Some(next) if next <= page => {
                return Err(unsupported_response(
                    "GitLabから不正なページ情報が返されました。",
                ))
            }
            Some(_) if page >= max_pages => return Ok((items, true)),
            Some(next) => page = next,
        }
    }
}

/// Reads the end of a job log. A suffix range is requested; a server that
/// ignores it sends the whole log, of which only the end is kept.
async fn fetch_job_trace(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    job_id: &str,
) -> Result<ApiResult, AppError> {
    validate_id(project_id, "projectId")?;
    validate_id(job_id, "jobId")?;
    let url = endpoint(api_base, &["projects", project_id, "jobs", job_id, "trace"])?;
    let (bytes, head_omitted) = get_trace_tail(client, &url).await?;
    let (lines, head_omitted) = render_trace(&bytes, head_omitted);
    Ok(ApiResult {
        data: json!({ "lines": lines, "headOmitted": head_omitted }),
        next_page: None,
        total_pages: None,
        truncated: head_omitted,
    })
}

async fn get_trace_tail(client: &Client, url: &Url) -> Result<(Vec<u8>, bool), AppError> {
    let mut retries = 0;
    loop {
        let response = match client
            .get(url.clone())
            .header(reqwest::header::RANGE, format!("bytes=-{MAX_TRACE_BYTES}"))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                if retries < MAX_GET_RETRIES {
                    retries += 1;
                    wait_for_get_retry(retries).await;
                    continue;
                }
                return Err(transport_error(&error));
            }
        };
        let status = response.status();
        if is_recoverable_server_error(status) && retries < MAX_GET_RETRIES {
            retries += 1;
            wait_for_get_retry(retries).await;
            continue;
        }
        // A suffix range of an empty log cannot be satisfied.
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            return Ok((Vec::new(), false));
        }
        if !status.is_success() {
            return Err(status_error(status, response.headers(), false));
        }
        if !matches!(status, StatusCode::OK | StatusCode::PARTIAL_CONTENT) {
            return Err(unsupported_response(
                "GitLabから対応していない形式のジョブログが返されました。",
            ));
        }
        let range_start = (status == StatusCode::PARTIAL_CONTENT)
            .then(|| content_range_start(response.headers()))
            .flatten();
        match read_tail(response).await {
            Ok((bytes, dropped)) => {
                let head_omitted = dropped
                    || match (status, range_start) {
                        (StatusCode::PARTIAL_CONTENT, Some(start)) => start > 0,
                        (StatusCode::PARTIAL_CONTENT, None) => bytes.len() >= MAX_TRACE_BYTES,
                        _ => false,
                    };
                return Ok((bytes, head_omitted));
            }
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
}

/// The first byte of a `Content-Range: bytes <start>-<end>/<size>` response.
fn content_range_start(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .trim()
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Keeps the last `MAX_TRACE_BYTES` of the body; reports whether any were dropped.
async fn read_tail(mut response: Response) -> Result<(Vec<u8>, bool), AppError> {
    let too_large = || {
        AppError::new(
            "TOO_LARGE",
            "ジョブログが大きすぎるため表示できません。GitLabで開いてください。",
        )
    };
    if response
        .content_length()
        .is_some_and(|length| length > MAX_TRACE_DOWNLOAD_BYTES as u64)
    {
        return Err(too_large());
    }
    let mut output = Vec::new();
    let mut total = 0_usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(&error))?
    {
        total = total.saturating_add(chunk.len());
        if total > MAX_TRACE_DOWNLOAD_BYTES {
            return Err(too_large());
        }
        output.extend_from_slice(&chunk);
        if output.len() > 2 * MAX_TRACE_BYTES {
            output.drain(..output.len() - MAX_TRACE_BYTES);
        }
    }
    if output.len() > MAX_TRACE_BYTES {
        output.drain(..output.len() - MAX_TRACE_BYTES);
    }
    Ok((output, total > MAX_TRACE_BYTES))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct TraceStyle {
    fg: Option<&'static str>,
    bold: bool,
}

/// Turns raw log bytes into display lines of styled spans. Only foreground
/// colour and bold survive, as names the UI maps to theme colours; other
/// escape sequences, control characters and GitLab's section markers are
/// removed, and a carriage return starts the line over as a terminal would.
fn render_trace(bytes: &[u8], head_omitted: bool) -> (Vec<Value>, bool) {
    let bytes = if head_omitted {
        // The kept part starts mid-line (and maybe mid-character).
        bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(&bytes[bytes.len()..], |at| &bytes[at + 1..])
    } else {
        bytes
    };
    let text = String::from_utf8_lossy(bytes);
    let mut style = TraceStyle::default();
    let mut lines = Vec::new();
    let mut raw_lines: Vec<&str> = text.split('\n').collect();
    if raw_lines.last() == Some(&"") {
        raw_lines.pop();
    }
    for raw in raw_lines {
        let (raw, had_marker) = remove_section_markers(raw);
        let spans = trace_line_spans(&raw, &mut style);
        if had_marker && spans.is_empty() {
            continue;
        }
        lines.push(Value::Array(spans));
    }
    let mut head_omitted = head_omitted;
    if lines.len() > MAX_TRACE_LINES {
        lines.drain(..lines.len() - MAX_TRACE_LINES);
        head_omitted = true;
    }
    (lines, head_omitted)
}

/// Removes `section_start:<time>:<name>[options]` and `section_end:<time>:<name>`.
fn remove_section_markers(line: &str) -> (std::borrow::Cow<'_, str>, bool) {
    if !line.contains("section_start:") && !line.contains("section_end:") {
        return (std::borrow::Cow::Borrowed(line), false);
    }
    let mut output = String::with_capacity(line.len());
    let mut rest = line;
    let mut found = false;
    while let Some((start, marker_len)) = ["section_start:", "section_end:"]
        .iter()
        .filter_map(|marker| rest.find(marker).map(|at| (at, marker.len())))
        .min_by_key(|(at, _)| *at)
    {
        let after = &rest[start + marker_len..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        let Some(name_part) = after[digits..].strip_prefix(':').filter(|_| digits > 0) else {
            output.push_str(&rest[..start + marker_len]);
            rest = after;
            continue;
        };
        let name_len = name_part
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
            .count();
        let mut end = name_len;
        if name_part[name_len..].starts_with('[') {
            if let Some(close) = name_part[name_len..].find(']') {
                end = name_len + close + 1;
            }
        }
        output.push_str(&rest[..start]);
        rest = &name_part[end..];
        found = true;
    }
    output.push_str(rest);
    (std::borrow::Cow::Owned(output), found)
}

fn push_trace_text(spans: &mut Vec<(String, TraceStyle)>, current: &mut String, style: TraceStyle) {
    if current.is_empty() {
        return;
    }
    match spans.last_mut() {
        Some((text, last)) if *last == style => text.push_str(current),
        _ => spans.push((current.clone(), style)),
    }
    current.clear();
}

fn trace_line_spans(line: &str, style: &mut TraceStyle) -> Vec<Value> {
    let mut spans: Vec<(String, TraceStyle)> = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '\u{1b}' => match chars.next() {
                Some('[') => {
                    let mut params = String::new();
                    let mut final_byte = None;
                    for next in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&next) {
                            final_byte = Some(next);
                            break;
                        }
                        if params.len() < 64 {
                            params.push(next);
                        }
                    }
                    if final_byte == Some('m') {
                        push_trace_text(&mut spans, &mut current, *style);
                        apply_sgr(&params, style);
                    }
                }
                Some(']') => {
                    // An operating system command ends with BEL or ESC \.
                    while let Some(next) = chars.next() {
                        if next == '\u{7}'
                            || (next == '\u{1b}' && chars.next_if_eq(&'\\').is_some())
                        {
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\r' => {
                current.clear();
                spans.clear();
            }
            '\t' => current.push('\t'),
            character if character.is_control() => {}
            character => current.push(character),
        }
    }
    push_trace_text(&mut spans, &mut current, *style);
    spans
        .into_iter()
        .map(|(text, style)| {
            let mut span = json!({ "text": text });
            if let Some(fg) = style.fg {
                span["fg"] = fg.into();
            }
            if style.bold {
                span["bold"] = true.into();
            }
            span
        })
        .collect()
}

fn apply_sgr(params: &str, style: &mut TraceStyle) {
    let codes: Vec<u32> = params
        .split([';', ':'])
        .map(|code| code.parse().unwrap_or(0))
        .collect();
    let mut index = 0;
    while index < codes.len() {
        match codes[index] {
            0 => *style = TraceStyle::default(),
            1 => style.bold = true,
            22 => style.bold = false,
            code @ (30..=37 | 90..=97) => {
                style.fg = match code % 10 {
                    0 => Some("gray"),
                    1 => Some("red"),
                    2 => Some("green"),
                    3 => Some("yellow"),
                    4 => Some("blue"),
                    5 => Some("magenta"),
                    6 => Some("cyan"),
                    _ => None,
                }
            }
            39 => style.fg = None,
            // 256-colour and RGB forms carry their own arguments, which are skipped.
            38 | 48 => {
                index += match codes.get(index + 1) {
                    Some(5) => 2,
                    Some(2) => 4,
                    _ => 0,
                }
            }
            _ => {}
        }
        index += 1;
    }
}

fn scalar_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(scalar_to_string)
}

fn stale_merge_request() -> AppError {
    AppError::new(
        "INVALID_INPUT",
        "MRが更新されています。再読み込みしてから再試行してください。",
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
            "コメントを変更できるのは投稿者だけです。",
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
        assert!(requests[0].contains(
            "/gitlab/api/v4/projects/42/repository/files/docs%2Fspec%20%231.md/raw?ref="
        ));
    }

    #[test]
    fn decodes_shift_jis_file_when_not_utf8() {
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
        assert!(
            requests[0].contains("scope=merge_requests") && requests[0].contains("search=%23123")
        );
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
                .build().unwrap();
            let api = Url::parse("https://gitlab.com/api/v4/").unwrap();
            let project_id = "278964".to_owned();
            let started = std::time::Instant::now();
            let list = fetch(&client, &api, &Query::Mrs {
                search: String::new(), state: MergeRequestState::Merged,
                project_id: Some(project_id.clone()), group_id: None, labels: None, source_branch: None, target_branch: None,
                reviewer_id: None, assignee_id: None, author_id: None,
                updated_after: None, updated_before: None, order_by: None, sort: None, page: 1,
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

    #[test]
    fn normalizes_blame_and_associated_merge_requests() {
        let block = normalize_blame_block(&json!({
            "commit": { "id": "abc", "author_name": "Alice", "committed_date": "2026-09-01", "title": "Fix" },
            "lines": ["before", "after"]
        })).unwrap();
        assert_eq!(block["lines"], json!(["before", "after"]));
        assert_eq!(block["commitId"], "abc");
        let mr = normalize_associated_merge_request(&json!({
            "project_id": 7, "iid": 12, "title": "Introduce fix",
            "web_url": "https://gitlab.example/group/repo/-/merge_requests/12", "state": "merged"
        })).unwrap();
        assert_eq!(mr["projectId"], "7");
        assert_eq!(mr["iid"], "12");
    }

    #[test]
    fn blame_query_restricts_range_and_encodes_paths() {
        let base = Url::parse("https://gitlab.example/api/v4/").unwrap();
        let query = Query::Blame { project_id: "7".to_owned(), path: "src/foo bar.ts".to_owned(), sha: "a".repeat(40), start_line: 2, end_line: 17 };
        let (url, _) = build_query_url(&base, &query).unwrap();
        assert!(url.path().contains("foo%20bar.ts"));
        assert!(url.as_str().contains("range%5Bstart%5D=2"));
        let bad = Query::Blame { project_id: "7".to_owned(), path: "x.rs".to_owned(), sha: "a".repeat(40), start_line: 1, end_line: 101 };
        assert_eq!(build_query_url(&base, &bad).unwrap_err().code, "INVALID_INPUT");
    }

    #[test]
    fn users_keep_only_a_bounded_avatar_url() {
        let user = normalize_user(&json!({"id": 3, "username": "a", "name": "A", "avatar_url": "https://gitlab.example/uploads/a.png"})).unwrap();
        assert_eq!(user["avatarUrl"], "https://gitlab.example/uploads/a.png");
        let user =
            normalize_user(&json!({"id": 3, "username": "a", "name": "A", "avatar_url": null}))
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
        assert!(requests[0].starts_with(
            "GET /api/v4/projects/42/merge_requests/9/award_emoji?page=1&per_page=100 "
        ));
        assert!(normalize_award(&json!({"name": "smile"})).is_err());
    }

    #[test]
    fn comment_reactions_read_back_from_the_newest_page_to_the_oldest_shown_comment() {
        let user = r#"{"id":"gid://gitlab/User/7","username":"alice","name":"Alice"}"#;
        let newest = format!(
            r#"{{"data":{{"project":{{"mergeRequest":{{"notes":{{"pageInfo":{{"hasPreviousPage":true,"startCursor":"c2"}},"nodes":[{{"id":"gid://gitlab/DiffNote/50","awardEmoji":{{"nodes":[{{"name":"tada","user":{user}}}]}}}},{{"id":"gid://gitlab/Note/60","awardEmoji":{{"nodes":[]}}}}]}}}}}}}}}}"#
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
                {"noteId": "50", "awards": [{"name": "tada", "user": {"id": "7", "username": "alice", "name": "Alice"}}]},
                {"noteId": "60", "awards": []},
                {"noteId": "40", "awards": []},
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
        assert!(requests[0]
            .starts_with("GET /api/v4/projects/42/merge_requests/9/notes/77/award_emoji?"));
        assert!(requests[1]
            .starts_with("POST /api/v4/projects/42/merge_requests/9/notes/77/award_emoji "));
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
        assert!(
            requests[1].starts_with("DELETE /api/v4/projects/42/merge_requests/9/award_emoji/5 ")
        );
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
        assert!(
            detail.requests.lock().unwrap()[0].starts_with("GET /api/v4/projects/8/pipelines/77 ")
        );
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
        let fixture = Fixture::new(vec![
            response(
                "200 OK",
                r#"[{"id":902,"name":"test","stage":"test","status":"failed","allow_failure":false,"duration":12.5,"failure_reason":"script_failure","web_url":"https://gitlab.example/j/902"}]"#,
                "X-Next-Page: 2\r\n",
            ),
            response(
                "200 OK",
                r#"[{"id":901,"name":"build","stage":"build","status":"success"}]"#,
                "",
            ),
            response(
                "200 OK",
                r#"[{"id":903,"name":"deploy","stage":"deploy","status":"running","downstream_pipeline":{"id":88,"status":"running","web_url":"https://gitlab.example/other/-/pipelines/88"}}]"#,
                "",
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
        assert!(requests[0]
            .starts_with("GET /api/v4/projects/7/pipelines/77/jobs?page=1&per_page=100 "));
        assert!(requests[1]
            .starts_with("GET /api/v4/projects/7/pipelines/77/jobs?page=2&per_page=100 "));
        assert!(requests[2]
            .starts_with("GET /api/v4/projects/7/pipelines/77/bridges?page=1&per_page=100 "));
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
        let fixture = Fixture::new(vec![
            response("200 OK", "[]", ""),
            response("404 Not Found", "{}", ""),
            response("200 OK", "[]", ""),
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
        assert!(fixture.requests.lock().unwrap()[2]
            .starts_with("GET /api/v4/projects/7/pipelines/77/trigger_jobs?page=1&per_page=100 "));
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
        assert_eq!(result.data["headOmitted"], false);
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
        assert!(result.truncated);
        // The partial first line is dropped.
        assert_eq!(result.data["lines"], json!([[{"text": "last line"}]]));
    }

    #[test]
    fn job_trace_from_a_server_without_ranges_keeps_only_the_bounded_end() {
        let mut log = String::from("first line\n");
        while log.len() < MAX_TRACE_BYTES + 1024 {
            log.push_str("filler line of the job log\n");
        }
        log.push_str("the end\n");
        let (bytes, dropped) = {
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
        let (lines, head_omitted) = render_trace(&bytes, dropped);
        assert!(head_omitted);
        assert_eq!(lines.last().unwrap(), &json!([{"text": "the end"}]));
        assert_ne!(lines.first().unwrap(), &json!([{"text": "first line"}]));

        // An empty log cannot satisfy a suffix range.
        let fixture = Fixture::new(vec![response("416 Range Not Satisfiable", "", "")]);
        let (bytes, dropped) = runtime()
            .block_on(get_trace_tail(&Client::new(), &fixture.url()))
            .unwrap();
        assert!(bytes.is_empty() && !dropped);
    }

    #[test]
    fn trace_rendering_drops_controls_and_keeps_colour_across_lines() {
        let (lines, _) = render_trace(
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
        assert!(requests[0]
            .contains("/api/v4/projects/42/merge_requests/9/versions?page=1&per_page=30 "));
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
}
