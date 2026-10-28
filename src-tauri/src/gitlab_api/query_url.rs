//! The GitLab REST URL, the response kind and the extra query parameters of each read.

use super::*;

pub(super) fn build_query_url(
    api_base: &Url,
    query: &Query,
) -> Result<(Url, ResponseKind), AppError> {
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
        Query::User { username } => {
            validate_username(username)?;
            (
                endpoint(api_base, &["users"])?,
                ResponseKind::Users,
                vec![("username".to_owned(), username.clone())],
            )
        }
        Query::UserById { user_id } => {
            validate_id(user_id, "userId")?;
            (
                endpoint(api_base, &["users", user_id])?,
                ResponseKind::User,
                Vec::new(),
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
        Query::UserProjects {
            user_id,
            search,
            include_archived,
            page,
        } => {
            validate_id(user_id, "userId")?;
            validate_page(*page)?;
            let mut params = vec![
                ("order_by".to_owned(), "last_activity_at".to_owned()),
                ("sort".to_owned(), "desc".to_owned()),
                ("simple".to_owned(), "true".to_owned()),
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
                endpoint(api_base, &["users", user_id, "projects"])?,
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
                return Err(
                    AppError::new("INVALID_INPUT", "MRの並び順の指定が正しくありません。")
                        .key("native.query.invalidSort"),
                );
            }
            if let Some(project_id) = project_id {
                validate_id(project_id, "projectId")?;
            }
            if project_id.is_some() && group_id.is_some() {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "MR検索ではグループとプロジェクトを同時に指定できません。",
                )
                .key("native.query.groupAndProject"));
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
        Query::Blame {
            project_id,
            path,
            sha,
            start_line,
            end_line,
        } => {
            validate_id(project_id, "projectId")?;
            validate_path(path)?;
            validate_sha(sha, "sha")?;
            if *start_line == 0
                || *end_line < *start_line
                || end_line.saturating_sub(*start_line) >= 100
                || *end_line > 1_000_000
            {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "Blameは1回につき100行以内で指定してください。",
                )
                .key("native.query.blameTooManyLines"));
            }
            (
                endpoint(
                    api_base,
                    &["projects", project_id, "repository", "files", path, "blame"],
                )?,
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
                endpoint(
                    api_base,
                    &[
                        "projects",
                        project_id,
                        "repository",
                        "commits",
                        sha,
                        "merge_requests",
                    ],
                )?,
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
            )
            .key("native.query.approvalsUnsupported"))
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
            )
            .key("native.query.noteAwardsUnsupported"))
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
        Query::DescriptionTemplates { .. } | Query::CommentTemplates { .. } => {
            return Err(AppError::new(
                "INVALID_INPUT",
                "テンプレートはこの方法では取得できません。",
            )
            .key("native.query.templatesUnsupported"))
        }
        Query::PipelineJobs { .. } | Query::JobTrace { .. } => {
            return Err(AppError::new(
                "INVALID_INPUT",
                "ジョブの情報はこの方法では取得できません。",
            )
            .key("native.query.jobUnsupported"))
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
