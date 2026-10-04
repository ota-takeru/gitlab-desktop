import {
  mockMergeRequests,
  type MockChangedFile,
  type MockMergeRequest,
} from './fixtures'
import { queryRunnerFinal, reviewCacheFinal, reviewCacheFirstCommit } from './fileContents'

export interface MockCommit {
  id: string
  sha: string
  parentSHA?: string
  message: string
  author: MockMergeRequest['author']
  date: string
  files: MockChangedFile[]
}

const cacheMergeRequest = mockMergeRequests[0]

const cacheIndexCommit: MockChangedFile = {
  path: 'src/lib/review-cache.ts',
  additions: 4,
  deletions: 2,
  fullContent: reviewCacheFirstCommit,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1, code: "import { invoke } from '@tauri-apps/api/core'" },
    { kind: 'context', oldLine: 2, newLine: 2, code: "import type { MergeRequest } from '../types/gitlab'" },
    { kind: 'context', oldLine: 3, newLine: 3, code: '' },
    { kind: 'deletion', oldLine: 4, code: 'const CACHE_TTL_MS = 5 * 60 * 1000' },
    { kind: 'addition', newLine: 4, code: 'const LIST_CACHE_TTL_MS = 60 * 1000' },
    { kind: 'addition', newLine: 5, code: 'const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000' },
    { kind: 'context', oldLine: 5, newLine: 6, code: '' },
    { kind: 'context', oldLine: 6, newLine: 7, code: 'export async function getMergeRequests(projectId: string) {' },
    { kind: 'deletion', oldLine: 7, code: "  return invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })" },
    { kind: 'addition', newLine: 8, code: '  const key = `mr-list:${projectId}`' },
    { kind: 'addition', newLine: 9, code: "  return readThroughCache(key, () => invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId }))" },
    { kind: 'context', oldLine: 8, newLine: 10, code: '}' },
  ],
}

const cacheRefreshCommit: MockChangedFile = {
  path: 'src/lib/review-cache.ts',
  additions: 7,
  deletions: 2,
  fullContent: reviewCacheFinal,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1, code: "import { invoke } from '@tauri-apps/api/core'" },
    { kind: 'context', oldLine: 2, newLine: 2, code: "import type { MergeRequest } from '../types/gitlab'" },
    { kind: 'context', oldLine: 3, newLine: 3, code: '' },
    { kind: 'context', oldLine: 4, newLine: 4, code: 'const LIST_CACHE_TTL_MS = 60 * 1000' },
    { kind: 'deletion', oldLine: 5, code: 'const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000' },
    { kind: 'addition', newLine: 5, code: 'const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000' },
    { kind: 'context', oldLine: 6, newLine: 6, code: '' },
    { kind: 'addition', newLine: 7, code: 'type CacheEntry<T> = { value: T; updatedAt: number }' },
    { kind: 'context', oldLine: 7, newLine: 9, code: 'export async function getMergeRequests(projectId: string) {' },
    { kind: 'context', oldLine: 8, newLine: 10, code: '  const key = `mr-list:${projectId}`' },
    { kind: 'deletion', oldLine: 9, code: "  return readThroughCache(key, () => invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId }))" },
    { kind: 'addition', newLine: 11, code: "  const cached = await invoke<CacheEntry<MergeRequest[]> | null>('cache_get', { key })" },
    { kind: 'addition', newLine: 12, code: '  if (cached && Date.now() - cached.updatedAt < LIST_CACHE_TTL_MS) {' },
    { kind: 'addition', newLine: 13, code: '    return cached.value' },
    { kind: 'addition', newLine: 14, code: '  }' },
  ],
}

const cacheQueryCommit: MockChangedFile = {
  path: 'src/search/query-runner.ts',
  additions: 6,
  deletions: 2,
  fullContent: queryRunnerFinal,
  lines: [
    { kind: 'context', oldLine: 18, newLine: 18, code: 'export async function runSearch(query: SearchQuery) {' },
    { kind: 'context', oldLine: 19, newLine: 19, code: '  const requestId = createRequestId()' },
    { kind: 'deletion', oldLine: 20, code: '  const response = await api.search(query)' },
    { kind: 'addition', newLine: 20, code: '  const controller = new AbortController()' },
    { kind: 'addition', newLine: 21, code: '  activeRequests.set(requestId, controller)' },
    { kind: 'addition', newLine: 22, code: '  const response = await api.search(prepareQuery(query), {' },
    { kind: 'addition', newLine: 23, code: '    signal: controller.signal,' },
    { kind: 'addition', newLine: 24, code: '  })' },
    { kind: 'context', oldLine: 21, newLine: 25, code: '  removeRequest(requestId)' },
    { kind: 'context', oldLine: 22, newLine: 26, code: '  return normalizeResults(response)' },
    { kind: 'addition', newLine: 27, code: '}' },
  ],
}

const commitsByMergeRequest: Record<string, MockCommit[]> = {
  [cacheMergeRequest.id]: [
    {
      id: `${cacheMergeRequest.id}:a3f91d2`,
      sha: 'a3f91d2',
      parentSHA: '7c10f64',
      message: '一覧と詳細のキャッシュ境界を分ける',
      author: cacheMergeRequest.author,
      date: '今日 08:42',
      files: [cacheIndexCommit],
    },
    {
      id: `${cacheMergeRequest.id}:b7c2e81`,
      sha: 'b7c2e81',
      parentSHA: 'a3f91d2',
      message: '更新中もキャッシュを表示して静かに再検証する',
      author: cacheMergeRequest.author,
      date: '今日 09:06',
      files: [cacheRefreshCommit, cacheQueryCommit],
    },
  ],
}

function fallbackCommit(mergeRequest: MockMergeRequest): MockCommit {
  return {
    id: `${mergeRequest.id}:head`,
    sha: `f${mergeRequest.iid.toString(16).padStart(6, '0')}`,
    parentSHA: `e${mergeRequest.iid.toString(16).padStart(6, '0')}`,
    message: mergeRequest.title,
    author: mergeRequest.author,
    date: mergeRequest.updatedAt,
    files: mergeRequest.files,
  }
}

export function getMockCommitsForMergeRequest(mergeRequestId: string) {
  const mergeRequest = mockMergeRequests.find((candidate) => candidate.id === mergeRequestId)
  if (!mergeRequest) return []
  return commitsByMergeRequest[mergeRequestId] ?? [fallbackCommit(mergeRequest)]
}
