import type { BlameBlock, Diff } from '../types/gitlab'
import { reviewCacheFinal, reviewCacheFirstCommit } from './fileContents'

/**
 * A small, consistent repository history behind the fixture's Blame and commit diffs,
 * so following lines back through commits can be tried offline. Blame and diffs are
 * computed from whole file contents, as Git would give them.
 */
interface FixtureRevision {
  sha: string
  parentIds: string[]
  title: string
  authorName: string
  committedAt: string
  /** The file's whole content at this revision. */
  content: string
}

const REVIEW_CACHE_PATH = 'src/lib/review-cache.ts'
/** Files the fixture has no history for were all added by this commit. */
const ADDED_SHA = hex('ad0001')

function hex(seed: string): string {
  return seed.padEnd(40, '0')
}

const reviewCacheHistory: FixtureRevision[] = [
  {
    authorName: '佐藤 健',
    committedAt: '2026-07-14T10:12:00+09:00',
    content: `import { invoke } from '@tauri-apps/api/core'
import type { MergeRequest } from '../types/gitlab'

export async function getMergeRequests(projectId: string) {
  return invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })
}`,
    parentIds: [],
    sha: hex('c1a001'),
    title: 'MR一覧の取得を追加',
  },
  {
    authorName: '高橋 明里',
    committedAt: '2026-08-05T16:40:00+09:00',
    content: `import { invoke } from '@tauri-apps/api/core'
import type { MergeRequest } from '../types/gitlab'

const CACHE_TTL_MS = 10 * 60 * 1000

export async function getMergeRequests(projectId: string) {
  return invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })
}

export async function getMergeRequest(projectId: string, iid: number) {
  const key = \`mr-detail:\${projectId}:\${iid}\`
  return readThroughCache(key, () => invoke<MergeRequest>('gitlab_get_merge_request', { projectId, iid }))
}

async function readThroughCache<T>(key: string, fetcher: () => Promise<T>) {
  const cached = await invoke<T>('cache_get', { key })
  return cached ?? fetcher()
}`,
    parentIds: [hex('c1a001')],
    sha: hex('c2b002'),
    title: 'MR詳細をキャッシュ経由で取得する',
  },
  {
    authorName: '伊藤 舞',
    committedAt: '2026-09-02T11:05:00+09:00',
    content: `import { invoke } from '@tauri-apps/api/core'
import type { MergeRequest } from '../types/gitlab'

const CACHE_TTL_MS = 5 * 60 * 1000

export async function getMergeRequests(projectId: string) {
  return invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })
}

export async function getMergeRequest(projectId: string, iid: number) {
  const key = \`mr-detail:\${projectId}:\${iid}\`
  return readThroughCache(key, () => invoke<MergeRequest>('gitlab_get_merge_request', { projectId, iid }))
}

async function readThroughCache<T>(key: string, fetcher: () => Promise<T>) {
  const cached = await invoke<T | null>('cache_get', { key })
  return cached ?? fetcher()
}`,
    parentIds: [hex('c2b002')],
    // The fixture MRs' base commit.
    sha: hex('ba5e'),
    title: 'キャッシュの有効期限を5分に短縮し、未保存をnullで返す',
  },
  {
    authorName: '高橋 明里',
    committedAt: '2026-10-30T08:42:00+09:00',
    content: reviewCacheFirstCommit,
    parentIds: [hex('ba5e')],
    sha: hex('a3f91d2'),
    title: '一覧と詳細のキャッシュ境界を分ける',
  },
  {
    authorName: '高橋 明里',
    committedAt: '2026-10-30T09:06:00+09:00',
    content: reviewCacheFinal,
    parentIds: [hex('a3f91d2')],
    sha: hex('b7c2e81'),
    title: '更新中もキャッシュを表示して静かに再検証する',
  },
]

/** Commits whose diff the fixture MRs already give; their own diffs are kept. */
const MR_COMMITS = new Set([hex('a3f91d2'), hex('b7c2e81')])

/** Blame of `path` at `sha`, or null when the fixture has no history for it. */
export function fixtureBlame(path: string, sha: string, startLine: number, endLine: number, currentContent: string | undefined): BlameBlock[] | null {
  const history = path === REVIEW_CACHE_PATH ? reviewCacheHistory : null
  const upTo = history?.findIndex((revision) => revision.sha === sha) ?? -1
  if (!history || upTo < 0) {
    if (currentContent === undefined) return null
    const added: FixtureRevision = { authorName: '中村 涼', committedAt: '2026-06-01T09:00:00+09:00', content: currentContent, parentIds: [], sha: ADDED_SHA, title: 'リポジトリの初期ファイルを追加' }
    return blameBlocks([added], startLine, endLine)
  }
  return blameBlocks(history.slice(0, upTo + 1), startLine, endLine)
}

/** The diffs of a commit only the fixture history knows, or null for any other commit. */
export function fixtureCommitDiff(sha: string, files: Record<string, string>): Diff[] | null {
  if (sha === ADDED_SHA) {
    return Object.entries(files).filter(([path]) => path !== REVIEW_CACHE_PATH).map(([path, content]) => fileDiff(path, '', content, true))
  }
  if (MR_COMMITS.has(sha)) return null
  const index = reviewCacheHistory.findIndex((revision) => revision.sha === sha)
  if (index < 0) return null
  const before = index > 0 ? reviewCacheHistory[index - 1].content : ''
  return [fileDiff(REVIEW_CACHE_PATH, before, reviewCacheHistory[index].content, index === 0)]
}

function blameBlocks(history: FixtureRevision[], startLine: number, endLine: number): BlameBlock[] {
  let owners: FixtureRevision[] = []
  let lines: string[] = []
  for (const revision of history) {
    const next = revision.content.split('\n')
    const kept = new Map<number, number>()
    for (const [oldIndex, newIndex] of commonLines(lines, next)) kept.set(newIndex, oldIndex)
    owners = next.map((_, index) => kept.has(index) ? owners[kept.get(index)!] : revision)
    lines = next
  }
  const blocks: BlameBlock[] = []
  for (let index = startLine - 1; index < Math.min(endLine, lines.length); index += 1) {
    const owner = owners[index]
    const last = blocks.at(-1)
    if (last && last.commitId === owner.sha) last.lines.push(lines[index])
    else blocks.push({ authorName: owner.authorName, commitId: owner.sha, committedAt: owner.committedAt, lines: [lines[index]], parentIds: owner.parentIds, title: owner.title })
  }
  return blocks
}

/** Index pairs of the lines both versions keep, by longest common subsequence. */
function commonLines(before: string[], after: string[]): [number, number][] {
  const lengths = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) pairs.push([i++, j++])
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i += 1
    else j += 1
  }
  return pairs
}

function fileDiff(path: string, before: string, after: string, newFile: boolean): Diff {
  return { collapsed: false, deletedFile: false, diff: unifiedDiff(before ? before.split('\n') : [], after.split('\n')), newFile, newPath: path, oldPath: path, renamedFile: false, tooLarge: false }
}

const CONTEXT = 3

function unifiedDiff(before: string[], after: string[]): string {
  // Every line in order: ' ' kept, '-' removed, '+' added, with its line numbers.
  const rows: { kind: ' ' | '-' | '+'; text: string; oldLine: number; newLine: number }[] = []
  let i = 0
  let j = 0
  for (const [oldIndex, newIndex] of [...commonLines(before, after), [before.length, after.length] as [number, number]]) {
    while (i < oldIndex) rows.push({ kind: '-', newLine: j + 1, oldLine: i + 1, text: before[i++] })
    while (j < newIndex) rows.push({ kind: '+', newLine: j + 1, oldLine: i + 1, text: after[j++] })
    if (i < before.length && j < after.length) rows.push({ kind: ' ', newLine: ++j, oldLine: ++i, text: before[i - 1] })
  }
  const changed = rows.flatMap((row, index) => row.kind === ' ' ? [] : [index])
  const hunks: string[] = []
  let at = 0
  while (at < changed.length) {
    const from = Math.max(0, changed[at] - CONTEXT)
    let end = changed[at]
    while (at + 1 < changed.length && changed[at + 1] - end <= CONTEXT * 2) end = changed[++at]
    at += 1
    const part = rows.slice(from, Math.min(rows.length, end + CONTEXT + 1))
    const oldCount = part.filter((row) => row.kind !== '+').length
    const newCount = part.filter((row) => row.kind !== '-').length
    const oldStart = oldCount ? part.find((row) => row.kind !== '+')!.oldLine : part[0].oldLine - 1
    const newStart = newCount ? part.find((row) => row.kind !== '-')!.newLine : part[0].newLine - 1
    hunks.push([`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...part.map((row) => `${row.kind}${row.text}`)].join('\n'))
  }
  return hunks.join('\n')
}
