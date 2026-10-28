use crate::dto::{
    Action, AppError, LineRange, LineRangePoint, MergeRequestState, MrPathRef, Position,
    PositionType, Query, StateEvent,
};
use reqwest::{header::HeaderMap, Client, Method, Response, StatusCode};
use serde_json::{json, Map, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

mod normalize;
mod query_url;
mod trace;
mod validate;
use normalize::*;
use query_url::*;
use trace::*;
pub(crate) use validate::validate_id;
use validate::*;

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
    User,
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
    if let Query::DescriptionTemplates { project_id } = query {
        return fetch_description_templates(client, api_base, project_id).await;
    }
    if let Query::CommentTemplates { project_path } = query {
        return fetch_comment_templates(client, api_base, project_path).await;
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
    let mut result = decode_page(response_kind, &bytes, &headers)?;
    if let Query::User { username } = query {
        let exact_user = {
            let users = result.data.as_array().ok_or_else(|| {
                unsupported_response("GitLabから想定外の形式のユーザー情報が返されました。")
                    .key("native.response.unexpectedUser")
            })?;
            let mut exact_matches = users.iter().filter(|user| {
                user["username"]
                    .as_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case(username))
            });
            let exact_user = exact_matches.next().cloned();
            if exact_matches.next().is_some() {
                return Err(
                    unsupported_response("GitLabから同じユーザーが複数返されました。")
                        .key("native.response.duplicateUser"),
                );
            }
            exact_user.unwrap_or(Value::Null)
        };
        result.data = exact_user;
        result.next_page = None;
        result.total_pages = None;
        result.truncated = false;
    }
    Ok(result)
}

/// Repository files are shown as UTF-8, or in the legacy encoding they most
/// likely use (Shift_JIS for older Japanese SQL files on Japanese Windows).
fn decode_file_text(bytes: Vec<u8>) -> Result<String, AppError> {
    let bytes = match String::from_utf8(bytes) {
        Ok(text) => return Ok(text),
        Err(error) => error.into_bytes(),
    };
    crate::text_encoding::decode_text(&bytes).ok_or_else(|| {
        AppError::new(
            "UNSUPPORTED",
            "GitLabから返されたファイルはテキストではないため表示できません。",
        )
        .key("native.response.notText")
    })
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
        .key("native.response.unsupported")
    })?;
    if !value.is_object() {
        return Err(
            unsupported_response("GitLabから想定外の形式の比較結果が返されました。")
                .key("native.response.unexpectedCompare"),
        );
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
        .key("native.response.unsupported")
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
                .key("native.query.invalidUpdatedDate")
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
            return Err(AppError::new("INVALID_INPUT", "添付データが必要です。")
                .key("native.attachment.required"));
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
                        .key("native.input.userId")
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
                )
                .key("native.write.awardExists"));
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
                        .key("native.write.awardRemoved")
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
                        .key("native.input.milestoneId")
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
                            .key("native.input.suggestionId")
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
            AppError::new("FORBIDDEN", CI_FORBIDDEN_MESSAGE).key("native.ci.forbidden")
        } else {
            error
        }
    })?;
    if !saved_as_requested(action, response.as_ref()) {
        return Err(AppError::new(
            "UNSUPPORTED",
            "GitLabに保存された内容が要求と異なります。権限や接続先の設定で反映されなかった可能性があります。再読み込みして確認してください。",
        ).key("native.write.notApplied"));
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
            ).key("native.write.usersNotApplied"));
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
            ).key("native.merge.forbidden")),
            StatusCode::METHOD_NOT_ALLOWED => Some(AppError::new(
                "INVALID_INPUT",
                "GitLabがマージを受け付けませんでした。現在はマージできない状態です。再読み込みして理由を確認してください。",
            ).key("native.merge.refused")),
            StatusCode::CONFLICT => Some(stale_merge_request()),
            StatusCode::BAD_REQUEST
            | StatusCode::NOT_ACCEPTABLE
            | StatusCode::UNPROCESSABLE_ENTITY => Some(AppError::new(
                "INVALID_INPUT",
                "GitLabでマージできませんでした。再読み込みしてMRの状態を確認してください。",
            ).key("native.merge.failed")),
            _ => None,
        }
        },
        Action::CancelAutoMerge { .. } => |status| {
            matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN).then(|| {
                AppError::new("FORBIDDEN", "自動マージを取り消す権限がありません。")
                    .key("native.merge.cancelAutoForbidden")
            })
        },
        Action::Rebase { .. } => |status| {
            match status {
            StatusCode::FORBIDDEN => Some(AppError::new(
                "FORBIDDEN",
                "ソースブランチにプッシュできないため、リベースできません。権限とブランチの保護設定を確認してください。",
            ).key("native.merge.rebaseForbidden")),
            StatusCode::CONFLICT => Some(AppError::new(
                "INVALID_INPUT",
                "GitLabがリベースを開始できませんでした。しばらくしてから再試行してください。",
            ).key("native.merge.rebaseFailed")),
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
    api_base.join("../graphql").map_err(|_| {
        AppError::new("INVALID_INPUT", "GitLab GraphQLのURLが正しくありません。")
            .key("native.request.graphqlUrl")
    })
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
        return Err(
            AppError::new("INVALID_INPUT", "GitLab APIのURLが正しくありません。")
                .key("native.request.apiUrl"),
        );
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
        let mut path_segments = url.path_segments_mut().map_err(|_| {
            AppError::new("INVALID_INPUT", "GitLab APIのURLが正しくありません。")
                .key("native.request.apiUrl")
        })?;
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
        )
        .key("native.query.approvalsPerPage"));
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
        unsupported_response("GitLabから対応していない形式の承認情報が返されました。")
            .key("native.response.unsupportedApprovals"),
        unsupported_response("GitLabから承認情報が返されませんでした。")
            .key("native.response.missingApprovals"),
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
    malformed: AppError,
    missing: AppError,
) -> Result<Value, AppError> {
    let url = api_base.join("../graphql").map_err(|_| {
        AppError::new("INVALID_INPUT", "GitLab GraphQLのURLが正しくありません。")
            .key("native.request.graphqlUrl")
    })?;
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
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| malformed)?;
    value
        .get("data")
        .filter(|data| data.is_object())
        .cloned()
        .ok_or(missing)
}

/// Description templates read with their text; more are marked truncated.
const MAX_DESCRIPTION_TEMPLATES: usize = 30;

/// Reads the project's merge request description templates. GitLab lists only
/// their names, so each template's text costs one more request.
async fn fetch_description_templates(
    client: &Client,
    api_base: &Url,
    project_id: &str,
) -> Result<ApiResult, AppError> {
    validate_id(project_id, "projectId")?;
    let malformed = || {
        unsupported_response("GitLabから対応していない形式のテンプレートが返されました。")
            .key("native.response.unsupportedTemplates")
    };
    let list_url = append_query(
        endpoint(
            api_base,
            &["projects", project_id, "templates", "merge_requests"],
        )?,
        vec![("per_page".to_owned(), "100".to_owned())],
    );
    let (bytes, _headers) = get_bytes(client, &list_url, MAX_RESPONSE_BYTES).await?;
    let list: Value = serde_json::from_slice(&bytes).map_err(|_| malformed())?;
    let keys = list
        .as_array()
        .ok_or_else(malformed)?
        .iter()
        .map(|template| {
            template
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(malformed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut items = Vec::new();
    for key in keys.iter().take(MAX_DESCRIPTION_TEMPLATES) {
        let url = endpoint(
            api_base,
            &["projects", project_id, "templates", "merge_requests", key],
        )?;
        let (bytes, _headers) = get_bytes(client, &url, MAX_RESPONSE_BYTES).await?;
        let template: Value = serde_json::from_slice(&bytes).map_err(|_| malformed())?;
        require_object(
            &template,
            "native.response.unsupportedTemplates",
            "GitLabから対応していない形式のテンプレートが返されました。",
        )?;
        let name = template.get("name").and_then(Value::as_str).unwrap_or(key);
        items.push(json!({
            "id": key,
            "name": name,
            "content": string_field(&template, "content"),
            "scope": "project",
        }));
    }
    Ok(ApiResult {
        data: Value::Array(items),
        next_page: None,
        total_pages: None,
        truncated: keys.len() > MAX_DESCRIPTION_TEMPLATES,
    })
}

const SAVED_REPLY_FIELDS: &str =
    "savedReplies(first: 100) { pageInfo { hasNextPage } nodes { id name content } }";

/// Reads the comment templates of the user, the project and its parent group.
/// GitLab editions without project and group templates reject the whole
/// query, so the user's own templates are then read alone.
async fn fetch_comment_templates(
    client: &Client,
    api_base: &Url,
    project_path: &str,
) -> Result<ApiResult, AppError> {
    validate_project_path(project_path)?;
    let group_path = project_path
        .rsplit_once('/')
        .map_or(project_path, |(group, _)| group);
    let malformed = || {
        unsupported_response("GitLabから対応していない形式のコメントテンプレートが返されました。")
            .key("native.response.unsupportedTemplates")
    };
    let missing = || {
        unsupported_response("GitLabからコメントテンプレートが返されませんでした。")
            .key("native.response.missingTemplates")
    };
    let all = json!({
        "query": format!("query($project: ID!, $group: ID!) {{ project(fullPath: $project) {{ {SAVED_REPLY_FIELDS} }} group(fullPath: $group) {{ {SAVED_REPLY_FIELDS} }} currentUser {{ {SAVED_REPLY_FIELDS} }} }}"),
        "variables": { "project": project_path, "group": group_path },
    });
    let data = match post_graphql(client, api_base, &all, malformed(), missing()).await {
        Err(error) if error.code == "UNSUPPORTED" => {
            let user =
                json!({ "query": format!("query {{ currentUser {{ {SAVED_REPLY_FIELDS} }} }}") });
            post_graphql(client, api_base, &user, malformed(), missing()).await?
        }
        result => result?,
    };
    let mut items = Vec::new();
    let mut truncated = false;
    for (field, scope) in [
        ("project", "project"),
        ("group", "group"),
        ("currentUser", "user"),
    ] {
        let Some(replies) = data.get(field).and_then(|owner| owner.get("savedReplies")) else {
            continue;
        };
        truncated |= replies
            .pointer("/pageInfo/hasNextPage")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        for node in replies
            .get("nodes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = node
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(malformed)?;
            items.push(json!({
                "id": id,
                "name": string_field(node, "name"),
                "content": string_field(node, "content"),
                "scope": scope,
            }));
        }
    }
    Ok(ApiResult {
        data: Value::Array(items),
        next_page: None,
        total_pages: None,
        truncated,
    })
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
            unsupported_response("GitLabから対応していない形式のリアクションが返されました。")
                .key("native.response.unsupportedAwards"),
            unsupported_response("GitLabからリアクションが返されませんでした。")
                .key("native.response.missingAwards"),
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
                ).key("native.response.missingMergeRequestAwards")
            })?;
        let nodes = notes
            .get("nodes")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                unsupported_response("GitLabから不正なリアクションが返されました。")
                    .key("native.response.invalidAward")
            })?;
        for node in nodes {
            let note_id = node
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| id.rsplit('/').next())
                .filter(|id| validate_id(id, "noteId").is_ok())
                .ok_or_else(|| {
                    unsupported_response("GitLabから不正なコメントIDが返されました。")
                        .key("native.response.invalidNoteId")
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
        .ok_or_else(|| {
            unsupported_response("GitLabから不正なリアクションが返されました。")
                .key("native.response.invalidAward")
        })?;
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
        let awards: Value = serde_json::from_slice(&bytes).map_err(|_| {
            unsupported_response("GitLabから不正なリアクションが返されました。")
                .key("native.response.invalidAward")
        })?;
        let awards = awards.as_array().ok_or_else(|| {
            unsupported_response("GitLabから不正なリアクションが返されました。")
                .key("native.response.invalidAward")
        })?;
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
    )
    .key("native.write.tooManyAwards"))
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
        let todos: Value = serde_json::from_slice(&bytes).map_err(|_| {
            unsupported_response("GitLabから不正なToDo一覧が返されました。")
                .key("native.response.invalidTodos")
        })?;
        let todos = todos.as_array().ok_or_else(|| {
            unsupported_response("GitLabから不正なToDo一覧が返されました。")
                .key("native.response.invalidTodos")
        })?;
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
    )
    .key("native.write.todoGone"))
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
        .key("native.response.unsupported")
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
        )
        .key("native.merge.notAutoMerge")),
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
                ).key("native.write.reviewRefused")),
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
            Err(if unknown_field {
                AppError::new(
                    "UNSUPPORTED",
                    "接続先のGitLabはこの操作に対応していません。GitLabで開いて操作してください。",
                )
                .key("native.write.unsupportedByInstance")
            } else {
                AppError::new(
                    "UNSUPPORTED",
                    "GitLabがこの操作を受け付けませんでした。権限と接続先の版・プランを確認してください。",
                )
                .key("native.write.refused")
            })
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
                )
                .key("native.write.unconfirmed"))
            } else {
                Err(refusal(status)
                    .unwrap_or_else(|| status_error(status, response.headers(), true)))
            }
        }
        Err(error) if error.is_timeout() => Err(AppError::new(
            "UNKNOWN_OUTCOME",
            "変更がGitLabに届いた可能性がありますが、応答がタイムアウトしました。",
        )
        .key("native.write.timeout")),
        Err(_) => Err(AppError::new(
            "UNKNOWN_OUTCOME",
            "変更がGitLabに届いた可能性がありますが、結果を確認できませんでした。",
        )
        .key("native.write.unknownOutcome")),
    }
}

fn unknown_mutation_result() -> AppError {
    AppError::new(
        "UNKNOWN_OUTCOME",
        "GitLabから変更結果の確認が得られませんでした。再送する前にGitLabで結果を確認してください。",
    ).key("native.write.checkBeforeRetry")
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
        )
        .key("native.response.tooLarge"));
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
            )
            .key("native.response.tooLarge"));
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
        )
        .key("native.request.authExpired"),
        StatusCode::FORBIDDEN if mutation => AppError::new(
            "FORBIDDEN",
            "この操作の権限がありません。コメントや承認には api スコープのトークンが必要です。",
        )
        .key("native.request.writeForbidden"),
        StatusCode::FORBIDDEN => {
            AppError::new("FORBIDDEN", "表示する権限がありません。").key("native.request.forbidden")
        }
        StatusCode::NOT_FOUND => AppError::new(
            "NOT_FOUND",
            "対象が見つからないか、表示する権限がありません。",
        )
        .key("native.request.notFound"),
        StatusCode::TOO_MANY_REQUESTS => {
            rate_limited(retry_after_ms(AppError::new("RATE_LIMITED", ""), headers).retry_after_ms)
        }
        StatusCode::METHOD_NOT_ALLOWED
        | StatusCode::NOT_IMPLEMENTED
        | StatusCode::HTTP_VERSION_NOT_SUPPORTED => AppError::new(
            "UNSUPPORTED",
            "この操作は接続先のGitLabでは利用できません。",
        )
        .key("native.request.unsupported"),
        _ if status.is_server_error() && mutation => AppError::new(
            "UNKNOWN_OUTCOME",
            "GitLabから変更結果の確認が得られませんでした。",
        )
        .key("native.write.unconfirmed"),
        _ if status.is_server_error() => AppError::new(
            "NETWORK",
            "GitLabで一時的なサーバーエラーが発生しました。しばらくしてから再試行してください。",
        )
        .key("native.request.serverError"),
        StatusCode::BAD_REQUEST | StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY => {
            AppError::new(
                "INVALID_INPUT",
                "GitLabがリクエストを受け付けませんでした。入力内容を確認してください。",
            )
            .key("native.request.invalidInput")
        }
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => {
            AppError::new("TIMEOUT", TIMEOUT_MESSAGE).key("native.request.timeout")
        }
        _ => AppError::new("UNSUPPORTED", "GitLabがリクエストを受け付けませんでした。")
            .key("native.request.refused"),
    }
}

/// The error for a rate-limited request, naming the wait when GitLab gave one.
pub(crate) fn rate_limited(retry_after_ms: Option<u64>) -> AppError {
    let mut error = match retry_after_ms {
        Some(ms) => {
            let seconds = ms.div_ceil(1_000).max(1);
            AppError::new(
                "RATE_LIMITED",
                &format!("GitLabのリクエスト制限に達しました。{seconds}秒後に再試行してください。"),
            )
            .key("native.request.rateLimited")
            .value("seconds", seconds)
        }
        None => AppError::new(
            "RATE_LIMITED",
            "GitLabのリクエスト制限に達しました。しばらく待ってから再試行してください。",
        )
        .key("native.request.rateLimitedNoWait"),
    };
    error.retry_after_ms = retry_after_ms;
    error
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
        AppError::new("TIMEOUT", TIMEOUT_MESSAGE).key("native.request.timeout")
    } else if error.is_connect() {
        AppError::new(
            "NETWORK",
            "GitLabに接続できません。ネットワーク接続を確認してください。",
        )
        .key("native.request.cannotConnect")
    } else {
        AppError::new("NETWORK", "GitLabへのリクエストを完了できませんでした。")
            .key("native.request.failed")
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
    let value = value.to_str().map_err(|_| {
        AppError::new("UNSUPPORTED", "GitLabから不正なページ情報が返されました。")
            .key("native.response.invalidPage")
    })?;
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let page = value.parse::<u32>().map_err(|_| {
        AppError::new("UNSUPPORTED", "GitLabから不正なページ情報が返されました。")
            .key("native.response.invalidPage")
    })?;
    if page == 0 || page > MAX_PAGE {
        return Err(AppError::new(
            "UNSUPPORTED",
            "GitLabから対応していないページ番号が返されました。",
        )
        .key("native.response.unsupportedPage"));
    }
    Ok(Some(page))
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
    let known = (!status.is_empty()
        && status.len() <= 32
        && status
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_'))
    .then_some(status);
    let shown = known.unwrap_or("不明");
    let subject = match target {
        CiTarget::Job => "ジョブ",
        CiTarget::Pipeline => "パイプライン",
    };
    let error = AppError::new(
        "INVALID_INPUT",
        &if archived {
            format!("この{subject}はアーカイブ済みのため操作できません。")
        } else {
            format!("{subject}の状態が変わったため、この操作はできません（現在: {shown}）。再読み込みしてから操作してください。")
        },
    );
    Err(match (target, archived, known) {
        (CiTarget::Job, true, _) => error.key("native.ci.jobArchived"),
        (CiTarget::Pipeline, true, _) => error.key("native.ci.pipelineArchived"),
        (CiTarget::Job, false, Some(status)) => error
            .key("native.ci.jobStateChanged")
            .value("status", status),
        (CiTarget::Pipeline, false, Some(status)) => error
            .key("native.ci.pipelineStateChanged")
            .value("status", status),
        (CiTarget::Job, false, None) => error.key("native.ci.jobStateUnknown"),
        (CiTarget::Pipeline, false, None) => error.key("native.ci.pipelineStateUnknown"),
    })
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
                .key("native.response.unsupported")
        })?;
        if let Value::Array(values) = normalize_array(value, None, normalize_item)? {
            items.extend(values);
        }
        match parse_next_page(&headers)? {
            None => return Ok((items, false)),
            Some(next) if next <= page => {
                return Err(
                    unsupported_response("GitLabから不正なページ情報が返されました。")
                        .key("native.response.invalidPage"),
                )
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

fn scalar_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(scalar_to_string)
}

fn stale_merge_request() -> AppError {
    AppError::new(
        "INVALID_INPUT",
        "MRが更新されています。再読み込みしてから再試行してください。",
    )
    .key("native.write.staleMergeRequest")
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
        return Err(
            AppError::new("FORBIDDEN", "コメントを変更できるのは投稿者だけです。")
                .key("native.write.authorOnly"),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests;
