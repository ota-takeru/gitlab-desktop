use serde::{Deserialize, Serialize};

/// The user identity returned by GitLab and used by the IPC contract.
///
/// GitLab returns numeric identifiers in some API responses.  The REST
/// adapter normalizes those values to decimal strings before exposing them to
/// the rest of the application, so the wire DTO deliberately keeps IDs as
/// strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub name: String,
    /// GitLab's avatar URL. The frontend never loads it directly; it asks the
    /// native side, which only fetches images from the connected instance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub instance_url: String,
    pub user: User,
    pub server_version: Option<String>,
}

/// A safe, user-facing application error.  Raw HTTP client errors and server
/// response bodies are intentionally never stored in this type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            retry_after_ms: None,
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PositionType {
    Text,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub base_sha: String,
    pub start_sha: String,
    pub head_sha: String,
    pub old_path: String,
    pub new_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line: Option<u32>,
    pub position_type: PositionType,
    /// The lines of a multi-line comment, ending at `old_line`/`new_line`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_range: Option<LineRange>,
}

/// A range of diff lines within one hunk. GitLab's line codes are computed
/// from it on the native side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start: LineRangePoint,
    pub end: LineRangePoint,
    /// The hunk both lines belong to, as its `@@ -a,b +c,d @@` header gives it.
    pub hunk: DiffHunk,
}

/// One end of a line range. `old_line`/`new_line` are the numbers shown for
/// the line (absent on the side it does not exist on); the positions are the
/// hunk's counters at the line, which GitLab's line code uses on both sides.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRangePoint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line: Option<u32>,
    pub old_position: u32,
    pub new_position: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeRequestState {
    All,
    Opened,
    Closed,
    Merged,
}

/// Read operations supported by the GitLab REST adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
// Query dispatch admits at most four concurrent requests per session; keeping
// this short-lived IPC DTO flat avoids allocating a box for each MR query.
#[allow(clippy::large_enum_variant)]
pub enum Query {
    Users {
        search: String,
        page: u32,
    },
    Groups {
        search: String,
        page: u32,
    },
    Project {
        path: String,
    },
    Todos {
        page: u32,
        /// The To-Dos already marked done (read notifications) instead of the pending ones.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        done: bool,
    },
    Branches {
        project_id: String,
        search: String,
        page: u32,
    },
    Notes {
        project_id: String,
        iid: String,
        page: u32,
    },
    Projects {
        search: String,
        membership: bool,
        include_archived: bool,
        page: u32,
    },
    Mrs {
        search: String,
        state: MergeRequestState,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        labels: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_branch: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_branch: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reviewer_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assignee_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        author_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        updated_after: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        updated_before: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        order_by: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sort: Option<String>,
        page: u32,
    },
    Mr {
        project_id: String,
        iid: String,
    },
    Diffs {
        project_id: String,
        iid: String,
        head_sha: String,
        page: u32,
    },
    Discussions {
        project_id: String,
        iid: String,
        page: u32,
    },
    Commits {
        project_id: String,
        iid: String,
        page: u32,
    },
    Drafts {
        project_id: String,
        iid: String,
        page: u32,
    },
    CommitDiff {
        project_id: String,
        iid: String,
        sha: String,
        page: u32,
    },
    File {
        project_id: String,
        path: String,
        sha: String,
    },
    /// Bounded blame for a file at one commit.
    Blame { project_id: String, path: String, sha: String, start_line: u32, end_line: u32 },
    /// MR(s) associated with a commit.
    CommitMergeRequests { project_id: String, sha: String },
    /// One folder of a repository; without `ref`, GitLab lists the default branch.
    Tree {
        project_id: String,
        #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
        git_ref: Option<String>,
        path: String,
        page: u32,
    },
    /// A file's text by the blob id a tree entry gives, so its content never changes under one key.
    Blob {
        project_id: String,
        sha: String,
    },
    Approvals {
        project_id: String,
        iid: String,
    },
    /// Who approved each listed merge request, in one GraphQL request so a
    /// list page costs one call instead of one per row.
    MrApprovals {
        items: Vec<MrPathRef>,
    },
    /// Emoji reactions on a merge request itself.
    MrAwards {
        project_id: String,
        iid: String,
    },
    /// Emoji reactions on the comments of a merge request, from the newest
    /// back to `since_note_id`, read through GraphQL so the shown threads cost
    /// one request instead of one per comment.
    NoteAwards {
        project_path: String,
        iid: String,
        since_note_id: String,
    },
    /// One page of the merge request's pipelines, newest first.
    MrPipelines {
        project_id: String,
        iid: String,
        page: u32,
    },
    /// One pipeline, in the project that ran it (a fork MR's pipeline can run
    /// outside the MR's project).
    Pipeline {
        project_id: String,
        pipeline_id: String,
    },
    /// The pipeline's jobs and trigger jobs, read page by page up to a bound.
    PipelineJobs {
        project_id: String,
        pipeline_id: String,
    },
    /// The end of a job log, bounded and cleaned for display. Never cached.
    JobTrace {
        project_id: String,
        job_id: String,
    },
    /// Labels a merge request in the project can use, including those of its
    /// ancestor groups.
    Labels {
        project_id: String,
        search: String,
        page: u32,
    },
    /// Active milestones of the project and its ancestor groups.
    Milestones {
        project_id: String,
        search: String,
        page: u32,
    },
    /// The MR's diff versions (one per push), newest first.
    MrVersions {
        project_id: String,
        iid: String,
        page: u32,
    },
    /// The changes between two versions of the MR, by their head commits.
    VersionCompare {
        project_id: String,
        iid: String,
        from_sha: String,
        to_sha: String,
        page: u32,
    },
}

/// A merge request addressed by its project's full path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MrPathRef {
    pub project_path: String,
    pub iid: String,
}

/// The state change requested by `Action::SetState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StateEvent {
    Close,
    Reopen,
}

/// Write operations supported by the GitLab REST adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Comment {
        project_id: String,
        iid: String,
        body: String,
        thread: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        position: Option<Position>,
    },
    Reply {
        project_id: String,
        iid: String,
        discussion_id: String,
        body: String,
    },
    EditNote {
        project_id: String,
        iid: String,
        note_id: String,
        body: String,
    },
    DeleteNote {
        project_id: String,
        iid: String,
        note_id: String,
    },
    Resolve {
        project_id: String,
        iid: String,
        discussion_id: String,
        resolved: bool,
    },
    SaveDraft {
        project_id: String,
        iid: String,
        body: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        discussion_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        position: Option<Position>,
    },
    EditDraft {
        project_id: String,
        iid: String,
        draft_id: String,
        body: String,
    },
    DeleteDraft {
        project_id: String,
        iid: String,
        draft_id: String,
    },
    PublishDraft {
        project_id: String,
        iid: String,
        draft_id: String,
    },
    Approve {
        project_id: String,
        iid: String,
        sha: String,
    },
    Unapprove {
        project_id: String,
        iid: String,
    },
    /// Replaces the assignees. `expected_user_ids` are the assignees the user
    /// saw; the change is refused when GitLab no longer has them.
    SetAssignees {
        project_id: String,
        iid: String,
        user_ids: Vec<String>,
        expected_user_ids: Vec<String>,
    },
    /// Replaces the reviewers, guarded like `SetAssignees`.
    SetReviewers {
        project_id: String,
        iid: String,
        user_ids: Vec<String>,
        expected_user_ids: Vec<String>,
    },
    UploadAttachment {
        project_id: String,
        iid: String,
        file_name: String,
    },
    /// Replaces the description. `expected_description` is the description the
    /// user edited; the change is refused when GitLab no longer has it.
    SetDescription {
        project_id: String,
        iid: String,
        description: String,
        expected_description: String,
    },
    /// Adds the user's emoji reaction to the MR, or to one of its comments.
    AddAward {
        project_id: String,
        iid: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        note_id: Option<String>,
        name: String,
    },
    /// Removes the user's own reaction of that name; its ID is read from GitLab first.
    RemoveAward {
        project_id: String,
        iid: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        note_id: Option<String>,
        name: String,
    },
    /// Marks a To-Do done. `project_id`/`iid` name the To-Do's merge request,
    /// which GitLab must confirm before anything is written.
    MarkTodoDone {
        project_id: String,
        iid: String,
        todo_id: String,
    },
    /// Job and pipeline operations carry the MR they were started from
    /// (`project_id`/`iid`) so an unknown outcome blocks writes to that MR;
    /// `pipeline_project_id` is the project that ran the pipeline.
    RetryJob {
        project_id: String,
        iid: String,
        pipeline_project_id: String,
        job_id: String,
    },
    CancelJob {
        project_id: String,
        iid: String,
        pipeline_project_id: String,
        job_id: String,
    },
    PlayJob {
        project_id: String,
        iid: String,
        pipeline_project_id: String,
        job_id: String,
    },
    RetryPipeline {
        project_id: String,
        iid: String,
        pipeline_project_id: String,
        pipeline_id: String,
    },
    CancelPipeline {
        project_id: String,
        iid: String,
        pipeline_project_id: String,
        pipeline_id: String,
    },
    /// Merges the head `sha` the user saw, or with `auto_merge` lets GitLab
    /// merge it once its checks pass.
    Merge {
        project_id: String,
        iid: String,
        sha: String,
        squash: bool,
        remove_source_branch: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        merge_commit_message: Option<String>,
        auto_merge: bool,
    },
    CancelAutoMerge {
        project_id: String,
        iid: String,
    },
    /// Rebases the source branch whose head is `sha`.
    Rebase {
        project_id: String,
        iid: String,
        sha: String,
    },
    /// Closes or reopens; refused unless the MR is still open or closed.
    SetState {
        project_id: String,
        iid: String,
        state_event: StateEvent,
    },
    /// Replaces the title; refused when GitLab no longer has `expected_title`.
    SetTitle {
        project_id: String,
        iid: String,
        title: String,
        expected_title: String,
    },
    /// Adds and removes labels, leaving labels others changed meanwhile alone.
    SetLabels {
        project_id: String,
        iid: String,
        add_labels: Vec<String>,
        remove_labels: Vec<String>,
    },
    /// Sets or (with `None`) clears the milestone; refused when GitLab no
    /// longer has `expected_milestone_id`.
    SetMilestone {
        project_id: String,
        iid: String,
        milestone_id: Option<String>,
        expected_milestone_id: Option<String>,
    },
    /// Marks the current user's review as requesting changes (GraphQL).
    RequestChanges {
        project_id: String,
        iid: String,
        project_path: String,
    },
    /// Asks a reviewer of the MR for a new review (GraphQL).
    RerequestReview {
        project_id: String,
        iid: String,
        project_path: String,
        user_id: String,
    },
    /// Applies suggestions of the MR's comments as one commit. Refused when
    /// the MR head is no longer `head_sha`, the head the suggestions were read on.
    ApplySuggestions {
        project_id: String,
        iid: String,
        suggestion_ids: Vec<String>,
        head_sha: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        commit_message: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_wire_shape_uses_camel_case_fields() {
        let value = serde_json::to_value(Query::Projects {
            search: "demo".to_owned(),
            membership: true,
            include_archived: false,
            page: 1,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "projects",
                "search": "demo",
                "membership": true,
                "includeArchived": false,
                "page": 1,
            })
        );

        let parsed: Query = serde_json::from_value(serde_json::json!({
            "kind": "mrs",
            "search": "cache",
            "state": "all",
            "projectId": "7",
            "groupId": null,
            "labels": ["bug", "ready"],
            "sourceBranch": "feature/search",
            "targetBranch": "main",
            "reviewerId": "8",
            "assigneeId": "9",
            "authorId": null,
            "updatedAfter": null,
            "updatedBefore": null,
            "orderBy": "created_at",
            "sort": "asc",
            "page": 2,
        }))
        .unwrap();
        assert!(matches!(
            parsed,
            Query::Mrs {
                project_id: Some(ref project_id),
                reviewer_id: Some(ref reviewer_id),
                assignee_id: Some(ref assignee_id),
                ..
            } if project_id == "7" && reviewer_id == "8" && assignee_id == "9"
        ));
        assert_eq!(serde_json::to_value(&parsed).unwrap()["assigneeId"], "9");
        let wire = serde_json::to_value(&parsed).unwrap();
        assert_eq!(wire["orderBy"], "created_at");
        assert_eq!(wire["sort"], "asc");
        assert_eq!(wire["labels"], serde_json::json!(["bug", "ready"]));
        assert_eq!(wire["sourceBranch"], "feature/search");
        assert_eq!(wire["targetBranch"], "main");
        for value in [
            serde_json::json!({"kind": "users", "search": "alice", "page": 1}),
            serde_json::json!({"kind": "groups", "search": "platform", "page": 1}),
            serde_json::json!({"kind": "project", "path": "group/project"}),
            serde_json::json!({"kind": "todos", "page": 2}),
            serde_json::json!({"kind": "todos", "page": 1, "done": true}),
            serde_json::json!({"kind": "branches", "projectId": "7", "search": "feat", "page": 1}),
            serde_json::json!({"kind": "notes", "projectId": "7", "iid": "3", "page": 1}),
            serde_json::json!({"kind": "mrPipelines", "projectId": "7", "iid": "3", "page": 1}),
            serde_json::json!({"kind": "pipeline", "projectId": "7", "pipelineId": "55"}),
            serde_json::json!({"kind": "pipelineJobs", "projectId": "7", "pipelineId": "55"}),
            serde_json::json!({"kind": "jobTrace", "projectId": "7", "jobId": "900"}),
        ] {
            let query: Query = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(query).unwrap(), value);
        }

        let diffs = serde_json::to_value(Query::Diffs {
            project_id: "7".to_owned(),
            iid: "9".to_owned(),
            head_sha: "a".repeat(40),
            page: 1,
        })
        .unwrap();
        assert_eq!(diffs["headSha"], "a".repeat(40));
    }

    #[test]
    fn action_and_position_wire_shape_uses_camel_case_fields() {
        let value = serde_json::to_value(Action::Comment {
            project_id: "7".to_owned(),
            iid: "9".to_owned(),
            body: "Please update this line".to_owned(),
            thread: true,
            position: Some(Position {
                base_sha: "a".repeat(40),
                start_sha: "b".repeat(40),
                head_sha: "c".repeat(40),
                old_path: "src/old.ts".to_owned(),
                new_path: "src/new.ts".to_owned(),
                old_line: None,
                new_line: Some(12),
                position_type: PositionType::Text,
                line_range: None,
            }),
        })
        .unwrap();
        assert_eq!(value["projectId"], "7");
        assert_eq!(value["position"]["baseSha"], "a".repeat(40));
        assert_eq!(value["position"]["newLine"], 12);
        assert!(value["position"].get("base_sha").is_none());

        for value in [
            serde_json::json!({"kind": "retryJob", "projectId": "7", "iid": "9", "pipelineProjectId": "8", "jobId": "900"}),
            serde_json::json!({"kind": "cancelJob", "projectId": "7", "iid": "9", "pipelineProjectId": "7", "jobId": "900"}),
            serde_json::json!({"kind": "playJob", "projectId": "7", "iid": "9", "pipelineProjectId": "7", "jobId": "900"}),
            serde_json::json!({"kind": "retryPipeline", "projectId": "7", "iid": "9", "pipelineProjectId": "7", "pipelineId": "55"}),
            serde_json::json!({"kind": "cancelPipeline", "projectId": "7", "iid": "9", "pipelineProjectId": "7", "pipelineId": "55"}),
        ] {
            let action: Action = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(action).unwrap(), value);
        }
        assert!(value["position"].get("lineRange").is_none());
    }

    #[test]
    fn reaction_and_todo_wire_shapes_use_camel_case_fields() {
        for value in [
            serde_json::json!({"kind": "mrAwards", "projectId": "7", "iid": "3"}),
            serde_json::json!({"kind": "noteAwards", "projectPath": "group/app", "iid": "3", "sinceNoteId": "41"}),
        ] {
            let query: Query = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(query).unwrap(), value);
        }
        for value in [
            serde_json::json!({"kind": "addAward", "projectId": "7", "iid": "3", "name": "thumbsup"}),
            serde_json::json!({"kind": "addAward", "projectId": "7", "iid": "3", "noteId": "41", "name": "tada"}),
            serde_json::json!({"kind": "removeAward", "projectId": "7", "iid": "3", "noteId": "41", "name": "tada"}),
            serde_json::json!({"kind": "markTodoDone", "projectId": "7", "iid": "3", "todoId": "102"}),
        ] {
            let action: Action = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(action).unwrap(), value);
        }
    }

    #[test]
    fn merge_request_operations_round_trip_in_camel_case() {
        for value in [
            serde_json::json!({"kind": "merge", "projectId": "7", "iid": "9", "sha": "a".repeat(40), "squash": true, "removeSourceBranch": false, "mergeCommitMessage": "Merge", "autoMerge": false}),
            serde_json::json!({"kind": "merge", "projectId": "7", "iid": "9", "sha": "a".repeat(40), "squash": false, "removeSourceBranch": true, "autoMerge": true}),
            serde_json::json!({"kind": "cancelAutoMerge", "projectId": "7", "iid": "9"}),
            serde_json::json!({"kind": "rebase", "projectId": "7", "iid": "9", "sha": "a".repeat(40)}),
            serde_json::json!({"kind": "setState", "projectId": "7", "iid": "9", "stateEvent": "close"}),
            serde_json::json!({"kind": "setState", "projectId": "7", "iid": "9", "stateEvent": "reopen"}),
            serde_json::json!({"kind": "setTitle", "projectId": "7", "iid": "9", "title": "Draft: A", "expectedTitle": "A"}),
            serde_json::json!({"kind": "setLabels", "projectId": "7", "iid": "9", "addLabels": ["bug"], "removeLabels": []}),
            serde_json::json!({"kind": "setMilestone", "projectId": "7", "iid": "9", "milestoneId": null, "expectedMilestoneId": "5"}),
            serde_json::json!({"kind": "requestChanges", "projectId": "7", "iid": "9", "projectPath": "group/app"}),
            serde_json::json!({"kind": "rerequestReview", "projectId": "7", "iid": "9", "projectPath": "group/app", "userId": "8"}),
        ] {
            let action: Action = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(action).unwrap(), value);
        }
        for value in [
            serde_json::json!({"kind": "labels", "projectId": "7", "search": "bug", "page": 1}),
            serde_json::json!({"kind": "milestones", "projectId": "7", "search": "", "page": 2}),
        ] {
            let query: Query = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(query).unwrap(), value);
        }
        assert!(serde_json::from_value::<Action>(serde_json::json!({"kind": "setState", "projectId": "7", "iid": "9", "stateEvent": "merge"})).is_err());
    }
    #[test]
    fn line_range_and_suggestion_wire_shapes_use_camel_case_fields() {
        let position: Position = serde_json::from_value(serde_json::json!({
            "baseSha": "a".repeat(40),
            "startSha": "b".repeat(40),
            "headSha": "c".repeat(40),
            "oldPath": "src/a.ts",
            "newPath": "src/a.ts",
            "newLine": 14,
            "positionType": "text",
            "lineRange": {
                "start": {"oldLine": 11, "newLine": 12, "oldPosition": 11, "newPosition": 12},
                "end": {"newLine": 14, "oldPosition": 12, "newPosition": 14},
                "hunk": {"oldStart": 10, "oldCount": 4, "newStart": 11, "newCount": 6},
            },
        }))
        .unwrap();
        let range = position.line_range.as_ref().unwrap();
        assert_eq!(range.start.old_line, Some(11));
        assert_eq!(range.end.old_line, None);
        assert_eq!(range.end.old_position, 12);
        assert_eq!(range.hunk.new_count, 6);
        let wire = serde_json::to_value(&position).unwrap();
        assert_eq!(wire["lineRange"]["end"]["newPosition"], 14);
        assert!(wire["lineRange"]["end"].get("oldLine").is_none());

        for value in [
            serde_json::json!({"kind": "mrVersions", "projectId": "7", "iid": "3", "page": 1}),
            serde_json::json!({"kind": "versionCompare", "projectId": "7", "iid": "3", "fromSha": "a".repeat(40), "toSha": "b".repeat(40), "page": 2}),
        ] {
            let query: Query = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(query).unwrap(), value);
        }

        let apply = serde_json::json!({
            "kind": "applySuggestions",
            "projectId": "7",
            "iid": "3",
            "suggestionIds": ["41", "42"],
            "headSha": "c".repeat(40),
            "commitMessage": "Apply review suggestions",
        });
        let action: Action = serde_json::from_value(apply.clone()).unwrap();
        assert_eq!(serde_json::to_value(&action).unwrap(), apply);
        let without_message: Action = serde_json::from_value(serde_json::json!({
            "kind": "applySuggestions",
            "projectId": "7",
            "iid": "3",
            "suggestionIds": ["41"],
            "headSha": "c".repeat(40),
        }))
        .unwrap();
        assert!(serde_json::to_value(without_message)
            .unwrap()
            .get("commitMessage")
            .is_none());
    }
}
