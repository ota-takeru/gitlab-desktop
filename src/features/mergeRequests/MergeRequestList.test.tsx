import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSession, MergeRequest, MergeRequestsQuery, Project } from '../../types/gitlab'
import { buildQuery, MergeRequestList } from './MergeRequestList'

const { openGitLabUrlMock, queryMock } = vi.hoisted(() => ({ openGitLabUrlMock: vi.fn(), queryMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: queryMock,
}))

vi.mock('../../lib/gitlab', () => ({
  normalizeGitLabError: (error: unknown) => error instanceof Error ? error : new Error('open failed'),
  openGitLabUrl: openGitLabUrlMock,
}))

const sessionFixture: GitLabSession = {
  id: 'session-1',
  instanceUrl: 'https://gitlab.example/GitLab',
  serverVersion: null,
  user: { id: '42', name: 'Reviewer', username: 'reviewer' },
}

const emptyResult = {
  data: null,
  error: null,
  loading: false,
  refreshing: false,
  refresh: vi.fn(),
  snapshot: null,
  stale: false,
}
const projectCandidate: Project = { archived: false, description: '', id: '77', name: 'Desktop', pathWithNamespace: 'team/desktop', webUrl: 'https://gitlab.example/team/desktop' }
const savedSearchKey = 'gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:saved-searches'

function createMergeRequest(overrides: Partial<MergeRequest> = {}): MergeRequest {
  return {
    author: { id: '9', name: '作者', username: 'author' },
    description: '',
    diffRefs: null,
    draft: false,
    headSha: null,
    id: 'mr-3',
    iid: '3',
    labels: [],
    projectId: '77',
    projectPath: 'team/desktop',
    reviewers: [],
    sourceBranch: 'feature',
    state: 'opened',
    targetBranch: 'main',
    title: 'Metadata preview',
    updatedAt: '2026-10-08T12:00:00.000Z',
    webUrl: 'https://gitlab.example/team/desktop/-/merge_requests/3',
    assignees: [],
    ...overrides,
  }
}

function latestMrsQuery(queries: unknown[]): MergeRequestsQuery | null {
  return queries.filter((query): query is MergeRequestsQuery => Boolean(query && typeof query === 'object' && 'kind' in query && query.kind === 'mrs')).at(-1) ?? null
}

function latestHookMrsQuery(): MergeRequestsQuery | null {
  return latestMrsQuery(queryMock.mock.calls.map((call) => call[1]))
}

describe('MergeRequestList search filters', () => {
  beforeEach(() => {
    localStorage.clear()
    queryMock.mockReset()
    openGitLabUrlMock.mockReset().mockResolvedValue(undefined)
    queryMock.mockReturnValue(emptyResult)
  })

  it('passes all applied filters to the typed query and maps self/date values', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })

    render(<MergeRequestList initialParams={{ assignee: 'self', authorId: '7', projectId: '9', reviewer: 'self', search: 'release', state: 'all', updatedAfter: '2026-01-01', updatedBefore: '2026-01-31', page: '3' }} onOpenMergeRequest={vi.fn()} />)

    expect(latestMrsQuery(seen)).toEqual({
      authorId: '7',
      assigneeId: '42',
      kind: 'mrs',
      orderBy: 'updated_at',
      page: 3,
      projectId: '9',
      reviewerId: '42',
      search: 'release',
      sort: 'desc',
      state: 'all',
      updatedAfter: '2026-01-01T00:00:00.000Z',
      updatedBefore: '2026-01-31T23:59:59.999Z',
    })
  })

  it('stages search text until Enter/search is submitted', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    const search = screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' })

    fireEvent.change(search, { target: { value: 'without-submit' } })
    expect(latestMrsQuery(seen)).toMatchObject({ search: '' })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    fireEvent.submit(screen.getByRole('button', { name: '検索' }).closest('form') as HTMLFormElement)
    expect(latestMrsQuery(seen)).toMatchObject({ search: 'without-submit', state: 'all' })
  })

  it('applies a saved search including its project id', () => {
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:saved-searches', JSON.stringify([{ assignee: 'self', id: 'saved-1', label: 'Project history', projectId: '77', query: 'history', state: 'merged' }]))
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Project history' }))
    expect(latestMrsQuery(seen)).toMatchObject({ assigneeId: '42', orderBy: 'updated_at', projectId: '77', search: 'history', sort: 'desc', state: 'merged' })
  })

  it('keeps the self-assignee URL filter through pagination', () => {
    const onSearchStateChange = vi.fn()
    const pageResult = {
      ...emptyResult,
      data: [],
      snapshot: { completeness: 'complete' as const, data: [], fetchedAt: Date.now(), nextPage: 2, source: 'network' as const },
    }
    queryMock.mockReturnValue(pageResult)

    render(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.click(screen.getByRole('button', { name: '次へ' }))

    expect(onSearchStateChange).toHaveBeenCalledWith(expect.objectContaining({ assignee: 'self', page: '2', state: 'opened' }))
    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '42', page: 2 })
  })

  it('applies sort controls to the query and preserves them in URL state', () => {
    const onSearchStateChange = vi.fn()
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'MRの並び順' }))
    fireEvent.click(screen.getByRole('option', { name: '作成日時' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '並び順の方向' }))
    fireEvent.click(screen.getByRole('option', { name: '古い順' }))
    fireEvent.click(screen.getByRole('button', { name: '検索' }))

    expect(latestHookMrsQuery()).toMatchObject({ orderBy: 'created_at', sort: 'asc' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: 'created_at', sort: 'asc' }))
  })

  it('passes an explicit assignee ID from the URL to the query', () => {
    render(<MergeRequestList initialParams={{ assignee: '17', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '17', state: 'opened' })
    expect(screen.getByRole('combobox', { name: 'MRの担当者' })).toHaveValue('ID 17 · 保存済みのID')
  })

  it('saves and reapplies the self-assignee filter', async () => {
    const onSearchStateChange = vi.fn()
    localStorage.setItem(savedSearchKey, JSON.stringify([{ assignee: '17', id: 'owner-17', label: 'Other assignee', query: '', state: 'opened' }]))
    render(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: '検索を保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const savedSearches = JSON.parse(localStorage.getItem(savedSearchKey) ?? '[]') as Array<{ assignee?: string }>
    expect(savedSearches).toHaveLength(2)
    expect(savedSearches[0]).toMatchObject({ assignee: 'self', orderBy: 'updated_at', sort: 'desc' })
    expect(savedSearches[1]).toMatchObject({ assignee: '17' })

    fireEvent.change(screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' }), { target: { value: 'temporary' } })
    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Other assignee' }))
    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '17', search: '' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' }), { target: { value: 'temporary' } })
    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'opened MR' }))

    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: 'self', state: 'opened' }))
    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '42', search: '', state: 'opened' })
  })

  it('uses the optional custom label when saving a search', () => {
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '保存名（任意）' }), { target: { value: 'My review queue' } })
    fireEvent.click(screen.getByRole('button', { name: '検索を保存' }))

    expect(JSON.parse(localStorage.getItem(savedSearchKey) ?? '[]')).toEqual([
      expect.objectContaining({ label: 'My review queue', orderBy: 'updated_at', sort: 'desc' }),
    ])
  })

  it('rejects invalid ids before a network query is changed', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList initialParams={{ projectId: 'project-slug' }} onOpenMergeRequest={vi.fn()} />)

    expect(screen.getByText('プロジェクトIDは1以上の数字で入力してください。')).toBeInTheDocument()
    expect(latestMrsQuery(seen)).toBeNull()
  })

  it('rejects a nonnumeric assignee ID before a query', () => {
    render(<MergeRequestList initialParams={{ assignee: 'reviewer-name', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    expect(screen.getByText('担当者IDは1以上の数字で入力してください。')).toBeInTheDocument()
    expect(latestHookMrsQuery()).toBeNull()
  })

  it('retains selected project conditions when the filter panel is closed and search is applied', async () => {
    const onSearchStateChange = vi.fn()
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return query && typeof query === 'object' && 'kind' in query && query.kind === 'projects' ? { ...emptyResult, data: [projectCandidate] } : emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)
    const advanced = screen.getByRole('button', { name: '詳細条件' })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(advanced)
    fireEvent.change(screen.getByRole('combobox', { name: 'MRのプロジェクト' }), { target: { value: 'Desk' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Desktop/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: /Desktop/ }))
    fireEvent.click(screen.getByRole('button', { name: '詳細条件 · 設定あり' }))
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: '検索' }))
    expect(onSearchStateChange).toHaveBeenCalledWith(expect.objectContaining({ projectId: '77' }))
    expect(latestMrsQuery(seen)).toMatchObject({ projectId: '77' })
  })

  it('shows all twenty saved searches and persists renames and deletions', () => {
    const searches = Array.from({ length: 20 }, (_, index) => ({
      id: `saved-${index + 1}`,
      label: `saved search ${index + 1}`,
      orderBy: index === 0 ? 'created_at' : 'updated_at',
      query: `term-${index + 1}`,
      sort: index === 0 ? 'asc' : 'desc',
      state: 'opened',
    }))
    localStorage.setItem(savedSearchKey, JSON.stringify(searches))
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '保存済み検索を管理（20）' }))
    expect(screen.getByRole('button', { name: 'saved search 20' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '名前を変更' })).toHaveLength(20)

    fireEvent.change(screen.getAllByRole('textbox', { name: '保存名' })[0], { target: { value: 'renamed search' } })
    fireEvent.click(screen.getAllByRole('button', { name: '名前を変更' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'saved search 2を削除' }))

    const stored = JSON.parse(localStorage.getItem(savedSearchKey) ?? '[]') as Array<{ id: string; label: string }>
    expect(stored).toHaveLength(19)
    expect(stored[0]).toMatchObject({ id: 'saved-1', label: 'renamed search' })
    expect(stored.some(({ id }) => id === 'saved-2')).toBe(false)
  })

  it('applies saved sorting and emits it into the URL state', () => {
    const onSearchStateChange = vi.fn()
    localStorage.setItem(savedSearchKey, JSON.stringify([{
      id: 'created-oldest',
      label: 'created oldest',
      orderBy: 'created_at',
      query: 'release',
      sort: 'asc',
      state: 'opened',
    }]))
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'created oldest' }))

    expect(latestHookMrsQuery()).toMatchObject({ orderBy: 'created_at', search: 'release', sort: 'asc' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: 'created_at', search: 'release', sort: 'asc' }))
  })

  it('shows available MR metadata and keeps pin/pipeline controls outside the open button', async () => {
    const mergeRequest = createMergeRequest({
      assignees: [{ id: '10', name: '担当者', username: 'assignee' }],
      draft: true,
      labels: ['frontend', 'ready'],
      pipeline: { status: 'success', webUrl: 'https://gitlab.example/team/desktop/-/pipelines/100' },
      reviewers: [{ id: '11', name: 'レビュアー', username: 'reviewer' }],
    })
    const onOpenMergeRequest = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [mergeRequest] }
      : emptyResult)
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:personal-workspace', JSON.stringify({
      pinned: [],
      recent: [],
      reading: { '77:3': { known: { '100': '2026-10-08T12:00:00.000Z' }, read: {} } },
      settings: { autoRefresh: true, notifyComments: false, notifyTodos: false },
    }))
    render(<MergeRequestList onOpenMergeRequest={onOpenMergeRequest} />)

    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(screen.getByText('担当 担当者 · レビュー レビュアー')).toBeInTheDocument()
    expect(screen.getByLabelText('CI 成功')).toBeInTheDocument()
    expect(screen.getByText('未読 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '!3を固定' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '!3を固定解除' })).toBeInTheDocument())
    expect(onOpenMergeRequest).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '!3のCIパイプラインを開く' }))
    await waitFor(() => expect(openGitLabUrlMock).toHaveBeenCalledWith('session-1', 'https://gitlab.example/team/desktop/-/pipelines/100'))
    expect(onOpenMergeRequest).not.toHaveBeenCalled()
  })

  it('fetches CI details only after an explicit click and uses the current session', async () => {
    const pipelineUrl = 'https://gitlab.example/team/desktop/-/pipelines/100'
    const mergeRequest = createMergeRequest({ pipeline: { status: 'failed', webUrl: pipelineUrl } })
    const onOpenMergeRequest = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => {
      if (query?.kind === 'mrs') return { ...emptyResult, data: [createMergeRequest()] }
      if (query?.kind === 'mr') return { ...emptyResult, data: mergeRequest }
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={onOpenMergeRequest} />)

    expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'mr')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'CIを確認' }))

    await waitFor(() => expect(queryMock).toHaveBeenCalledWith('session-1', { iid: '3', kind: 'mr', projectId: '77' }))
    expect(screen.getByLabelText('CI 失敗')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '!3のCIパイプラインを開く' }))
    await waitFor(() => expect(openGitLabUrlMock).toHaveBeenCalledWith('session-1', pipelineUrl))
    expect(onOpenMergeRequest).not.toHaveBeenCalled()
  })

  it('reports when a confirmed MR has no pipeline', async () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => {
      if (query?.kind === 'mrs') return { ...emptyResult, data: [createMergeRequest()] }
      if (query?.kind === 'mr') return { ...emptyResult, data: createMergeRequest({ pipeline: null }) }
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'CIを確認' }))

    expect(await screen.findByLabelText('CI情報なし')).toBeInTheDocument()
    expect(screen.queryByLabelText('CI 成功')).not.toBeInTheDocument()
  })

  it('shows a CI query error and keeps a retry action available', async () => {
    const refresh = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => {
      if (query?.kind === 'mrs') return { ...emptyResult, data: [createMergeRequest()] }
      if (query?.kind === 'mr') return { ...emptyResult, error: new Error('network unavailable'), refresh }
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'CIを確認' }))

    expect(await screen.findByText('CI状態を取得できませんでした: network unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('moves focus through MR rows with j/k and arrow keys without handling search input keys', () => {
    const mergeRequests = [createMergeRequest(), createMergeRequest({ id: 'mr-4', iid: '4', title: 'Second MR' })]
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: mergeRequests }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    const search = screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' })
    search.focus()
    fireEvent.keyDown(search, { key: 'j' })
    expect(document.activeElement).toBe(search)

    const list = screen.getByRole('list', { name: 'MR検索結果' })
    const rows = list.querySelectorAll<HTMLButtonElement>('[data-mr-open="true"]')
    fireEvent.keyDown(list, { key: 'j' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'k' })
    expect(document.activeElement).toBe(rows[0])
  })

  it('rejects a missing current user id rather than querying all merge requests', () => {
    const previousId = sessionFixture.user.id
    sessionFixture.user.id = ''
    queryMock.mockReturnValue(emptyResult)
    try {
      render(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

      expect(screen.getByText('接続ユーザーIDを確認できないため、自分の担当MRを検索できません。')).toBeInTheDocument()
      expect(latestHookMrsQuery()).toBeNull()
    } finally {
      sessionFixture.user.id = previousId
    }
  })
})

describe('buildQuery', () => {
  it('keeps the default state explicit for project history', () => {
    expect(buildQuery({ assignee: '', authorId: '', orderBy: 'updated_at', page: 1, projectId: '12', reviewer: '', search: '', sort: 'desc', state: 'all', updatedAfter: '', updatedBefore: '' }, '42')).toEqual({ kind: 'mrs', orderBy: 'updated_at', page: 1, projectId: '12', search: '', sort: 'desc', state: 'all' })
  })

  it('does not drop a self-assignee filter without the user id', () => {
    expect(() => buildQuery({ assignee: 'self', authorId: '', orderBy: 'updated_at', page: 1, projectId: '', reviewer: '', search: '', sort: 'desc', state: 'opened', updatedAfter: '', updatedBefore: '' })).toThrow('自分の担当MRを検索できません')
  })
})
