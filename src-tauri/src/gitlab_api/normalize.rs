//! GitLab responses turned into the stable shapes the frontend receives.

use super::*;

pub(super) fn normalize_response(kind: ResponseKind, value: Value) -> Result<Value, AppError> {
    match kind {
        ResponseKind::Users => normalize_array(value, None, normalize_user),
        ResponseKind::User => normalize_user(&value),
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
        ResponseKind::CommitMergeRequests => {
            normalize_array(value, None, normalize_associated_merge_request)
        }
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

pub(super) fn normalize_label(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidLabel",
        "GitLabから不正なラベル情報が返されました。",
    )?;
    Ok(json!({
        "id": required_id_field(value, "id", "label")?,
        "name": required_string_field(value, "name", "label")?,
        "color": label_color(value),
        "description": string_field(value, "description"),
    }))
}

/// A label colour GitLab reports as `#rgb` or `#rrggbb`; anything else is
/// dropped so the interface never renders an arbitrary style value.
pub(super) fn label_color(value: &Value) -> Option<String> {
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

pub(super) fn normalize_milestone(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidMilestone",
        "GitLabから不正なマイルストーン情報が返されました。",
    )?;
    Ok(json!({
        "id": required_id_field(value, "id", "milestone")?,
        "title": required_string_field(value, "title", "milestone")?,
        "state": string_field(value, "state"),
        "dueDate": value.get("due_date").and_then(Value::as_str),
        "webUrl": value.get("web_url").and_then(Value::as_str),
    }))
}

pub(super) fn contains_truncation_marker(value: &Value) -> bool {
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

pub(super) fn normalize_array(
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
                    .key("native.response.unexpectedList")
            })?
        }
    } else {
        value
    };
    let values = value.as_array().ok_or_else(|| {
        unsupported_response("GitLabから想定外の形式の一覧が返されました。")
            .key("native.response.unexpectedList")
    })?;
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        normalized.push(normalize_item(value)?);
    }
    Ok(Value::Array(normalized))
}

pub(super) fn normalize_project(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidProject",
        "GitLabから不正なプロジェクト情報が返されました。",
    )?;
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

pub(super) fn normalize_group(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidGroup",
        "GitLabから不正なグループ情報が返されました。",
    )?;
    Ok(json!({
        "id": required_id_field(value, "id", "group")?,
        "name": required_string_field(value, "name", "group")?,
        "fullPath": required_string_field(value, "full_path", "group")?,
        "fullName": string_field(value, "full_name"),
        "webUrl": string_field(value, "web_url"),
    }))
}

pub(super) fn normalize_branch(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidBranch",
        "GitLabから不正なブランチ情報が返されました。",
    )?;
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
pub(super) fn normalize_tree_entry(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidTree",
        "GitLabから不正なファイル一覧が返されました。",
    )?;
    let kind = required_string_field(value, "type", "tree entry")?;
    if !matches!(kind.as_str(), "tree" | "blob" | "commit") {
        return Err(
            unsupported_response("GitLabから対応していない種類のファイルが返されました。")
                .key("native.response.unsupportedTreeEntry"),
        );
    }
    Ok(json!({
        "id": required_string_field(value, "id", "tree entry")?,
        "name": required_string_field(value, "name", "tree entry")?,
        "path": required_string_field(value, "path", "tree entry")?,
        "type": kind,
    }))
}

pub(super) fn normalize_todos(value: Value) -> Result<Value, AppError> {
    let items = value.as_array().ok_or_else(|| {
        unsupported_response("GitLabから不正なToDo一覧が返されました。")
            .key("native.response.invalidTodos")
    })?;
    let mut normalized = Vec::new();
    for item in items {
        if item.get("target_type").and_then(Value::as_str) != Some("MergeRequest") {
            continue;
        }
        let target = item.get("target").ok_or_else(|| {
            unsupported_response("GitLabから不正なToDoの対象が返されました。")
                .key("native.response.invalidTodoTarget")
        })?;
        let project = normalize_project(item.get("project").ok_or_else(|| {
            unsupported_response("GitLabから不正なToDoのプロジェクト情報が返されました。")
                .key("native.response.invalidTodoProject")
        })?)?;
        let author = normalize_user(item.get("author").ok_or_else(|| {
            unsupported_response("GitLabから不正なToDoの作成者情報が返されました。")
                .key("native.response.invalidTodoAuthor")
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

pub(super) fn optional_users(value: &Value, field: &str) -> Result<Vec<Value>, AppError> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(users)) => users.iter().map(normalize_user).collect(),
        _ => Err(
            unsupported_response("GitLabから不正なユーザー一覧が返されました。")
                .key("native.response.invalidUsers"),
        ),
    }
}

pub(super) fn normalize_merge_request(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidMergeRequest",
        "GitLabから不正なMR情報が返されました。",
    )?;
    let id = required_id_field(value, "id", "merge request")?;
    let iid = required_id_field(value, "iid", "merge request")?;
    let project_id = required_id_field(value, "project_id", "merge request")?;
    let title = required_string_field(value, "title", "merge request")?;
    let state = required_string_field(value, "state", "merge request")?;
    let author = normalize_user(value.get("author").ok_or_else(|| {
        unsupported_response("GitLabから不正なMRの作成者情報が返されました。")
            .key("native.response.invalidMergeRequestAuthor")
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
                label.as_str().map(str::to_owned).ok_or_else(|| {
                    unsupported_response("GitLabから不正なラベルが返されました。")
                        .key("native.response.invalidLabels")
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(
                unsupported_response("GitLabから不正なラベルが返されました。")
                    .key("native.response.invalidLabels"),
            )
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
        return Err(
            unsupported_response("GitLabから不正なマイルストーン情報が返されました。")
                .key("native.response.invalidMilestone"),
        );
    }
    Ok(merge_request)
}

pub(super) fn normalize_diff(value: &Value) -> Result<Value, AppError> {
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

pub(super) fn normalize_discussion(value: &Value) -> Result<Value, AppError> {
    let notes = value
        .get("notes")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            unsupported_response("GitLabから不正なスレッドが返されました。")
                .key("native.response.invalidDiscussion")
        })?;
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

pub(super) fn normalize_note(value: &Value) -> Result<Value, AppError> {
    let author = normalize_user(value.get("author").ok_or_else(|| {
        unsupported_response("GitLabから不正なコメントの作成者情報が返されました。")
            .key("native.response.invalidNoteAuthor")
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

pub(super) fn normalize_suggestion(value: &Value) -> Option<Value> {
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

pub(super) fn normalize_version(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidVersion",
        "GitLabから不正なバージョン情報が返されました。",
    )?;
    let head_commit_sha = required_string_field(value, "head_commit_sha", "version")?;
    validate_sha(&head_commit_sha, "headCommitSha").map_err(|_| {
        unsupported_response("GitLabから不正なバージョン情報が返されました。")
            .key("native.response.invalidVersion")
    })?;
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

pub(super) fn normalize_position(value: &Value) -> Option<Value> {
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
pub(super) fn normalize_line_range(value: &Value) -> Option<Value> {
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

pub(super) fn normalize_blame_block(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidBlame",
        "GitLabから不正なBlame情報が返されました。",
    )?;
    let commit = value.get("commit").ok_or_else(|| {
        unsupported_response("Blameのコミット情報がありません。")
            .key("native.response.blameCommitMissing")
    })?;
    require_object(
        commit,
        "native.response.blameCommitInvalid",
        "Blameのコミット情報が不正です。",
    )?;
    let lines = value
        .get("lines")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            unsupported_response("Blameの行情報が不正です。")
                .key("native.response.blameLinesInvalid")
        })?;
    if lines.len() > 100 {
        return Err(unsupported_response("Blameの行数が上限を超えています。")
            .key("native.response.blameTooManyLines"));
    }
    let mut text = Vec::with_capacity(lines.len());
    for line in lines {
        let Some(line) = line.as_str() else {
            return Err(unsupported_response("Blameの行情報が不正です。")
                .key("native.response.blameLinesInvalid"));
        };
        text.push(line);
    }
    Ok(json!({
        "commitId": required_string_field(commit, "id", "blame commit")?,
        "title": string_field(commit, "title"),
        "authorName": string_field(commit, "author_name"),
        "committedAt": string_field(commit, "committed_date"),
        "parentIds": commit.get("parent_ids").and_then(Value::as_array).map(|parents| parents.iter().filter_map(Value::as_str).filter(|sha| validate_sha(sha, "parentId").is_ok()).collect::<Vec<_>>()).unwrap_or_default(),
        "lines": text,
    }))
}

pub(super) fn normalize_associated_merge_request(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidRelatedMergeRequests",
        "GitLabから不正な関連MR情報が返されました。",
    )?;
    Ok(json!({
        "projectId": required_id_field(value, "project_id", "associated MR")?,
        "iid": required_id_field(value, "iid", "associated MR")?,
        "title": required_string_field(value, "title", "associated MR")?,
        "webUrl": required_string_field(value, "web_url", "associated MR")?,
        "state": string_field(value, "state"),
    }))
}

pub(super) fn normalize_commit(value: &Value) -> Result<Value, AppError> {
    Ok(json!({
        "id": string_field(value, "id"),
        "title": string_field(value, "title"),
        "createdAt": string_field(value, "created_at"),
        "committedAt": value.get("committed_date").and_then(Value::as_str).unwrap_or_else(|| value.get("created_at").and_then(Value::as_str).unwrap_or("")),
        "parentIds": value.get("parent_ids").and_then(Value::as_array).map(|parents| parents.iter().filter_map(Value::as_str).filter(|sha| validate_sha(sha, "parentId").is_ok()).collect::<Vec<_>>()).unwrap_or_default(),
    }))
}

pub(super) fn normalize_draft(value: &Value) -> Result<Value, AppError> {
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

pub(super) fn normalize_approvals(value: &Value) -> Result<Value, AppError> {
    let approved_by = value
        .get("approved_by")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            unsupported_response("GitLabから不正な承認情報が返されました。")
                .key("native.response.invalidApprovals")
        })?;
    let approved_by = approved_by
        .iter()
        .map(|item| normalize_user(item.get("user").unwrap_or(item)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "approved": bool_field(value, "approved"),
        "approvedBy": approved_by,
    }))
}

pub(super) fn normalize_award(value: &Value) -> Result<Value, AppError> {
    let user = normalize_user(value.get("user").ok_or_else(|| {
        unsupported_response("GitLabから不正なリアクションのユーザー情報が返されました。")
            .key("native.response.invalidAwardUser")
    })?)?;
    Ok(json!({
        "name": required_string_field(value, "name", "award emoji")?,
        "user": user,
    }))
}

pub(super) fn normalize_pipeline(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidPipeline",
        "GitLabから不正なパイプライン情報が返されました。",
    )?;
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

pub(super) fn normalize_job(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidJob",
        "GitLabから不正なジョブ情報が返されました。",
    )?;
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
pub(super) fn normalize_trigger_job(value: &Value) -> Result<Value, AppError> {
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

pub(super) fn normalize_user(value: &Value) -> Result<Value, AppError> {
    require_object(
        value,
        "native.response.invalidUser",
        "GitLabから不正なユーザー情報が返されました。",
    )?;
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

pub(super) fn require_object(value: &Value, key: &str, message: &str) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(unsupported_response(message).key(key));
    }
    Ok(())
}

pub(super) fn required_id_field(
    value: &Value,
    field: &str,
    resource: &str,
) -> Result<String, AppError> {
    let id = value.get(field).and_then(scalar_to_string).ok_or_else(|| {
        unsupported_response(&format!("GitLabから不正なIDが返されました（{resource}）。"))
            .key("native.response.invalidId")
            .value("resource", resource)
    })?;
    if !id.bytes().all(|byte| byte.is_ascii_digit()) || !id.parse::<u64>().is_ok_and(|id| id > 0) {
        return Err(unsupported_response(&format!(
            "GitLabから不正なIDが返されました（{resource}）。"
        ))
        .key("native.response.invalidId")
        .value("resource", resource));
    }
    Ok(id)
}

pub(super) fn required_string_field(
    value: &Value,
    field: &str,
    resource: &str,
) -> Result<String, AppError> {
    let string = value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            unsupported_response(&format!(
                "GitLabから不正な応答が返されました（{resource}）。"
            ))
            .key("native.response.invalidField")
            .value("resource", resource)
        })?;
    Ok(string.to_owned())
}

pub(super) fn string_field(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(scalar_to_string)
        .unwrap_or_default()
}

pub(super) fn scalar_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(super) fn bool_field(value: &Value, field: &str) -> bool {
    value.get(field).and_then(Value::as_bool).unwrap_or(false)
}

pub(super) fn unsupported_response(message: &str) -> AppError {
    AppError::new("UNSUPPORTED", message)
}
