/**
 * Development-only stand-in for the Rust IPC commands. It lets the real client
 * screens render in a browser with fixed data; nothing is sent to GitLab and
 * the session is labelled as fixture data.
 */
import { mockIPC } from '@tauri-apps/api/mocks'

import { createFixtureData, fixtureSession, fixtureUser, type FixtureMergeRequest } from './gitlabFixtures'
import { createPipelineFixtures } from './pipelineFixtures'
import type { AwardEmoji, Discussion, Draft, GitLabAction, GitLabErrorShape, GitLabQuery, GitLabSnapshot, Note, QueryData, TreeEntry } from '../types/gitlab'

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
  const pipelines = createPipelineFixtures()
  const drafts = new Map<string, Draft[]>()
  const localDrafts = new Map<string, { body: string; updatedAt: number }>()
  // Linked clones by project ID; the fixture never reads a real folder.
  const localRepositories = new Map<string, { path: string; projectPath: string }>()
  const localFiles: Record<string, string> = {
    'notes/todo.md': '# 手元のメモ\n未追跡のファイルです。\n',
    'src/config.ts': '// 固定データ: ローカルの作業ツリー\nexport const name = \'fixture\'\nexport const region = \'jp\'\nexport const debug = false\n\nexport const enabled = true\nexport const limit = 20\nexport const local = true\nexport const retries = 3\n',
  }
  // Reactions by `<projectId>-<iid>` (the MR) or `<projectId>-<iid>:<noteId>` (a comment).
  const awards = new Map<string, AwardEmoji[]>()
  const doneTodos = new Set<string>()
  const sample = data.mergeRequests[0]
  if (sample) {
    awards.set(keyOf(sample.mergeRequest), [{ name: 'thumbsup', user: data.users[0] ?? fixtureUser }, { name: 'tada', user: fixtureUser }])
    const firstNote = sample.discussions.flatMap((discussion) => discussion.notes).find((item) => !item.system)
    if (firstNote) awards.set(`${keyOf(sample.mergeRequest)}:${firstNote.id}`, [{ name: 'eyes', user: data.users[1] ?? fixtureUser }, { name: 'rocket', user: data.users[0] ?? fixtureUser }])
  }
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
      case 'get_local_repository': return localRepositories.get(String(payload.projectId)) ?? null
      case 'link_local_repository': {
        const linked = { path: String(payload.path).trim().replace(/^"|"$/gu, ''), projectPath: String(payload.projectPath) }
        localRepositories.set(String(payload.projectId), linked)
        return linked
      }
      case 'unlink_local_repository':
        localRepositories.delete(String(payload.projectId))
        return null
      case 'get_local_changes': {
        const linked = localRepositories.get(String(payload.projectId))
        if (!linked) throw { code: 'NOT_FOUND', message: 'このプロジェクトにはローカルリポジトリが紐付けられていません。' } satisfies GitLabErrorShape
        return {
          aheadCount: 1,
          branch: 'feature/local-fixture',
          comparedSha: String(payload.headSha),
          containsMrHead: true,
          diffs: [
            { collapsed: false, deletedFile: false, diff: '@@ -0,0 +1,2 @@\n+# 手元のメモ\n+未追跡のファイルです。\n', newFile: true, newPath: 'notes/todo.md', oldPath: 'notes/todo.md', renamedFile: false, tooLarge: false, untracked: true },
            { collapsed: false, deletedFile: false, diff: '@@ -6,3 +6,4 @@\n export const enabled = true\n-export const limit = 10\n+export const limit = 20\n+export const local = true\n export const retries = 3\n', newFile: false, newPath: 'src/config.ts', oldPath: 'src/config.ts', renamedFile: false, tooLarge: false },
          ],
          localHead: 'f'.repeat(40),
          repositoryPath: linked.path,
          truncated: false,
          untrackedCount: 1,
          untrackedIncluded: 1,
          untrackedMore: false,
        }
      }
      case 'get_local_file': {
        const content = localFiles[String(payload.path)]
        if (content === undefined) throw { code: 'NOT_FOUND', message: '作業ツリーにこのファイルがありません。' } satisfies GitLabErrorShape
        return { content }
      }
      case 'pick_local_repository_folder': return 'C:\\repos\\fixture-project'
      case 'check_app_update': return { configured: false, downloaded: false, notes: null, version: null }
      case 'download_app_update': return null
      case 'get_pending_operation':
      case 'get_gitlab_avatar': return null
      case 'plugin:notification|is_permission_granted': return false
      case 'plugin:notification|request_permission': return 'denied'
      case 'acknowledge_pending_operation':
      case 'cancel_gitlab_request':
      case 'clear_gitlab_cache':
      case 'disconnect_gitlab':
      case 'open_gitlab_url':
      case 'open_external_url':
      case 'open_token_creation_page':
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
      case 'groups': return data.groups.filter((group) => matches(`${group.name} ${group.fullPath}`, request.search))
      // A mention and a direct mention of one MR stack into one notification, a failed pipeline is another,
      // and a review request is left out of them.
      case 'todos': return [...data.mergeRequests.slice(0, 3).map(({ mergeRequest }, index) => ({ actionName: ['mentioned', 'build_failed', 'review_requested'][index], id: `todo-${mergeRequest.id}`, mergeRequest })), ...data.mergeRequests.slice(0, 1).map(({ mergeRequest }) => ({ actionName: 'directly_addressed', id: `todo-${mergeRequest.id}-2`, mergeRequest }))].filter(({ id }) => doneTodos.has(id) === Boolean(request.done)).map(({ actionName, id, mergeRequest }) => ({
        actionName,
        author: mergeRequest.author,
        body: mergeRequest.title,
        createdAt: mergeRequest.updatedAt,
        id,
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
      case 'mrs': return data.mergeRequests.map((item) => item.mergeRequest).sort((left, right) => Number(numberMatch(right.iid, request.search, request.projectId)) - Number(numberMatch(left.iid, request.search, request.projectId))).filter((mergeRequest) =>
        (request.state === 'all' || mergeRequest.state === request.state)
        && (!request.projectId || mergeRequest.projectId === request.projectId)
        && (!request.groupId || inGroup(mergeRequest.projectPath ?? '', request.groupId))
        && (!request.authorId || mergeRequest.author.id === request.authorId)
        && (!request.reviewerId || Boolean(mergeRequest.reviewers?.some((user) => user.id === request.reviewerId)))
        && (!request.assigneeId || Boolean(mergeRequest.assignees?.some((user) => user.id === request.assigneeId)))
        && (!request.labels?.length || request.labels.every((label) => mergeRequest.labels?.includes(label)))
        && (!request.sourceBranch || mergeRequest.sourceBranch === request.sourceBranch)
        && matchesMergeRequest(mergeRequest.iid, `${mergeRequest.title} ${mergeRequest.description}`, request.search, request.projectId))
      case 'mr': return find(request).mergeRequest
      case 'discussions': return find(request).discussions
      case 'notes': return find(request).discussions.flatMap((discussion) => discussion.notes)
      case 'commits': return find(request).commits.map(({ createdAt, id, title }) => ({ createdAt, committedAt: createdAt, id, title }))
      case 'drafts': return drafts.get(keyOf(request)) ?? []
      case 'diffs': return find(request).diffs
      case 'commitDiff': return find(request).commits.find((commit) => commit.id === request.sha)?.diffs ?? notFound()
      case 'blame': {
        const file = projectFiles(request.projectId)[request.path]
        if (file === undefined) return notFound()
        const lines = file.split('\n').slice(request.startLine - 1, request.endLine)
        return lines.length ? [{ authorName: 'Fixture User', commitId: request.sha, committedAt: new Date().toISOString(), lines, title: 'Fixture commit' }] : []
      }
      case 'commitMergeRequests': return data.mergeRequests.map(({ mergeRequest }) => mergeRequest)
        .filter((mr) => mr.projectId === request.projectId && mr.headSha === request.sha)
        .map((mr) => ({ iid: mr.iid, projectId: mr.projectId, state: mr.state, title: mr.title, webUrl: mr.webUrl }))
      case 'file': {
        const content = data.mergeRequests.find((item) => item.mergeRequest.projectId === request.projectId && request.path in item.files)?.files[request.path]
        return content === undefined ? notFound() : { content }
      }
      case 'tree': {
        // The project's repository is the files its fixture MRs touch.
        const prefix = request.path ? `${request.path}/` : ''
        const entries = new Map<string, TreeEntry>()
        for (const path of Object.keys(projectFiles(request.projectId))) {
          if (!path.startsWith(prefix)) continue
          const [name, ...rest] = path.slice(prefix.length).split('/')
          const entryPath = `${prefix}${name}`
          entries.set(entryPath, rest.length ? { id: blobId(`${entryPath}/`), name, path: entryPath, type: 'tree' } : { id: blobId(entryPath), name, path: entryPath, type: 'blob' })
        }
        return entries.size || !request.path ? [...entries.values()] : notFound()
      }
      case 'blob': {
        const entry = Object.entries(projectFiles(request.projectId)).find(([path]) => blobId(path) === request.sha)
        return entry ? { content: entry[1] } : notFound()
      }
      case 'approvals': {
        const { approvedBy } = find(request)
        return { approved: approvedBy.length > 0, approvedBy }
      }
      case 'mrApprovals': return request.items.map((item) => ({
        ...item,
        approvedBy: data.mergeRequests.find(({ mergeRequest }) => mergeRequest.projectPath === item.projectPath && mergeRequest.iid === item.iid)?.approvedBy.map((user) => user.id) ?? null,
      })) as unknown as QueryData
      case 'mrAwards': return awards.get(keyOf(find(request).mergeRequest)) ?? []
      case 'noteAwards': {
        const target = data.mergeRequests.find(({ mergeRequest }) => mergeRequest.projectPath === request.projectPath && mergeRequest.iid === request.iid) ?? notFound()
        return notesOf(target).filter((item) => !item.system).map((item) => ({ awards: awards.get(`${keyOf(target.mergeRequest)}:${item.id}`) ?? [], noteId: item.id }))
      }
      case 'mrPipelines': return pipelines.pipelinesOf(find(request).mergeRequest).map((item) => ({ ...item.pipeline }))
      case 'pipeline': return { ...pipelines.pipeline(request.pipelineId).pipeline }
      case 'pipelineJobs': return pipelines.pipeline(request.pipelineId).jobs.map((job) => ({ ...job }))
      case 'jobTrace': return pipelines.trace(request.jobId)
      case 'labels': return data.labels.filter((label) => matches(label.name, request.search))
      case 'milestones': return data.milestones.filter((milestone) => matches(milestone.title, request.search))
      // Each fixture commit stands for one push, newest first.
      case 'mrVersions': {
        const target = find(request)
        return target.commits.map((commit, index) => ({
          baseCommitSha: target.mergeRequest.diffRefs?.baseSha ?? '',
          createdAt: commit.createdAt,
          headCommitSha: commit.id,
          id: String(1000 + index),
          realSize: String(commit.diffs.length),
          startCommitSha: target.mergeRequest.diffRefs?.startSha ?? '',
          state: 'collected',
        })).reverse()
      }
      // The files changed by the commits after the chosen version, the latest change of each.
      case 'versionCompare': {
        const { commits } = find(request)
        const from = commits.findIndex((commit) => commit.id === request.fromSha)
        if (from < 0) return notFound()
        const byPath = new Map(commits.slice(from + 1).flatMap((commit) => commit.diffs).map((diff) => [diff.newPath, diff]))
        return [...byPath.values()]
      }
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
      case 'addAward':
      case 'removeAward': {
        const key = action.noteId ? `${keyOf(action)}:${action.noteId}` : keyOf(action)
        const others = (awards.get(key) ?? []).filter((award) => !(award.name === action.name && award.user.id === fixtureUser.id))
        awards.set(key, action.kind === 'addAward' ? [...others, { name: action.name, user: fixtureUser }] : others)
        break
      }
      case 'markTodoDone':
        doneTodos.add(action.todoId)
        break
      case 'retryJob':
      case 'cancelJob':
      case 'playJob':
      case 'retryPipeline':
      case 'cancelPipeline':
        pipelines.mutate(action)
        break
      // Merge operations change only the fixture's own copy, the way GitLab would answer.
      case 'merge':
        if (target.mergeRequest.headSha !== action.sha) stale()
        target.mergeRequest = action.autoMerge
          ? { ...target.mergeRequest, autoMerge: true }
          : { ...target.mergeRequest, detailedMergeStatus: 'not_open', state: 'merged' }
        break
      case 'cancelAutoMerge':
        target.mergeRequest = { ...target.mergeRequest, autoMerge: false }
        break
      case 'rebase':
        if (target.mergeRequest.headSha !== action.sha) stale()
        target.mergeRequest = { ...target.mergeRequest, detailedMergeStatus: target.mergeRequest.detailedMergeStatus === 'need_rebase' ? 'mergeable' : target.mergeRequest.detailedMergeStatus, divergedCommitsCount: 0 }
        break
      case 'setState':
        if (target.mergeRequest.state !== (action.stateEvent === 'close' ? 'opened' : 'closed')) stale()
        target.mergeRequest = { ...target.mergeRequest, detailedMergeStatus: action.stateEvent === 'close' ? 'not_open' : 'mergeable', state: action.stateEvent === 'close' ? 'closed' : 'opened' }
        break
      case 'setTitle':
        if (target.mergeRequest.title !== action.expectedTitle) stale()
        target.mergeRequest = { ...target.mergeRequest, draft: /^\s*(?:\[draft\]|\(draft\)|draft:)/iu.test(action.title), title: action.title }
        break
      case 'setLabels':
        target.mergeRequest = { ...target.mergeRequest, labels: [...(target.mergeRequest.labels ?? []).filter((label) => !action.removeLabels.includes(label)), ...action.addLabels.filter((label) => !target.mergeRequest.labels?.includes(label))] }
        break
      case 'setMilestone':
        if ((target.mergeRequest.milestone?.id ?? null) !== action.expectedMilestoneId) stale()
        target.mergeRequest = { ...target.mergeRequest, milestone: data.milestones.find((milestone) => milestone.id === action.milestoneId) ?? null }
        break
      case 'requestChanges':
      case 'rerequestReview':
        break
      case 'applySuggestions':
        if (target.mergeRequest.headSha !== action.headSha) throw { code: 'INVALID_INPUT', message: 'MRが更新されています。再読み込みしてから再試行してください。' } satisfies GitLabErrorShape
        for (const item of notesOf(target)) {
          for (const suggestion of item.suggestions ?? []) if (action.suggestionIds.includes(suggestion.id)) Object.assign(suggestion, { appliable: false, applied: true })
        }
        break
    }
    return null
  }

  function stale(): never {
    throw { code: 'INVALID_INPUT', message: 'MRが更新されています。再読み込みしてから再試行してください。' } satisfies GitLabErrorShape
  }

  // GitLab accepts a group's ID or its path; the fixture resolves either.
  function inGroup(projectPath: string, groupId: string): boolean {
    const path = data.groups.find((group) => group.id === groupId)?.fullPath ?? groupId
    return projectPath.startsWith(`${path}/`)
  }

  function projectFiles(projectId: string): Record<string, string> {
    return Object.assign({}, ...data.mergeRequests.filter(({ mergeRequest }) => mergeRequest.projectId === projectId).map((item) => item.files))
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

// Mirrors the Rust client: within a project, `!123` names the MR alone, while
// `123` leads with that MR and also matches text. Elsewhere a number is text.
function matchesMergeRequest(iid: string, text: string, search: string, projectId: string | undefined): boolean {
  if (projectId && /^!\d+$/.test(search.trim())) return numberMatch(iid, search, projectId)
  return numberMatch(iid, search, projectId) || matches(text, search)
}

function numberMatch(iid: string, search: string, projectId: string | undefined): boolean {
  return Boolean(projectId) && /^!?\d+$/.test(search.trim()) && iid === search.trim().replace(/^!/, '')
}

/** A stable 40-digit id per path, standing in for GitLab's blob ids. */
function blobId(path: string): string {
  let hash = 0x811c9dc5
  for (const char of path) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0').repeat(5)
}

function notFound(): never {
  throw { code: 'NOT_FOUND', message: '固定データにありません。' } satisfies GitLabErrorShape
}
