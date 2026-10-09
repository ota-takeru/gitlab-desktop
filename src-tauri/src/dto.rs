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
pub enum Query {
    Users {
        search: String,
        page: u32,
    },
    Project {
        path: String,
    },
    Todos {
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
    Approvals {
        project_id: String,
        iid: String,
    },
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
        for value in [
            serde_json::json!({"kind": "users", "search": "alice", "page": 1}),
            serde_json::json!({"kind": "project", "path": "group/project"}),
            serde_json::json!({"kind": "todos", "page": 2}),
            serde_json::json!({"kind": "notes", "projectId": "7", "iid": "3", "page": 1}),
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
            }),
        })
        .unwrap();
        assert_eq!(value["projectId"], "7");
        assert_eq!(value["position"]["baseSha"], "a".repeat(40));
        assert_eq!(value["position"]["newLine"], 12);
        assert!(value["position"].get("base_sha").is_none());
    }
}
