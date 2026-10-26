/**
 * The frontend side of the GitLab IPC contract.
 *
 * Keep these types deliberately close to the Rust DTOs. In particular, IDs
 * are strings even when GitLab sends a numeric identifier. This prevents
 * precision loss and keeps cache keys stable across GitLab versions.
 */

export interface GitLabUser {
  id: string
  username: string
  name: string
  /** GitLab's avatar URL; load it only through `getGitLabAvatar`. */
  avatarUrl?: string | null
}

export interface GitLabSession {
  id: string
  instanceUrl: string
  user: GitLabUser
  serverVersion: string | null
}

export type GitLabErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'BUSY'
  | 'INVALID_INPUT'
  | 'STORAGE'
  | 'UNSUPPORTED'
  | 'TOO_LARGE'
  | 'UNKNOWN_OUTCOME'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface GitLabErrorShape {
  code: GitLabErrorCode
  message: string
  retryAfterMs?: number
}

export class GitLabCommandError extends Error implements GitLabErrorShape {
  readonly code: GitLabErrorCode
  readonly retryAfterMs?: number

  constructor(error: GitLabErrorShape) {
    super(error.message)
    this.name = 'GitLabCommandError'
    this.code = error.code
    this.retryAfterMs = error.retryAfterMs
  }
}

export type GitLabQueryMode = 'cache' | 'network'

export interface ProjectQuery {
  kind: 'projects'
  search: string
  membership: boolean
  includeArchived: boolean
  page: number
}

export type MergeRequestState = 'all' | 'opened' | 'closed' | 'merged'

export interface MergeRequestsQuery {
  kind: 'mrs'
  search: string
  state: MergeRequestState
  projectId?: string
  groupId?: string
  labels?: string[]
  sourceBranch?: string
  targetBranch?: string
  reviewerId?: string
  assigneeId?: string
  authorId?: string
  updatedAfter?: string
  updatedBefore?: string
  page: number
  orderBy?: 'updated_at' | 'created_at'
  sort?: 'asc' | 'desc'
}

export interface UsersQuery { kind: 'users'; search: string; page: number }
export interface GroupsQuery { kind: 'groups'; search: string; page: number }
export interface ProjectLookupQuery { kind: 'project'; path: string }
/** Pending To-Dos are the unread notifications; `done` lists the read ones instead. */
export interface TodosQuery { kind: 'todos'; page: number; done?: true }
export interface BranchesQuery { kind: 'branches'; projectId: string; search: string; page: number }

export interface GitLabBranch {
  name: string
  default: boolean
  merged: boolean
  protected: boolean
  webUrl: string
  /** The latest commit; null when GitLab omitted it. */
  commit: { id: string; shortId: string; title: string; authorName: string; committedDate: string } | null
}
export interface GitLabGroup {
  id: string
  name: string
  /** The group's URL path, e.g. `team/platform`. */
  fullPath: string
  fullName: string
  webUrl: string
}
export interface NotesQuery { kind: 'notes'; projectId: string; iid: string; page: number }

export interface GitLabTodo {
  id: string
  actionName: string
  body: string
  createdAt: string
  projectId: string
  projectName: string
  iid: string
  title: string
  webUrl: string
  author: GitLabUser
}

export interface MergeRequestQuery {
  kind: 'mr'
  projectId: string
  iid: string
}

export type ReviewResourceKind = 'discussions' | 'commits' | 'drafts'

export interface ReviewResourceQuery {
  kind: ReviewResourceKind
  projectId: string
  iid: string
  page: number
}

export interface DiffsQuery extends Omit<ReviewResourceQuery, 'kind'> {
  kind: 'diffs'
  /** The MR head the diff was requested for; required to prevent stale line positions. */
  headSha: string
}

export interface CommitDiffQuery {
  kind: 'commitDiff'
  projectId: string
  iid: string
  sha: string
  page: number
}

export interface FileQuery {
  kind: 'file'
  projectId: string
  path: string
  sha: string
}

export interface BlameQuery { kind: 'blame'; projectId: string; path: string; sha: string; startLine: number; endLine: number }
export interface CommitMergeRequestsQuery { kind: 'commitMergeRequests'; projectId: string; sha: string }

export interface BlameBlock { commitId: string; title: string; authorName: string; committedAt: string; lines: string[] }
export interface AssociatedMergeRequest { projectId: string; iid: string; title: string; state: string; webUrl: string }

/** One folder of a repository; without `ref`, the default branch. `path` is '' for the top. */
export interface TreeQuery {
  kind: 'tree'
  projectId: string
  ref?: string
  path: string
  page: number
}

/** A file's text by the blob id from its folder listing. */
export interface BlobQuery {
  kind: 'blob'
  projectId: string
  sha: string
}

/** A folder entry: `tree` is a folder, `blob` a file and `commit` a submodule. */
export interface TreeEntry {
  id: string
  name: string
  path: string
  type: 'tree' | 'blob' | 'commit'
}

export interface ApprovalsQuery {
  kind: 'approvals'
  projectId: string
  iid: string
}

/** The MR's diff versions (one per push), newest first. */
export interface MrVersionsQuery {
  kind: 'mrVersions'
  projectId: string
  iid: string
  page: number
}

/** The changes between two versions of an MR, by their head commits. */
export interface VersionCompareQuery {
  kind: 'versionCompare'
  projectId: string
  iid: string
  fromSha: string
  toSha: string
  page: number
}

export interface MrVersion {
  id: string
  headCommitSha: string
  baseCommitSha: string
  startCommitSha: string
  createdAt: string
  state: string
  realSize: string
}

/** Who approved each MR of one list page, fetched in a single request. */
export interface MrApprovalsQuery {
  kind: 'mrApprovals'
  items: { projectPath: string; iid: string }[]
}

/** `approvedBy` holds user ids; null when GitLab did not return the MR. */
export interface MrApproval {
  projectPath: string
  iid: string
  approvedBy: string[] | null
}

/** Emoji reactions on a merge request itself. */
export interface MrAwardsQuery {
  kind: 'mrAwards'
  projectId: string
  iid: string
}

/**
 * Emoji reactions on the comments of a merge request, from the newest back to
 * `sinceNoteId` (the oldest comment on screen), read in one GraphQL request per
 * 100 comments.
 */
export interface NoteAwardsQuery {
  kind: 'noteAwards'
  projectPath: string
  iid: string
  sinceNoteId: string
}

/** One user's emoji reaction; `name` is GitLab's emoji name such as `thumbsup`. */
export interface AwardEmoji {
  name: string
  user: GitLabUser
}

export interface NoteAwards {
  noteId: string
  awards: AwardEmoji[]
}

/** One page of an MR's pipelines, newest first. */
export interface MrPipelinesQuery { kind: 'mrPipelines'; projectId: string; iid: string; page: number }
/** One pipeline, in the project that ran it (`Pipeline.projectId`, else the MR's project). */
export interface PipelineQuery { kind: 'pipeline'; projectId: string; pipelineId: string }
/** All jobs and trigger jobs of a pipeline, up to a bound (`completeness: 'truncated'` beyond it). */
export interface PipelineJobsQuery { kind: 'pipelineJobs'; projectId: string; pipelineId: string }
/** The end of a job log; kept in memory only, never in the cache. */
export interface JobTraceQuery { kind: 'jobTrace'; projectId: string; jobId: string }

export interface Pipeline {
  id: string
  /** The project that ran it; null when GitLab omitted it. */
  projectId: string | null
  status: string
  ref: string
  sha: string
  source?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  /** Seconds; only the single-pipeline response has it. */
  duration?: number | null
  webUrl: string
}

export interface PipelineJob {
  id: string
  /** A bridge (trigger job) starts a downstream pipeline instead of running a script. */
  kind: 'job' | 'bridge'
  name: string
  stage: string
  status: string
  allowFailure: boolean
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
  duration: number | null
  failureReason: string | null
  webUrl: string
  downstreamPipeline: { id: string; status: string; webUrl: string } | null
}

/** A colour name from the log, shown with a theme colour. */
export type TraceColor = 'gray' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan'
export interface TraceSpan { text: string; fg?: TraceColor; bold?: boolean }

export interface JobTrace {
  /** Each line is a list of styled spans; escape sequences are already removed. */
  lines: TraceSpan[][]
  /** The start of a longer log was left out. */
  headOmitted: boolean
}

export type GitLabQuery =
  | ProjectQuery
  | UsersQuery
  | GroupsQuery
  | ProjectLookupQuery
  | TodosQuery
  | BranchesQuery
  | NotesQuery
  | MergeRequestsQuery
  | MergeRequestQuery
  | ReviewResourceQuery
  | DiffsQuery
  | CommitDiffQuery
  | FileQuery
  | BlameQuery
  | CommitMergeRequestsQuery
  | TreeQuery
  | BlobQuery
  | ApprovalsQuery
  | MrApprovalsQuery
  | MrAwardsQuery
  | NoteAwardsQuery
  | MrPipelinesQuery
  | PipelineQuery
  | PipelineJobsQuery
  | JobTraceQuery
  | LabelsQuery
  | MilestonesQuery
  | MrVersionsQuery
  | VersionCompareQuery

/** Labels the project's MRs can use, including those of its ancestor groups. */
export interface LabelsQuery { kind: 'labels'; projectId: string; search: string; page: number }
/** Active milestones of the project and its ancestor groups. */
export interface MilestonesQuery { kind: 'milestones'; projectId: string; search: string; page: number }

export interface GitLabLabel {
  id: string
  name: string
  /** GitLab's `#rrggbb` colour; null when GitLab sent something else. */
  color: string | null
  description: string
}

export interface Milestone {
  id: string
  title: string
  state: string
  dueDate: string | null
  webUrl: string | null
}

export interface Project {
  id: string
  name: string
  pathWithNamespace: string
  description: string
  webUrl: string
  archived: boolean
  /** ISO time of the latest activity; absent when GitLab omitted it. */
  lastActivityAt?: string
  /** `never`, `always`, `default_on` or `default_off`; absent when GitLab omitted it. */
  squashOption?: string
}

export interface DiffRefs {
  baseSha: string
  startSha: string
  headSha: string
}

export interface MergeRequest {
  id: string
  iid: string
  projectId: string
  title: string
  description: string
  state: string
  webUrl: string
  author: GitLabUser
  sourceBranch: string
  targetBranch: string
  updatedAt: string
  /** GitLab's creation time; absent when GitLab omitted it. */
  createdAt?: string
  headSha: string | null
  diffRefs: DiffRefs | null
  projectPath?: string | null
  draft?: boolean
  labels?: string[]
  assignees?: GitLabUser[]
  reviewers?: GitLabUser[]
  pipeline?: { status: string; webUrl: string } | null
  /*
   * What the merge controls need. Null (or absent in older cached data) means
   * GitLab did not say, which is never read as "allowed".
   */
  detailedMergeStatus?: string | null
  mergeStatus?: string | null
  hasConflicts?: boolean | null
  blockingDiscussionsResolved?: boolean | null
  squash?: boolean | null
  /** Whether a merge squashes once the project's squash setting is applied. */
  squashOnMerge?: boolean | null
  forceRemoveSourceBranch?: boolean | null
  shouldRemoveSourceBranch?: boolean | null
  /** Set to merge automatically when its checks pass. */
  autoMerge?: boolean | null
  rebaseInProgress?: boolean | null
  /** Commits the source branch is behind the target. */
  divergedCommitsCount?: number | null
  /** Whether the current user may merge. */
  canMerge?: boolean | null
  mergeError?: string | null
  milestone?: Milestone | null
}

export interface Diff {
  oldPath: string
  newPath: string
  diff: string
  newFile: boolean
  deletedFile: boolean
  renamedFile: boolean
  tooLarge: boolean
  collapsed: boolean
  /** A file git does not track yet; only in a local clone's changes. */
  untracked?: boolean
}

export interface Position {
  baseSha: string
  startSha: string
  headSha: string
  oldPath: string
  newPath: string
  oldLine?: number
  newLine?: number
  positionType: 'text' | 'file'
  /** The lines of a multi-line comment, ending at `oldLine`/`newLine`. */
  lineRange?: LineRange
}

/**
 * One end of a line range. GitLab returns the shown numbers and the line's
 * side; a new comment also sends the hunk's counters at the line, from which
 * the native side computes GitLab's line code.
 */
export interface LineRangePoint {
  oldLine?: number
  newLine?: number
  type?: 'old' | 'new'
  oldPosition?: number
  newPosition?: number
}

export interface LineRange {
  start: LineRangePoint
  end: LineRangePoint
  /** The hunk both lines belong to; sent with a new comment only. */
  hunk?: { oldStart: number; oldCount: number; newStart: number; newCount: number }
}

/** A change suggested in a diff comment, as GitLab lists it with the comment. */
export interface Suggestion {
  id: string
  fromLine: number | null
  toLine: number | null
  appliable: boolean
  applied: boolean
  fromContent: string
  toContent: string
}

export interface Note {
  id: string
  body: string
  author: GitLabUser
  createdAt: string
  updatedAt?: string
  system: boolean
  resolvable: boolean
  resolved: boolean
  position: Position | null
  /** Suggestions of a diff comment, in the order of the body's blocks. */
  suggestions?: Suggestion[]
}

export interface Discussion {
  id: string
  individualNote: boolean
  notes: Note[]
}

export interface Commit {
  id: string
  title: string
  /** Fallback for older cached records. */
  createdAt: string
  /** Git's committer timestamp, which may differ from the creation/author date. */
  committedAt?: string
}

export interface Draft {
  id: string
  body: string
  discussionId: string | null
  position: Position | null
}

export interface Approvals {
  approved: boolean
  approvedBy: GitLabUser[]
}

export interface FileContent {
  content: string
}

export type QueryData =
  | Project[]
  | Project
  | GitLabUser[]
  | GitLabGroup[]
  | GitLabTodo[]
  | GitLabBranch[]
  | Note[]
  | MergeRequest[]
  | MergeRequest
  | Diff[]
  | Discussion[]
  | Commit[]
  | Draft[]
  | FileContent
  | BlameBlock[]
  | AssociatedMergeRequest[]
  | TreeEntry[]
  | Approvals
  | AwardEmoji[]
  | NoteAwards[]
  | Pipeline[]
  | Pipeline
  | PipelineJob[]
  | JobTrace
  | GitLabLabel[]
  | Milestone[]
  | MrVersion[]

export interface GitLabSnapshot<T = QueryData> {
  data: T
  fetchedAt: number
  source: 'cache' | 'network'
  nextPage: number | null
  /** GitLab's X-Total-Pages; missing for old cache entries and very large collections. */
  totalPages?: number | null
  completeness: 'page' | 'complete' | 'truncated'
}

export type CommentAction = {
  kind: 'comment'
  projectId: string
  iid: string
  body: string
  thread: boolean
  position?: Position
}

export type ReplyAction = {
  kind: 'reply'
  projectId: string
  iid: string
  discussionId: string
  body: string
}

export type EditNoteAction = {
  kind: 'editNote'
  projectId: string
  iid: string
  noteId: string
  body: string
}

export type DeleteNoteAction = {
  kind: 'deleteNote'
  projectId: string
  iid: string
  noteId: string
}

export type ResolveAction = {
  kind: 'resolve'
  projectId: string
  iid: string
  discussionId: string
  resolved: boolean
}

export type SaveDraftAction = {
  kind: 'saveDraft'
  projectId: string
  iid: string
  body: string
  discussionId?: string
  position?: Position
}

export type EditDraftAction = {
  kind: 'editDraft'
  projectId: string
  iid: string
  draftId: string
  body: string
}

export type DeleteDraftAction = {
  kind: 'deleteDraft'
  projectId: string
  iid: string
  draftId: string
}

export type PublishDraftAction = {
  kind: 'publishDraft'
  projectId: string
  iid: string
  draftId: string
}

export type ApproveAction = {
  kind: 'approve'
  projectId: string
  iid: string
  sha: string
}

export type UnapproveAction = {
  kind: 'unapprove'
  projectId: string
  iid: string
}

/** Replaces the assignees; refused when GitLab no longer has `expectedUserIds`. */
export type SetAssigneesAction = {
  kind: 'setAssignees'
  projectId: string
  iid: string
  userIds: string[]
  expectedUserIds: string[]
}

/** Replaces the reviewers; refused when GitLab no longer has `expectedUserIds`. */
export type SetReviewersAction = {
  kind: 'setReviewers'
  projectId: string
  iid: string
  userIds: string[]
  expectedUserIds: string[]
}

export type GitLabAction =
  | CommentAction
  | ReplyAction
  | EditNoteAction
  | DeleteNoteAction
  | ResolveAction
  | SaveDraftAction
  | EditDraftAction
  | DeleteDraftAction
  | PublishDraftAction
  | ApproveAction
  | UnapproveAction
  | SetAssigneesAction
  | SetReviewersAction
  | UploadAttachmentAction
  | SetDescriptionAction
  | AddAwardAction
  | RemoveAwardAction
  | MarkTodoDoneAction
  | JobAction
  | PipelineAction
  | MergeAction
  | CancelAutoMergeAction
  | RebaseAction
  | SetStateAction
  | SetTitleAction
  | SetLabelsAction
  | SetMilestoneAction
  | RequestChangesAction
  | RerequestReviewAction
  | ApplySuggestionsAction

/** Adds the user's reaction to the MR, or to the comment `noteId`. */
export type AddAwardAction = {
  kind: 'addAward'
  projectId: string
  iid: string
  noteId?: string
  name: string
}

/** Removes the user's own reaction of that name; Rust reads its ID from GitLab first. */
export type RemoveAwardAction = {
  kind: 'removeAward'
  projectId: string
  iid: string
  noteId?: string
  name: string
}

/** Marks a To-Do done; `projectId`/`iid` are its merge request, checked before the write. */
export type MarkTodoDoneAction = {
  kind: 'markTodoDone'
  projectId: string
  iid: string
  todoId: string
}

/**
 * Job and pipeline operations carry the MR they were started from, so an
 * unknown outcome stops writes to that MR; `pipelineProjectId` ran the pipeline.
 */
export type JobAction = {
  kind: 'retryJob' | 'cancelJob' | 'playJob'
  projectId: string
  iid: string
  pipelineProjectId: string
  jobId: string
}

export type PipelineAction = {
  kind: 'retryPipeline' | 'cancelPipeline'
  projectId: string
  iid: string
  pipelineProjectId: string
  pipelineId: string
}

/** Merges the head `sha` the user saw, or with `autoMerge` once its checks pass. */
export type MergeAction = {
  kind: 'merge'
  projectId: string
  iid: string
  sha: string
  squash: boolean
  removeSourceBranch: boolean
  /** Omitted for GitLab's default message. */
  mergeCommitMessage?: string
  autoMerge: boolean
}

export type CancelAutoMergeAction = { kind: 'cancelAutoMerge'; projectId: string; iid: string }

/** Rebases the source branch whose head is `sha`; GitLab finishes it in the background. */
export type RebaseAction = { kind: 'rebase'; projectId: string; iid: string; sha: string }

/** Closes an open MR or reopens a closed one; refused when the state changed. */
export type SetStateAction = { kind: 'setState'; projectId: string; iid: string; stateEvent: 'close' | 'reopen' }

/** Replaces the title; refused when GitLab no longer has `expectedTitle`. */
export type SetTitleAction = { kind: 'setTitle'; projectId: string; iid: string; title: string; expectedTitle: string }

/** Adds and removes labels, keeping labels others changed meanwhile. */
export type SetLabelsAction = { kind: 'setLabels'; projectId: string; iid: string; addLabels: string[]; removeLabels: string[] }

/** Sets or (null) clears the milestone; refused when GitLab no longer has `expectedMilestoneId`. */
export type SetMilestoneAction = { kind: 'setMilestone'; projectId: string; iid: string; milestoneId: string | null; expectedMilestoneId: string | null }

/** Marks the current user's review as requesting changes. */
export type RequestChangesAction = { kind: 'requestChanges'; projectId: string; iid: string; projectPath: string }

/** Asks a reviewer for a new review. */
export type RerequestReviewAction = { kind: 'rerequestReview'; projectId: string; iid: string; projectPath: string; userId: string }

/**
 * Applies suggestions as one commit; refused when the MR head is no longer
 * `headSha`, the head they were shown on.
 */
export type ApplySuggestionsAction = {
  kind: 'applySuggestions'
  projectId: string
  iid: string
  suggestionIds: string[]
  headSha: string
  commitMessage?: string
}

/** Replaces the description; refused when GitLab no longer has `expectedDescription`. */
export type SetDescriptionAction = {
  kind: 'setDescription'
  projectId: string
  iid: string
  description: string
  expectedDescription: string
}

export type UploadAttachmentAction = {
  kind: 'uploadAttachment'
  projectId: string
  iid: string
  fileName: string
}

export type GitLabQueryData<Q extends GitLabQuery> =
  Q extends ProjectQuery ? Project[]
    : Q extends UsersQuery ? GitLabUser[]
      : Q extends GroupsQuery ? GitLabGroup[]
      : Q extends ProjectLookupQuery ? Project
        : Q extends TodosQuery ? GitLabTodo[]
        : Q extends BranchesQuery ? GitLabBranch[]
          : Q extends NotesQuery ? Note[]
    : Q extends MergeRequestsQuery ? MergeRequest[]
      : Q extends MergeRequestQuery ? MergeRequest
        : Q extends DiffsQuery ? Diff[]
          : Q extends ReviewResourceQuery
          ? Q['kind'] extends 'discussions' ? Discussion[]
              : Q['kind'] extends 'commits' ? Commit[]
                : Draft[]
          : Q extends CommitDiffQuery ? Diff[]
            : Q extends FileQuery ? FileContent
              : Q extends BlameQuery ? BlameBlock[]
              : Q extends CommitMergeRequestsQuery ? AssociatedMergeRequest[]
              : Q extends TreeQuery ? TreeEntry[]
              : Q extends BlobQuery ? FileContent
              : Q extends ApprovalsQuery ? Approvals
                : Q extends MrApprovalsQuery ? MrApproval[]
                : Q extends MrAwardsQuery ? AwardEmoji[]
                : Q extends NoteAwardsQuery ? NoteAwards[]
                : Q extends MrPipelinesQuery ? Pipeline[]
                : Q extends PipelineQuery ? Pipeline
                : Q extends PipelineJobsQuery ? PipelineJob[]
                : Q extends JobTraceQuery ? JobTrace
                : Q extends LabelsQuery ? GitLabLabel[]
                : Q extends MilestonesQuery ? Milestone[]
                : Q extends MrVersionsQuery ? MrVersion[]
                : Q extends VersionCompareQuery ? Diff[]
                : QueryData

export function isGitLabErrorShape(value: unknown): value is GitLabErrorShape {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GitLabErrorShape>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}
