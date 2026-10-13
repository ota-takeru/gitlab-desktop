/**
 * Development-only stand-in for the Rust IPC commands. It lets the real client
 * screens render in a browser with fixed data; nothing is sent to GitLab and
 * the session is labelled as fixture data.
 */
import { mockIPC } from '@tauri-apps/api/mocks'

import { createFixtureData, fixtureSession, fixtureUser, type FixtureMergeRequest } from './gitlabFixtures'
import type { Discussion, Draft, GitLabAction, GitLabErrorShape, GitLabQuery, GitLabSnapshot, Note, QueryData } from '../types/gitlab'

/**
 * - ready: network queries return the fixtures.
 * - loading: network queries never finish.
 * - error: network queries fail with a network error.
 * - empty: every collection is empty.
 * - stale: an old cached page is shown and the network refresh fails.
 */
export type FixtureState = 'ready' | 'loading' | 'error' | 'empty' | 'stale'

export const fixtureStates: readonly FixtureState[] = ['ready', 'loading', 'error', 'empty', 'stale']

export function parseFixtureState(value: string | null): FixtureState {
  return fixtureStates.find((state) => state === value) ?? 'ready'
}

const networkError: GitLabErrorShape = { code: 'NETWORK', message: '固定データ: 接続エラーの表示を確認するための応答です。' }
const STALE_AGE_MS = 2 * 60 * 60 * 1000

interface QueryInput { mode: 'cache' | 'network'; query: GitLabQuery }
interface MutateInput { action: GitLabAction }

export function installFixtureIpc(state: FixtureState): void {
  const now = Date.now()
  const data = createFixtureData(now)
  const drafts = new Map<string, Draft[]>()
  const localDrafts = new Map<string, { body: string; updatedAt: number }>()
  let sequence = 0

  // `isTauri()` reads this flag; mockIPC provides the IPC internals.
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true })
  mockIPC((command, args) => {
    const payload = (args ?? {}) as Record<string, unknown>
    switch (command) {
      case 'runtime_info': return { appVersion: 'fixture', arch: 'x86_64', os: 'windows' }
      case 'restore_session':
      case 'connect_gitlab':
      case 'connect_gitlab_from_glab': return fixtureSession
      case 'list_glab_connections': return []
      case 'query_gitlab': return query((payload.input as QueryInput))
      case 'mutate_gitlab': return mutate((payload.input as MutateInput).action)
      case 'upload_gitlab_attachment': {
        const fileName = String((payload.input as { fileName?: unknown }).fileName ?? 'file')
        return `[${fileName}](/uploads/fixture/${encodeURIComponent(fileName)})`
      }
      case 'get_local_draft': return localDrafts.get(String(payload.key)) ?? null
      case 'set_local_draft':
        localDrafts.set(String(payload.key), { body: String(payload.body), updatedAt: Date.now() })
        return null
      case 'clear_local_drafts':
        localDrafts.clear()
        return null
      case 'check_app_update': return { configured: false, notes: null, version: null }
      case 'get_pending_operation':
      case 'get_gitlab_avatar': return null
      case 'plugin:notification|is_permission_granted': return false
      case 'plugin:notification|request_permission': return 'denied'
      case 'acknowledge_pending_operation':
      case 'cancel_gitlab_request':
      case 'clear_gitlab_cache':
      case 'disconnect_gitlab':
      case 'open_gitlab_url':
      case 'set_window_close_guard':
      case 'close_app_window':
      case 'plugin:notification|notify': return null
      default:
        console.warn(`fixture IPC: unhandled command ${command}`)
        throw { code: 'UNSUPPORTED', message: `固定データでは未対応のコマンドです: ${command}` } satisfies GitLabErrorShape
    }
  }, { shouldMockEvents: true })

  function query({ mode, query: request }: QueryInput): Promise<GitLabSnapshot | null> | GitLabSnapshot | null {
    if (mode === 'cache') return state === 'stale' ? snapshot(answer(request), 'cache', now - STALE_AGE_MS) : null
    if (state === 'loading') return new Promise(() => undefined)
    if (state === 'error' || state === 'stale') throw networkError
    return snapshot(answer(request), 'network', Date.now())
  }

  function snapshot(value: QueryData, source: 'cache' | 'network', fetchedAt: number): GitLabSnapshot {
    const result = state === 'empty' && Array.isArray(value) ? [] : value
    return { completeness: 'complete', data: result, fetchedAt, nextPage: null, source, totalPages: 1 }
  }

  function answer(request: GitLabQuery): QueryData {
    if ('page' in request && request.page > 1) return []
    switch (request.kind) {
      case 'projects': return data.projects.filter((project) => matches(`${project.name} ${project.pathWithNamespace}`, request.search))
      case 'project': return data.projects.find((project) => project.pathWithNamespace === request.path) ?? notFound()
      case 'users': return data.users.filter((user) => matches(`${user.name} ${user.username}`, request.search))
      case 'todos': return data.mergeRequests.slice(0, 1).map(({ mergeRequest }) => ({
        actionName: 'review_requested',
        author: mergeRequest.author,
        body: mergeRequest.title,
        createdAt: mergeRequest.updatedAt,
        id: `todo-${mergeRequest.id}`,
        iid: mergeRequest.iid,
        projectId: mergeRequest.projectId,
        projectName: mergeRequest.projectPath ?? '',
        title: mergeRequest.title,
        webUrl: mergeRequest.webUrl,
      }))
      case 'branches': {
        // The default branch and each fixture MR's source branch, newest first.
        const items = data.mergeRequests.map((item) => item.mergeRequest).filter((mergeRequest) => mergeRequest.projectId === request.projectId)
        const branches = [
          ...items.map((mergeRequest) => ({ commit: { authorName: mergeRequest.author.name, committedDate: mergeRequest.updatedAt, id: mergeRequest.headSha ?? '', shortId: (mergeRequest.headSha ?? '').slice(0, 8), title: mergeRequest.title }, default: false, merged: mergeRequest.state === 'merged', name: mergeRequest.sourceBranch, protected: false, webUrl: '' })),
          ...(items[0] ? [{ commit: null, default: true, merged: false, name: items[0].targetBranch, protected: true, webUrl: '' }] : []),
        ]
        return branches.filter((branch, index) => branches.findIndex((other) => other.name === branch.name) === index && matches(branch.name, request.search))
      }
      case 'mrs': return data.mergeRequests.map((item) => item.mergeRequest).filter((mergeRequest) =>
        (request.state === 'all' || mergeRequest.state === request.state)
        && (!request.projectId || mergeRequest.projectId === request.projectId)
        && (!request.authorId || mergeRequest.author.id === request.authorId)
        && (!request.reviewerId || Boolean(mergeRequest.reviewers?.some((user) => user.id === request.reviewerId)))
        && (!request.assigneeId || Boolean(mergeRequest.assignees?.some((user) => user.id === request.assigneeId)))
        && (!request.labels?.length || request.labels.every((label) => mergeRequest.labels?.includes(label)))
        && (!request.sourceBranch || mergeRequest.sourceBranch === request.sourceBranch)
        && matches(`${mergeRequest.title} ${mergeRequest.description}`, request.search))
      case 'mr': return find(request).mergeRequest
      case 'discussions': return find(request).discussions
      case 'notes': return find(request).discussions.flatMap((discussion) => discussion.notes)
      case 'commits': return find(request).commits.map(({ createdAt, id, title }) => ({ createdAt, id, title }))
      case 'drafts': return drafts.get(keyOf(request)) ?? []
      case 'diffs': return find(request).diffs
      case 'commitDiff': return find(request).commits.find((commit) => commit.id === request.sha)?.diffs ?? notFound()
      case 'file': {
        const content = data.mergeRequests.find((item) => item.mergeRequest.projectId === request.projectId && request.path in item.files)?.files[request.path]
        return content === undefined ? notFound() : { content }
      }
      case 'approvals': {
        const { approvedBy } = find(request)
        return { approved: approvedBy.length > 0, approvedBy }
      }
      case 'mrApprovals': return request.items.map((item) => ({
        ...item,
        approvedBy: data.mergeRequests.find(({ mergeRequest }) => mergeRequest.projectPath === item.projectPath && mergeRequest.iid === item.iid)?.approvedBy.map((user) => user.id) ?? null,
      })) as unknown as QueryData
    }
  }

  function mutate(action: GitLabAction): null {
    const target = find(action)
    const discussion = 'discussionId' in action && action.discussionId ? target.discussions.find((item) => item.id === action.discussionId) : undefined
    switch (action.kind) {
      case 'comment':
        target.discussions.push({ id: nextId('discussion'), individualNote: !action.thread, notes: [note(action.body, action.position ?? null, action.thread)] })
        break
      case 'reply':
        discussion?.notes.push(note(action.body, discussion.notes[0]?.position ?? null, Boolean(discussion.notes[0]?.resolvable)))
        break
      case 'editNote':
        for (const item of notesOf(target)) if (item.id === action.noteId) Object.assign(item, { body: action.body, updatedAt: new Date().toISOString() })
        break
      case 'deleteNote':
        target.discussions = target.discussions
          .map((item) => ({ ...item, notes: item.notes.filter((candidate) => candidate.id !== action.noteId) }))
          .filter((item) => item.notes.length > 0)
        break
      case 'resolve':
        for (const item of discussion?.notes ?? []) item.resolved = action.resolved
        break
      case 'saveDraft':
        drafts.set(keyOf(action), [...drafts.get(keyOf(action)) ?? [], { body: action.body, discussionId: action.discussionId ?? null, id: nextId('draft'), position: action.position ?? null }])
        break
      case 'editDraft':
        drafts.set(keyOf(action), (drafts.get(keyOf(action)) ?? []).map((draft) => draft.id === action.draftId ? { ...draft, body: action.body } : draft))
        break
      case 'deleteDraft':
      case 'publishDraft': {
        const list = drafts.get(keyOf(action)) ?? []
        const draft = list.find((item) => item.id === action.draftId)
        drafts.set(keyOf(action), list.filter((item) => item.id !== action.draftId))
        if (action.kind === 'publishDraft' && draft) {
          const parent = draft.discussionId ? target.discussions.find((item) => item.id === draft.discussionId) : undefined
          if (parent) parent.notes.push(note(draft.body, parent.notes[0]?.position ?? null, Boolean(parent.notes[0]?.resolvable)))
          else target.discussions.push({ id: nextId('discussion'), individualNote: false, notes: [note(draft.body, draft.position, true)] })
        }
        break
      }
      case 'approve':
        if (!target.approvedBy.some((user) => user.id === fixtureUser.id)) target.approvedBy.push(fixtureUser)
        break
      case 'unapprove':
        target.approvedBy = target.approvedBy.filter((user) => user.id !== fixtureUser.id)
        break
      case 'setAssignees':
      case 'setReviewers': {
        const users = action.userIds.map((id) => data.users.find((user) => user.id === id)).filter((user) => user !== undefined)
        target.mergeRequest = { ...target.mergeRequest, [action.kind === 'setAssignees' ? 'assignees' : 'reviewers']: users }
        break
      }
      case 'setDescription':
        if ((target.mergeRequest.description ?? '') !== action.expectedDescription) throw { code: 'INVALID_INPUT', message: 'The merge request changed. Refresh it and try again.' } satisfies GitLabErrorShape
        target.mergeRequest = { ...target.mergeRequest, description: action.description }
        break
      case 'uploadAttachment':
        break
    }
    return null
  }

  function find(ref: { projectId: string; iid: string }): FixtureMergeRequest {
    return data.mergeRequests.find(({ mergeRequest }) => mergeRequest.projectId === ref.projectId && mergeRequest.iid === ref.iid) ?? notFound()
  }

  function note(body: string, position: Note['position'], resolvable: boolean): Note {
    return { author: fixtureUser, body, createdAt: new Date().toISOString(), id: nextId('note'), position, resolvable, resolved: false, system: false }
  }

  function nextId(prefix: string): string {
    sequence += 1
    return `fixture-${prefix}-${sequence}`
  }
}

function notesOf(target: FixtureMergeRequest): Note[] {
  return target.discussions.flatMap((discussion: Discussion) => discussion.notes)
}

function keyOf(ref: { projectId: string; iid: string }): string {
  return `${ref.projectId}-${ref.iid}`
}

function matches(text: string, search: string): boolean {
  return !search.trim() || text.toLowerCase().includes(search.trim().toLowerCase())
}

function notFound(): never {
  throw { code: 'NOT_FOUND', message: '固定データにありません。' } satisfies GitLabErrorShape
}
