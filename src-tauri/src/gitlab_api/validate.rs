//! Checks of every value a write sends to GitLab, before anything is sent.

use super::*;

pub(super) fn validate_action(action: &Action) -> Result<(), AppError> {
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

pub(super) fn validate_position(position: &Position) -> Result<(), AppError> {
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
pub(super) fn validate_line_range(position: &Position, range: &LineRange) -> Result<(), AppError> {
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

pub(super) fn validate_suggestion_ids(ids: &[String]) -> Result<(), AppError> {
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

pub(super) fn validate_commit_message(message: &str) -> Result<(), AppError> {
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

pub(super) fn validate_description(value: &str) -> Result<(), AppError> {
    if value.len() > MAX_DESCRIPTION_BYTES {
        return Err(AppError::new(
            "INVALID_INPUT",
            "説明が保存できるサイズの上限を超えています。",
        ));
    }
    Ok(())
}

pub(super) fn validate_title(value: &str) -> Result<(), AppError> {
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

pub(super) fn validate_user_ids(ids: &[String]) -> Result<(), AppError> {
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
pub(super) fn validate_award_name(name: &str) -> Result<(), AppError> {
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

pub(super) fn validate_user_id(user_id: &str) -> Result<(), AppError> {
    validate_id(user_id, "userId")
}

pub(super) fn validate_username(username: &str) -> Result<(), AppError> {
    if !(2..=255).contains(&username.len())
        || !username
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        || username.ends_with('.')
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "usernameの形式が正しくありません。",
        ));
    }
    Ok(())
}

pub(super) fn validate_body(value: &str) -> Result<(), AppError> {
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

pub(super) fn validate_group_id(value: &str) -> Result<(), AppError> {
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

pub(super) fn validate_labels(labels: &[String]) -> Result<(), AppError> {
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

pub(super) fn validate_discussion_id(value: &str) -> Result<(), AppError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "discussionIdの形式が正しくありません。",
        ));
    }
    Ok(())
}

pub(super) fn validate_sha(value: &str, field: &str) -> Result<(), AppError> {
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            &format!("{field}は完全なコミットSHA（16進数）で指定してください。"),
        ));
    }
    Ok(())
}

/// A branch or tag name as Git allows it; it travels as a query parameter.
pub(super) fn validate_ref(value: &str) -> Result<(), AppError> {
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

pub(super) fn validate_project_path(value: &str) -> Result<(), AppError> {
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

pub(super) fn validate_path(value: &str) -> Result<(), AppError> {
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

pub(super) fn validate_page(page: u32) -> Result<(), AppError> {
    if page == 0 || page > MAX_PAGE {
        return Err(AppError::new(
            "INVALID_INPUT",
            "ページ番号が対応範囲外です。",
        ));
    }
    Ok(())
}
