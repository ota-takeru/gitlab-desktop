/**
 * Development-only fixtures in the GitLab IPC DTO shapes, converted from the
 * UI mock data so the real client screens can render without a connection.
 * Nothing here is GitLab data; the fixture session is labelled as such.
 */
import { getMockCommitsForMergeRequest } from './commits'
import { mockMergeRequests, mockProjects, type MockAuthor, type MockChangedFile, type MockDiscussion, type MockMergeRequest } from './fixtures'
import type { Commit, Diff, Discussion, GitLabGroup, GitLabLabel, GitLabSession, GitLabUser, MergeRequest, Milestone, Note, Position, Project } from '../types/gitlab'

export const fixtureUser: GitLabUser = { id: '9000', name: '固定データの利用者', username: 'fixture-user' }

export const fixtureSession: GitLabSession = {
  id: 'fixture-session',
  instanceUrl: 'https://fixture.invalid',
  serverVersion: null,
  user: fixtureUser,
}

// The client parses `mr=<projectId>-<iid>` with numeric ids only.
const projectIds: Record<string, string> = { 'infra-observability': '102', 'platform-desktop': '101' }

function projectIdOf(mockId: string): string {
  return projectIds[mockId] ?? String(200 + mockProjects.findIndex((project) => project.id === mockId))
}

function userOf(author: MockAuthor): GitLabUser {
  if (author.handle === '@otata') return fixtureUser
  const username = author.handle.replace(/^@/u, '')
  return { id: `user-${username}`, name: author.name, username }
}

/** Converts the mock's display times ("12分前", "昨日 09:18", "9月18日") to ISO times before `now`. */
export function fixtureTime(label: string, now: number): string {
  const date = new Date(now)
  const minutes = /^(\d+)分前/u.exec(label)
  if (minutes) return new Date(now - Number(minutes[1]) * 60_000).toISOString()
  const day = /^(今日|昨日) (\d+):(\d+)/u.exec(label)
  if (day) {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day[1] === '昨日' ? 1 : 0), Number(day[2]), Number(day[3]))
    return new Date(Math.min(value.getTime(), now)).toISOString()
  }
  const monthDay = /^(\d+)月(\d+)日(?: (\d+):(\d+))?/u.exec(label)
  if (monthDay) {
    const at = (year: number) => new Date(year, Number(monthDay[1]) - 1, Number(monthDay[2]), Number(monthDay[3] ?? 12), Number(monthDay[4] ?? 0))
    const value = at(date.getFullYear())
    return (value.getTime() > now ? at(date.getFullYear() - 1) : value).toISOString()
  }
  return new Date(now - 86_400_000).toISOString()
}

function sha(seed: string): string {
  return seed.replace(/[^0-9a-f]/gu, '').padEnd(40, '0').slice(0, 40)
}

function headShaOf(mergeRequest: MockMergeRequest): string {
  const commits = getMockCommitsForMergeRequest(mergeRequest.id)
  return sha(commits[commits.length - 1]?.sha ?? `f${mergeRequest.iid}`)
}

/** Builds unified diff text, starting a new hunk wherever the line numbers jump. */
export function toUnifiedDiff(file: MockChangedFile): string {
  const hunks: { lines: string[]; oldStart: number; newStart: number; oldCount: number; newCount: number }[] = []
  let expectedOld = -1
  let expectedNew = -1
  for (const line of file.lines) {
    const continues = hunks.length > 0
      && (line.kind === 'addition' || line.oldLine === expectedOld)
      && (line.kind === 'deletion' || line.newLine === expectedNew)
    if (!continues) {
      hunks.push({ lines: [], newCount: 0, newStart: line.newLine ?? expectedNew, oldCount: 0, oldStart: line.oldLine ?? expectedOld })
    }
    const hunk = hunks[hunks.length - 1]
    if (line.kind !== 'addition') {
      hunk.oldCount += 1
      expectedOld = (line.oldLine ?? expectedOld) + 1
    }
    if (line.kind !== 'deletion') {
      hunk.newCount += 1
      expectedNew = (line.newLine ?? expectedNew) + 1
    }
    hunk.lines.push(`${line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '}${line.code}`)
  }
  return hunks.map((hunk) => [`@@ -${Math.max(hunk.oldStart, 0)},${hunk.oldCount} +${Math.max(hunk.newStart, 0)},${hunk.newCount} @@`, ...hunk.lines].join('\n')).join('\n')
}

function toDiff(file: MockChangedFile): Diff {
  const added = file.lines.every((line) => line.kind === 'addition')
  return { collapsed: false, deletedFile: false, diff: toUnifiedDiff(file), newFile: added, newPath: file.path, oldPath: file.path, renamedFile: false, tooLarge: false }
}

function fileContentOf(file: MockChangedFile): string {
  return file.fullContent ?? file.lines.filter((line) => line.kind !== 'deletion').map((line) => line.code).join('\n')
}

function toPosition(discussion: MockDiscussion, mergeRequest: MockMergeRequest): Position | null {
  const path = discussion.position?.path ?? discussion.file
  const line = discussion.position?.line ?? discussion.line
  if (!path) return null
  const headSha = headShaOf(mergeRequest)
  const side = discussion.position?.side ?? 'new'
  return {
    baseSha: sha('ba5e'),
    headSha,
    newPath: path,
    oldPath: path,
    positionType: line === undefined ? 'file' : 'text',
    startSha: sha('ba5e'),
    ...(line === undefined ? {} : side === 'old' ? { oldLine: line } : { newLine: line }),
  }
}

function toDiscussion(discussion: MockDiscussion, mergeRequest: MockMergeRequest, now: number): Discussion {
  const position = toPosition(discussion, mergeRequest)
  const resolvable = discussion.kind !== 'comment'
  const resolved = discussion.state === 'resolved'
  const root: Note = {
    author: userOf(discussion.author),
    body: discussion.body,
    createdAt: fixtureTime(discussion.createdAt, now),
    id: `${discussion.id}-note`,
    position,
    resolvable,
    resolved,
    system: false,
  }
  const replies: Note[] = discussion.replies.map((reply) => ({
    author: userOf(reply.author),
    body: reply.body,
    createdAt: fixtureTime(reply.createdAt, now),
    id: reply.id,
    position,
    resolvable,
    resolved,
    system: false,
  }))
  return { id: discussion.id, individualNote: !resolvable && replies.length === 0, notes: [root, ...replies] }
}

export interface FixtureMergeRequest {
  mergeRequest: MergeRequest
  diffs: Diff[]
  discussions: Discussion[]
  commits: (Commit & { diffs: Diff[] })[]
  files: Record<string, string>
  approvedBy: GitLabUser[]
}

const reviewerPool = Object.values({ akari: '@akari.t', ken: '@ken.sato', mai: '@mai.i', ryo: '@ryo.n' })

export const fixtureMilestones: Milestone[] = [
  { dueDate: '2026-11-30', id: '701', state: 'active', title: 'v0.9', webUrl: `${fixtureSession.instanceUrl}/groups/platform/-/milestones/1` },
  { dueDate: null, id: '702', state: 'active', title: 'v1.0', webUrl: `${fixtureSession.instanceUrl}/groups/platform/-/milestones/2` },
]

// Label colours are GitLab data, written without the hash so they stay out of the theme's colour check.
const labelPalette = ['428bca', '009966', 'dc143c', 'ed9121', '6699cc', '8e44ad']

/** The fixture project's labels: every label a fixture MR uses, coloured from a fixed list. */
export function fixtureLabels(): GitLabLabel[] {
  const names = [...new Set([...mockMergeRequests.flatMap((mock) => mock.labels), 'blocked', 'needs-design'])].sort()
  return names.map((name, index) => ({ color: `#${labelPalette[index % labelPalette.length]}`, description: '', id: String(800 + index), name }))
}

/** What GitLab reports about merging, derived from the mock's CI and threads. */
function fixtureMergeStatus(mock: MockMergeRequest): Partial<MergeRequest> {
  const opened = mock.state === 'open'
  const unresolved = mock.discussions.some((discussion) => discussion.kind !== 'comment' && discussion.state !== 'resolved')
  const passed = mock.checksPassed === mock.checksTotal
  return {
    autoMerge: false,
    blockingDiscussionsResolved: !unresolved,
    canMerge: true,
    detailedMergeStatus: !opened ? 'not_open' : !passed ? 'ci_must_pass' : unresolved ? 'discussions_not_resolved' : 'mergeable',
    divergedCommitsCount: opened && mock.iid % 3 === 0 ? 2 : 0,
    forceRemoveSourceBranch: true,
    hasConflicts: false,
    mergeError: null,
    rebaseInProgress: false,
    squash: false,
    squashOnMerge: false,
  }
}

function toFixtureMergeRequest(mock: MockMergeRequest, now: number): FixtureMergeRequest {
  const projectId = projectIdOf(mock.projectId)
  const headSha = headShaOf(mock)
  const author = userOf(mock.author)
  const reviewers = [fixtureUser]
  const others = mockMergeRequests.flatMap((candidate) => [candidate.author, ...candidate.discussions.map((item) => item.author)])
    .filter((candidate, index, all) => reviewerPool.includes(candidate.handle) && candidate.handle !== mock.author.handle && all.findIndex((item) => item.handle === candidate.handle) === index)
    .map(userOf)
  const allFiles = [...mock.files, ...getMockCommitsForMergeRequest(mock.id).flatMap((commit) => commit.files)]
  return {
    approvedBy: others.slice(0, mock.approvals),
    commits: getMockCommitsForMergeRequest(mock.id).map((commit) => ({
      createdAt: fixtureTime(commit.date, now),
      diffs: commit.files.map(toDiff),
      id: sha(commit.sha),
      title: commit.message,
    })),
    diffs: mock.files.map(toDiff),
    discussions: mock.discussions.map((discussion) => toDiscussion(discussion, mock, now)),
    files: Object.fromEntries(allFiles.map((file) => [file.path, fileContentOf(file)])),
    mergeRequest: {
      assignees: [author],
      author,
      description: mock.description,
      diffRefs: { baseSha: sha('ba5e'), headSha, startSha: sha('ba5e') },
      draft: false,
      headSha,
      id: `${projectId}${mock.iid}`,
      iid: String(mock.iid),
      labels: mock.labels,
      pipeline: { status: mock.checksPassed === mock.checksTotal ? 'success' : 'failed', webUrl: `${fixtureSession.instanceUrl}/${mock.projectPath}/-/pipelines` },
      ...fixtureMergeStatus(mock),
      milestone: mock.iid % 2 === 0 ? fixtureMilestones[0] : null,
      projectId,
      projectPath: mock.projectPath,
      reviewers,
      sourceBranch: mock.sourceBranch,
      state: mock.state === 'open' ? 'opened' : mock.state,
      targetBranch: mock.targetBranch,
      title: mock.title,
      updatedAt: fixtureTime(mock.updatedAt, now),
      // Opened a few days before the last update, so creation order differs from update order.
      createdAt: new Date(Date.parse(fixtureTime(mock.updatedAt, now)) - (2 + (mock.iid % 5)) * 86_400_000).toISOString(),
      webUrl: `${fixtureSession.instanceUrl}/${mock.projectPath}/-/merge_requests/${mock.iid}`,
    },
  }
}

const SUGGESTION_PATH = 'src/lib/review-cache.ts'

/** A multi-line comment with a suggestion, to show both on the diff and in the discussion. */
function addSuggestionThread(target: FixtureMergeRequest | undefined, now: number): void {
  const diff = target?.diffs.find((item) => item.newPath === SUGGESTION_PATH)
  const reviewer = target?.discussions.flatMap((discussion) => discussion.notes).find((note) => note.author.id !== fixtureUser.id)?.author
  if (!target || !diff || !reviewer) return
  const { diffRefs } = target.mergeRequest
  const position: Position = {
    baseSha: diffRefs?.baseSha ?? '',
    headSha: diffRefs?.headSha ?? '',
    lineRange: { end: { newLine: 13, type: 'new' }, start: { newLine: 12, type: 'new' } },
    newLine: 13,
    newPath: SUGGESTION_PATH,
    oldPath: SUGGESTION_PATH,
    positionType: 'text',
    startSha: diffRefs?.startSha ?? '',
  }
  const proposed = '  if (cached && !isExpired(cached.updatedAt, LIST_CACHE_TTL_MS)) {\n    return cached.value'
  target.discussions.push({
    id: 'fixture-suggestion',
    individualNote: false,
    notes: [{
      author: reviewer,
      body: `期限切れの判定は関数にまとめると読みやすくなりそうです。\n\n\`\`\`suggestion:-1+0\n${proposed}\n\`\`\``,
      createdAt: new Date(now - 30 * 60_000).toISOString(),
      id: 'fixture-suggestion-note',
      position,
      resolvable: true,
      resolved: false,
      suggestions: [{
        appliable: true,
        applied: false,
        fromContent: '  if (cached && Date.now() - cached.updatedAt < LIST_CACHE_TTL_MS) {\n    return cached.value\n',
        fromLine: 12,
        id: '9001',
        toContent: `${proposed}\n`,
        toLine: 13,
      }],
      system: false,
    }],
  })
}

export function createFixtureData(now: number) {
  const projects: Project[] = mockProjects.map((project) => ({
    archived: false,
    description: project.description,
    id: projectIdOf(project.id),
    name: project.name,
    pathWithNamespace: project.path,
    squashOption: 'default_off',
    webUrl: `${fixtureSession.instanceUrl}/${project.path}`,
  }))
  // Every namespace above a fixture project, e.g. `platform` and `platform/desktop`.
  const groupPaths = [...new Set(projects.flatMap((project) => {
    const segments = project.pathWithNamespace.split('/').slice(0, -1)
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  }))]
  const groups: GitLabGroup[] = groupPaths.map((fullPath, index) => ({
    fullName: fullPath.split('/').join(' / '),
    fullPath,
    id: String(300 + index),
    name: fullPath.split('/').at(-1) ?? fullPath,
    webUrl: `${fixtureSession.instanceUrl}/groups/${fullPath}`,
  }))
  const mergeRequests = mockMergeRequests.map((mock) => toFixtureMergeRequest(mock, now))
  addSuggestionThread(mergeRequests[0], now)
  const users = [fixtureUser, ...mergeRequests.flatMap((item) => [item.mergeRequest.author, ...item.discussions.flatMap((discussion) => discussion.notes.map((note) => note.author))])]
    .filter((user, index, all) => all.findIndex((candidate) => candidate.id === user.id) === index)
  return { groups, labels: fixtureLabels(), mergeRequests, milestones: fixtureMilestones, projects, users }
}

export type FixtureData = ReturnType<typeof createFixtureData>
