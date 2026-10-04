export type MockMrState = 'open' | 'merged' | 'closed'
export type MockReviewState = 'needs-review' | 'changes-requested' | 'approved'
export type MockDiscussionState = 'open' | 'resolved'
export type MockLineKind = 'context' | 'addition' | 'deletion'

import {
  credentials,
  httpRateLimit,
  queryRunnerFinal,
  readState,
  reviewCacheFinal,
  reviewSearchMigration,
  reviewShortcutHint,
  virtualDiff,
} from './fileContents'
import type { MockCommentPosition } from './reviewTypes'

export interface MockAuthor {
  name: string
  handle: string
  initials: string
}

export interface MockDiffLine {
  kind: MockLineKind
  oldLine?: number
  newLine?: number
  code: string
}

export interface MockChangedFile {
  path: string
  additions: number
  deletions: number
  lines: MockDiffLine[]
  /** Complete post-change source at the selected MR/commit version, when fetched. */
  fullContent?: string
}

export interface MockReply {
  id: string
  author: MockAuthor
  body: string
  createdAt: string
  edited?: boolean
}

export interface MockDiscussion {
  id: string
  author: MockAuthor
  body: string
  createdAt: string
  file?: string
  line?: number
  state: MockDiscussionState
  replies: MockReply[]
  kind?: 'comment' | 'thread'
  position?: MockCommentPosition
  edited?: boolean
  deleted?: boolean
}

export interface MockMergeRequest {
  id: string
  iid: number
  projectId: string
  projectName: string
  projectPath: string
  title: string
  description: string
  author: MockAuthor
  updatedAt: string
  state: MockMrState
  reviewState: MockReviewState
  labels: string[]
  sourceBranch: string
  targetBranch: string
  checksPassed: number
  checksTotal: number
  approvals: number
  requiredApprovals: number
  files: MockChangedFile[]
  discussions: MockDiscussion[]
}

export interface MockProject {
  id: string
  name: string
  path: string
  description: string
  activity: string
  favorite: boolean
  openMrCount: number
}

const authors = {
  akari: { name: '高橋 明里', handle: '@akari.t', initials: 'AT' },
  ken: { name: '佐藤 健', handle: '@ken.sato', initials: 'KS' },
  mai: { name: '伊藤 舞', handle: '@mai.i', initials: 'MI' },
  ryo: { name: '中村 涼', handle: '@ryo.n', initials: 'RN' },
  user: { name: '自分', handle: '@otata', initials: 'OT' },
} satisfies Record<string, MockAuthor>

const cacheDiff: MockChangedFile = {
  path: 'src/lib/review-cache.ts',
  additions: 18,
  deletions: 6,
  fullContent: reviewCacheFinal,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1, code: "import { invoke } from '@tauri-apps/api/core'" },
    { kind: 'context', oldLine: 2, newLine: 2, code: "import type { MergeRequest } from '../types/gitlab'" },
    { kind: 'context', oldLine: 3, newLine: 3, code: '' },
    { kind: 'deletion', oldLine: 4, code: 'const CACHE_TTL_MS = 5 * 60 * 1000' },
    { kind: 'addition', newLine: 4, code: 'const LIST_CACHE_TTL_MS = 60 * 1000' },
    { kind: 'addition', newLine: 5, code: 'const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000' },
    { kind: 'context', oldLine: 5, newLine: 6, code: '' },
    { kind: 'addition', newLine: 7, code: 'type CacheEntry<T> = { value: T; updatedAt: number }' },
    { kind: 'addition', newLine: 8, code: '' },
    { kind: 'addition', newLine: 9, code: 'export async function getMergeRequests(projectId: string) {' },
    { kind: 'deletion', oldLine: 6, code: 'export async function getMergeRequests(projectId: string) {' },
    { kind: 'deletion', oldLine: 7, code: "  return invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })" },
    { kind: 'addition', newLine: 10, code: '  const key = `mr-list:${projectId}`' },
    { kind: 'addition', newLine: 11, code: "  const cached = await invoke<CacheEntry<MergeRequest[]> | null>('cache_get', { key })" },
    { kind: 'addition', newLine: 12, code: '  if (cached && Date.now() - cached.updatedAt < LIST_CACHE_TTL_MS) {' },
    { kind: 'addition', newLine: 13, code: '    return cached.value' },
    { kind: 'addition', newLine: 14, code: '  }' },
    { kind: 'addition', newLine: 15, code: "  const value = await invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })" },
    { kind: 'addition', newLine: 16, code: "  await invoke('cache_set', { key, value, ttlMs: LIST_CACHE_TTL_MS })" },
    { kind: 'addition', newLine: 17, code: '  return value' },
    { kind: 'addition', newLine: 18, code: '}' },
  ],
}

const cancellationDiff: MockChangedFile = {
  path: 'src/search/query-runner.ts',
  additions: 15,
  deletions: 8,
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
    { kind: 'addition', newLine: 28, code: '' },
    { kind: 'addition', newLine: 29, code: 'export function cancelSearch(requestId: string) {' },
    { kind: 'addition', newLine: 30, code: '  activeRequests.get(requestId)?.abort()' },
    { kind: 'addition', newLine: 31, code: '  removeRequest(requestId)' },
  ],
}

const secureStoreDiff: MockChangedFile = {
  path: 'src-tauri/src/credentials.rs',
  additions: 11,
  deletions: 4,
  fullContent: credentials,
  lines: [
    { kind: 'context', oldLine: 8, newLine: 8, code: 'pub struct CredentialStore {' },
    { kind: 'context', oldLine: 9, newLine: 9, code: '    service: String,' },
    { kind: 'deletion', oldLine: 10, code: '    token: String,' },
    { kind: 'addition', newLine: 10, code: '    account_key: String,' },
    { kind: 'context', oldLine: 11, newLine: 11, code: '}' },
    { kind: 'context', oldLine: 12, newLine: 12, code: '' },
    { kind: 'addition', newLine: 13, code: 'impl CredentialStore {' },
    { kind: 'addition', newLine: 14, code: '    pub fn save(&self, token: SecretString) -> Result<()> {' },
    { kind: 'addition', newLine: 15, code: '        Entry::new(&self.service, &self.account_key)?' },
    { kind: 'addition', newLine: 16, code: '            .set_password(token.expose_secret())?;' },
    { kind: 'addition', newLine: 17, code: '        Ok(())' },
    { kind: 'addition', newLine: 18, code: '    }' },
  ],
}

const timeoutDiff: MockChangedFile = {
  path: 'src-tauri/src/gitlab/http.rs',
  additions: 9,
  deletions: 7,
  fullContent: httpRateLimit,
  lines: [
    { kind: 'context', oldLine: 32, newLine: 15, code: '    let response = client.execute(request).await?;' },
    { kind: 'deletion', oldLine: 33, code: '    if response.status().is_server_error() {' },
    { kind: 'deletion', oldLine: 34, code: '        retry(request).await?;' },
    { kind: 'addition', newLine: 16, code: '    if response.status().as_u16() == 429 {' },
    { kind: 'addition', newLine: 17, code: '        let retry_after = parse_retry_after(&response)?;' },
    { kind: 'addition', newLine: 18, code: '        cooldowns.pause(connection, retry_after);' },
    { kind: 'addition', newLine: 19, code: '        return Err(Error::RateLimited);' },
    { kind: 'addition', newLine: 20, code: '    }' },
    { kind: 'context', oldLine: 35, newLine: 21, code: '    response.error_for_status().map_err(Error::from)' },
  ],
}

const keyboardDiff: MockChangedFile = {
  path: 'src/components/ReviewShortcutHint.tsx',
  additions: 12,
  deletions: 3,
  fullContent: reviewShortcutHint,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1, code: "import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined'" },
    { kind: 'context', oldLine: 2, newLine: 2, code: '' },
    { kind: 'addition', newLine: 3, code: 'export function ReviewShortcutHint() {' },
    { kind: 'addition', newLine: 4, code: '  return (' },
    { kind: 'addition', newLine: 5, code: '    <span aria-label="レビューショートカット">' },
    { kind: 'addition', newLine: 6, code: '      <KeyboardOutlinedIcon fontSize="small" />' },
    { kind: 'addition', newLine: 7, code: '      j / k で議論を移動' },
    { kind: 'addition', newLine: 8, code: '    </span>' },
    { kind: 'addition', newLine: 9, code: '  )' },
    { kind: 'addition', newLine: 10, code: '}' },
  ],
}

const virtualDiffFile: MockChangedFile = {
  path: 'src/components/VirtualDiff.tsx',
  additions: 24,
  deletions: 9,
  fullContent: virtualDiff,
  lines: [
    { kind: 'context', oldLine: 11, newLine: 11, code: 'export function VirtualDiff({ rows, onLineComment }: VirtualDiffProps) {' },
    { kind: 'context', oldLine: 12, newLine: 12, code: '  const container = useDiffContainer()' },
    { kind: 'deletion', oldLine: 13, code: '  return rows.map((row) => <DiffRowView row={row} />)' },
    { kind: 'addition', newLine: 13, code: '  const virtualizer = useVirtualizer({' },
    { kind: 'addition', newLine: 14, code: '    count: rows.length,' },
    { kind: 'addition', newLine: 15, code: '    getScrollElement: () => container.current,' },
    { kind: 'addition', newLine: 16, code: '    estimateSize: () => 26,' },
    { kind: 'addition', newLine: 17, code: '    overscan: 12,' },
    { kind: 'addition', newLine: 18, code: '  })' },
    { kind: 'context', oldLine: 14, newLine: 20, code: '  return (' },
  ],
}

const readStateDiff: MockChangedFile = {
  path: 'src/notifications/useReadState.ts',
  additions: 6,
  deletions: 4,
  fullContent: readState,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1, code: "import { useCallback, useEffect, useState } from 'react'" },
    { kind: 'context', oldLine: 2, newLine: 2, code: "import type { Notification } from '../types/notifications'" },
    { kind: 'addition', newLine: 3, code: "import { notificationApi } from '../lib/notificationApi'" },
    { kind: 'addition', newLine: 5, code: 'export function useReadState(notification: Notification) {' },
    { kind: 'addition', newLine: 6, code: '  const [isRead, setIsRead] = useState(notification.read)' },
    { kind: 'addition', newLine: 8, code: '  useEffect(() => {' },
    { kind: 'addition', newLine: 9, code: '    setIsRead(notification.read)' },
    { kind: 'addition', newLine: 10, code: '  }, [notification.id, notification.read])' },
    { kind: 'addition', newLine: 18, code: '  return { isRead, markRead }' },
  ],
}

const projectMigrationsDiff: MockChangedFile = {
  path: 'migrations/2026_09_add_review_index.sql',
  additions: 7,
  deletions: 0,
  fullContent: reviewSearchMigration,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1, code: '-- local cache index for review lookups' },
    { kind: 'addition', newLine: 2, code: 'CREATE INDEX IF NOT EXISTS idx_notes_mr_updated' },
    { kind: 'addition', newLine: 3, code: '  ON notes (merge_request_id, updated_at DESC);' },
    { kind: 'addition', newLine: 4, code: '' },
    { kind: 'addition', newLine: 5, code: 'CREATE INDEX IF NOT EXISTS idx_files_path' },
    { kind: 'addition', newLine: 6, code: '  ON changed_files (merge_request_id, path);' },
  ],
}

const discussionSet = {
  cache: [
    {
      id: 'cache-d1',
      author: authors.ken,
      body: '一覧キャッシュの期限が切れたあとも、古い結果を一瞬だけ見せる想定でしょうか？',
      createdAt: '今日 09:14',
      file: 'src/lib/review-cache.ts',
      line: 13,
      state: 'open' as const,
      replies: [
        { id: 'cache-r1', author: authors.akari, body: 'はい。更新中の表示を残し、取得できた時点で差し替えます。', createdAt: '今日 09:32' },
      ],
    },
    {
      id: 'cache-d2',
      author: authors.mai,
      body: 'キーにインスタンスとアカウントを含めていることをテストで固定したいです。',
      createdAt: '昨日 17:48',
      file: 'src/lib/review-cache.ts',
      line: 9,
      state: 'resolved' as const,
      replies: [],
    },
    {
      id: 'cache-d3',
      author: authors.ryo,
      body: '検索条件が変わったときに、前のリクエストが遅れて結果を上書きしないか確認してください。',
      createdAt: '昨日 16:20',
      file: 'src/search/query-runner.ts',
      line: 20,
      state: 'open' as const,
      replies: [],
    },
  ],
  cancellation: [
    {
      id: 'cancel-d1',
      author: authors.mai,
      body: '表示範囲だけを描画する場合も、行コメントの入力状態を失わないようにしたいです。',
      createdAt: '9月29日 14:05',
      file: 'src/components/VirtualDiff.tsx',
      line: 17,
      state: 'open' as const,
      replies: [],
    },
  ],
  secure: [
    {
      id: 'secure-d1',
      author: authors.ken,
      body: 'サービス名とアカウントキーの組み合わせは、複数インスタンスで衝突しない形にしましょう。',
      createdAt: '9月28日 11:12',
      file: 'src-tauri/src/credentials.rs',
      line: 14,
      state: 'resolved' as const,
      replies: [],
    },
  ],
  timeout: [
    {
      id: 'timeout-d1',
      author: authors.akari,
      body: '429の待機時間は接続ごとに持つ方針でよさそうです。UIには残り時間を出しますか？',
      createdAt: '9月27日 16:42',
      file: 'src-tauri/src/gitlab/http.rs',
      line: 17,
      state: 'resolved' as const,
      replies: [],
    },
  ],
  keyboard: [],
  migration: [],
} satisfies Record<string, MockDiscussion[]>

export const mockProjects: MockProject[] = [
  {
    id: 'platform-desktop',
    name: 'Desktop Client',
    path: 'platform/desktop-client',
    description: '社内GitLabのレビューを軽く扱うWindowsクライアント',
    activity: '12分前に更新',
    favorite: true,
    openMrCount: 3,
  },
  {
    id: 'infra-observability',
    name: 'Observability',
    path: 'infra/observability',
    description: '社内サービスのログとメトリクスを扱う基盤',
    activity: '昨日 18:40に更新',
    favorite: true,
    openMrCount: 1,
  },
  {
    id: 'web-portal',
    name: 'Employee Portal',
    path: 'web/employee-portal',
    description: '社内ポータルのUIと検索体験',
    activity: '9月25日に更新',
    favorite: false,
    openMrCount: 2,
  },
  {
    id: 'data-catalog',
    name: 'Data Catalog',
    path: 'data/catalog',
    description: 'データセットの説明と利用状況を管理するサービス',
    activity: '9月22日に更新',
    favorite: false,
    openMrCount: 1,
  },
]

export const mockMergeRequests: MockMergeRequest[] = [
  {
    id: 'platform-desktop!42',
    iid: 42,
    projectId: 'platform-desktop',
    projectName: 'Desktop Client',
    projectPath: 'platform/desktop-client',
    title: 'MR一覧の検索結果をSQLiteキャッシュから再利用する',
    description: '一覧の切り替えで毎回ネットワークを待たず、取得済みの結果を先に表示してから静かに更新します。',
    author: authors.akari,
    updatedAt: '12分前',
    state: 'open',
    reviewState: 'needs-review',
    labels: ['performance', 'cache'],
    sourceBranch: 'feat/reuse-mr-cache',
    targetBranch: 'main',
    checksPassed: 18,
    checksTotal: 18,
    approvals: 1,
    requiredApprovals: 2,
    files: [cacheDiff, cancellationDiff],
    discussions: discussionSet.cache,
  },
  {
    id: 'platform-desktop!39',
    iid: 39,
    projectId: 'platform-desktop',
    projectName: 'Desktop Client',
    projectPath: 'platform/desktop-client',
    title: '差分ビューの行描画を可視範囲だけに制限する',
    description: '大きな変更でもスクロール位置の前後だけを描画し、議論の入力状態は画面外でも失わないようにします。',
    author: authors.ryo,
    updatedAt: '48分前',
    state: 'open',
    reviewState: 'changes-requested',
    labels: ['performance', 'review'],
    sourceBranch: 'perf/virtual-diff-rows',
    targetBranch: 'main',
    checksPassed: 16,
    checksTotal: 18,
    approvals: 0,
    requiredApprovals: 2,
    files: [
      virtualDiffFile,
      keyboardDiff,
    ],
    discussions: discussionSet.cancellation,
  },
  {
    id: 'platform-desktop!37',
    iid: 37,
    projectId: 'platform-desktop',
    projectName: 'Desktop Client',
    projectPath: 'platform/desktop-client',
    title: 'Self-Managed接続先の資格情報をOSストアへ移す',
    description: '接続先ごとのトークンをOSの資格情報ストアに保存し、フロントエンドやログから参照できない境界を作ります。',
    author: authors.ken,
    updatedAt: '昨日 17:24',
    state: 'open',
    reviewState: 'approved',
    labels: ['security', 'connection'],
    sourceBranch: 'security/os-credential-store',
    targetBranch: 'main',
    checksPassed: 21,
    checksTotal: 21,
    approvals: 2,
    requiredApprovals: 2,
    files: [secureStoreDiff],
    discussions: discussionSet.secure,
  },
  {
    id: 'infra-observability!118',
    iid: 118,
    projectId: 'infra-observability',
    projectName: 'Observability',
    projectPath: 'infra/observability',
    title: 'GitLab APIの429待機を接続単位で扱う',
    description: 'レート制限を受けた接続だけを待機させ、ほかのプロジェクトのレビューを止めないようにします。',
    author: authors.mai,
    updatedAt: '昨日 09:18',
    state: 'open',
    reviewState: 'needs-review',
    labels: ['api', 'reliability'],
    sourceBranch: 'fix/rate-limit-cooldown',
    targetBranch: 'main',
    checksPassed: 14,
    checksTotal: 14,
    approvals: 0,
    requiredApprovals: 1,
    files: [timeoutDiff],
    discussions: discussionSet.timeout,
  },
  {
    id: 'web-portal!87',
    iid: 87,
    projectId: 'web-portal',
    projectName: 'Employee Portal',
    projectPath: 'web/employee-portal',
    title: '検索フォームのキーボード操作を見直す',
    description: '検索結果に戻ったあともフォーカス位置を分かりやすくし、レビュー時の移動をキーボードで完結できるようにします。',
    author: authors.ryo,
    updatedAt: '9月26日',
    state: 'open',
    reviewState: 'approved',
    labels: ['accessibility', 'ui'],
    sourceBranch: 'a11y/search-shortcuts',
    targetBranch: 'main',
    checksPassed: 12,
    checksTotal: 12,
    approvals: 2,
    requiredApprovals: 2,
    files: [keyboardDiff],
    discussions: discussionSet.keyboard,
  },
  {
    id: 'data-catalog!64',
    iid: 64,
    projectId: 'data-catalog',
    projectName: 'Data Catalog',
    projectPath: 'data/catalog',
    title: 'レビュー検索用のローカルインデックスを追加する',
    description: '過去MRのタイトルと説明をすばやく絞り込めるよう、取得済みデータの検索キーを追加します。',
    author: authors.akari,
    updatedAt: '9月24日',
    state: 'merged',
    reviewState: 'approved',
    labels: ['search', 'cache'],
    sourceBranch: 'feat/review-search-index',
    targetBranch: 'main',
    checksPassed: 19,
    checksTotal: 19,
    approvals: 2,
    requiredApprovals: 2,
    files: [projectMigrationsDiff],
    discussions: discussionSet.migration,
  },
  {
    id: 'web-portal!79',
    iid: 79,
    projectId: 'web-portal',
    projectName: 'Employee Portal',
    projectPath: 'web/employee-portal',
    title: '通知一覧の既読状態を同期する',
    description: '別タブで既読にした通知を一覧へ反映します。同期に失敗した場合はローカル状態を維持します。',
    author: authors.mai,
    updatedAt: '9月18日',
    state: 'closed',
    reviewState: 'changes-requested',
    labels: ['notifications'],
    sourceBranch: 'fix/notification-sync',
    targetBranch: 'main',
    checksPassed: 8,
    checksTotal: 10,
    approvals: 0,
    requiredApprovals: 2,
    files: [readStateDiff],
    discussions: [],
  },
]

export function filterMergeRequests(
  mergeRequests: MockMergeRequest[],
  query: string,
  status: 'all' | 'open' | 'merged' | 'closed' | 'needs-review',
  projectId?: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
  return mergeRequests.filter((mergeRequest) => {
    const matchesProject = !projectId || mergeRequest.projectId === projectId
    const matchesStatus =
      status === 'all' ||
      status === mergeRequest.state ||
      (status === 'needs-review' && mergeRequest.reviewState !== 'approved' && mergeRequest.state === 'open')
    const searchable = [mergeRequest.title, mergeRequest.description, mergeRequest.projectPath]
      .join(' ')
      .toLocaleLowerCase('ja-JP')
    return matchesProject && matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery))
  })
}

export function getDiscussionCount(mergeRequest: MockMergeRequest) {
  return mergeRequest.discussions.reduce((total, discussion) => total + (discussion.deleted ? 0 : 1) + discussion.replies.length, 0)
}
