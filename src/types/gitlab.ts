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
  reviewerId?: string
  authorId?: string
  updatedAfter?: string
  updatedBefore?: string
  page: number
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

export interface ApprovalsQuery {
  kind: 'approvals'
  projectId: string
  iid: string
}

export type GitLabQuery =
  | ProjectQuery
  | MergeRequestsQuery
  | MergeRequestQuery
  | ReviewResourceQuery
  | DiffsQuery
  | CommitDiffQuery
  | FileQuery
  | ApprovalsQuery

export interface Project {
  id: string
  name: string
  pathWithNamespace: string
  description: string
  webUrl: string
  archived: boolean
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
  headSha: string | null
  diffRefs: DiffRefs | null
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
}

export interface Note {
  id: string
  body: string
  author: GitLabUser
  createdAt: string
  system: boolean
  resolvable: boolean
  resolved: boolean
  position: Position | null
}

export interface Discussion {
  id: string
  individualNote: boolean
  notes: Note[]
}

export interface Commit {
  id: string
  title: string
  createdAt: string
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
  | MergeRequest[]
  | MergeRequest
  | Diff[]
  | Discussion[]
  | Commit[]
  | Draft[]
  | FileContent
  | Approvals

export interface GitLabSnapshot<T = QueryData> {
  data: T
  fetchedAt: number
  source: 'cache' | 'network'
  nextPage: number | null
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

export type GitLabQueryData<Q extends GitLabQuery> =
  Q extends ProjectQuery ? Project[]
    : Q extends MergeRequestsQuery ? MergeRequest[]
      : Q extends MergeRequestQuery ? MergeRequest
        : Q extends DiffsQuery ? Diff[]
          : Q extends ReviewResourceQuery
          ? Q['kind'] extends 'discussions' ? Discussion[]
              : Q['kind'] extends 'commits' ? Commit[]
                : Draft[]
          : Q extends CommitDiffQuery ? Diff[]
            : Q extends FileQuery ? FileContent
              : Q extends ApprovalsQuery ? Approvals
                : QueryData

export function isGitLabErrorShape(value: unknown): value is GitLabErrorShape {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GitLabErrorShape>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}
