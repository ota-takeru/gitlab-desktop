import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabGroup, GitLabSession, GitLabUser, MergeRequest, MergeRequestsQuery, Project } from '../../types/gitlab'
import { MergeRequestList } from './MergeRequestList'
import { buildQuery } from './mergeRequestSearch'

const { openGitLabUrlMock, queryMock } = vi.hoisted(() => ({ openGitLabUrlMock: vi.fn(), queryMock: vi.fn() }))

vi.mock('../connections/connectionContext', () => ({
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
const groupCandidate: GitLabGroup = { fullName: 'Team / Platform', fullPath: 'team/platform', id: '12', name: 'Platform', webUrl: 'https://gitlab.example/groups/team/platform' }
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

/** Lists the conditions by clicking the search field. */
function openSearchOptions() {
  fireEvent.click(screen.getByRole('combobox', { name: /で検索$/u }))
}

/** Opens the editor of one condition from the search field's options. */
function addCondition(name: string) {
  openSearchOptions()
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name }))
}

function conditionTags(): string[] {
  return Array.from(screen.getByLabelText('適用中の条件').querySelectorAll('.MuiChip-label'), (label) => label.textContent ?? '')
}

describe('MergeRequestList search filters', () => {
  beforeEach(() => {
    localStorage.clear()
    queryMock.mockReset()
    openGitLabUrlMock.mockReset().mockResolvedValue(undefined)
    queryMock.mockReturnValue(emptyResult)
  })

  it('keeps the conditions menu as wide as the search field, within the window', () => {
    const observers: Array<{ callback: () => void; observed: Element[] }> = []
    vi.stubGlobal('ResizeObserver', class {
      observed: Element[] = []
      constructor(public callback: () => void) { observers.push(this) }
      observe(target: Element) { this.observed.push(target) }
      disconnect() {}
    })
    try {
      render(<MergeRequestList initialParams={{ state: 'opened' }} onOpenMergeRequest={vi.fn()} />)
      const anchor = screen.getByRole('combobox', { name: /で検索$/u }).closest<HTMLElement>('.MuiTextField-root')!
      let width = 320
      Object.defineProperty(anchor, 'clientWidth', { configurable: true, get: () => width })
      openSearchOptions()
      const popper = screen.getByRole('menu').closest<HTMLElement>('.MuiPopper-root')!
      expect(getComputedStyle(popper).width).toBe('320px')
      expect(getComputedStyle(popper).maxWidth).toBe(`${window.innerWidth - 16}px`)

      width = 480
      const observer = observers.find((item) => item.observed.includes(anchor))!
      act(() => observer.callback())
      expect(getComputedStyle(popper).width).toBe('480px')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the status line in place while loading so results do not move when they arrive', () => {
    queryMock.mockReturnValue({ ...emptyResult, loading: true })
    const view = render(<MergeRequestList initialParams={{ reviewer: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)
    const loadingStatus = screen.getByText('MRを読み込み中…')

    queryMock.mockReturnValue({ ...emptyResult, data: [createMergeRequest()], snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: null, source: 'network' } })
    view.rerender(<MergeRequestList initialParams={{ reviewer: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    expect(screen.getByText('1件取得')).toBe(loadingStatus)
  })

  it('switches between the reader\'s own MRs with chips that become removable condition tags', () => {
    const onSearchStateChange = vi.fn()
    const view = render(<MergeRequestList initialParams={{ state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)
    const own = (name: string) => within(screen.getByRole('group', { name: '自分のMR' })).getByRole('button', { name })

    fireEvent.click(own('レビュー依頼'))
    expect(own('レビュー依頼')).toHaveAttribute('aria-pressed', 'true')
    expect(conditionTags()).toEqual(['状態: Open', 'レビュアー: 自分'])
    expect(latestHookMrsQuery()).toMatchObject({ reviewerId: '42', state: 'opened' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ reviewer: 'self', state: 'opened' }))
    // Exactly the reader's condition makes the screen that queue.
    expect(screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })).toBeInTheDocument()

    // Another chip replaces it; its tag removes it like any other condition.
    fireEvent.click(own('担当'))
    expect(own('レビュー依頼')).toHaveAttribute('aria-pressed', 'false')
    expect(conditionTags()).toEqual(['状態: Open', '担当者: 自分'])
    fireEvent.click(screen.getByLabelText('担当者の絞り込みを解除'))
    expect(conditionTags()).toEqual(['状態: Open'])
    expect(own('担当')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /保存済み検索を管理/u })).toBeInTheDocument()
    openSearchOptions()
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['状態', 'レビュアー', '担当者', '作者', 'ラベル', 'ソースブランチ', 'ターゲットブランチ', '更新日', 'プロジェクト', 'グループ'])

    // From every MR a chip also narrows to open ones, as the queues did; a second press removes it.
    view.unmount()
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    fireEvent.click(own('作成'))
    expect(conditionTags()).toEqual(['状態: Open', '作者: 自分'])
    fireEvent.click(own('作成'))
    expect(conditionTags()).toEqual(['状態: Open'])
  })

  it('keeps a selected author fixed through initial filters, saved searches, and reset', async () => {
    const author: GitLabUser = { id: '9', name: 'Target User', username: 'target' }
    const onSearchStateChange = vi.fn()
    localStorage.setItem(savedSearchKey, JSON.stringify([{
      authorId: '7',
      id: 'search-other-author',
      label: 'Other author search',
      labels: 'bug',
      query: 'saved term',
      state: 'merged',
    }]))

    render(<MergeRequestList author={author} initialParams={{ authorId: '7', reviewer: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    expect(latestHookMrsQuery()).toMatchObject({ authorId: '9', reviewerId: '42', state: 'opened' })
    expect(screen.queryByRole('group', { name: '自分のMR' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })).toBeInTheDocument()
    expect(conditionTags()).toContain('作者: Target User')
    expect(screen.queryByLabelText('作者の絞り込みを解除')).not.toBeInTheDocument()

    openSearchOptions()
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: '作者' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('作者: Target User'))
    expect(screen.queryByRole('dialog', { name: '作者の条件' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/u }))
    fireEvent.click(screen.getByRole('button', { name: 'Other author search' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '保存済み検索' })).not.toBeInTheDocument())
    expect(latestHookMrsQuery()).toMatchObject({ authorId: '9', labels: ['bug'], search: 'saved term', state: 'merged' })
    expect(conditionTags()).toContain('作者: Target User')

    fireEvent.click(screen.getByRole('button', { name: '条件をクリア' }))
    expect(latestHookMrsQuery()).toEqual({ authorId: '9', kind: 'mrs', orderBy: 'updated_at', page: 1, search: '', sort: 'desc', state: 'all' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ authorId: '9', state: 'all' }))
  })

  it('shows a project branch as a chip that returns to all the project MRs when removed', () => {
    const onSearchStateChange = vi.fn()
    render(<MergeRequestList initialParams={{ projectId: '9', projectName: 'group/project', sourceBranch: 'feature/search', state: 'all' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} projectId="9" projectName="group/project" />)

    expect(screen.getByText('ブランチ: feature/search')).toBeInTheDocument()
    expect(latestHookMrsQuery()).toMatchObject({ projectId: '9', sourceBranch: 'feature/search' })
    // The project's own list keeps its project, so neither scope can be added.
    openSearchOptions()
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'プロジェクト' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'グループ' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    fireEvent.click(screen.getByLabelText('ブランチの絞り込みを解除'))
    expect(screen.queryByText('ブランチ: feature/search')).not.toBeInTheDocument()
    expect(latestHookMrsQuery()?.sourceBranch).toBeUndefined()
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.not.objectContaining({ sourceBranch: expect.anything() }))
  })

  it('lists the conditions from the search field and shows their values as tags inside it', () => {
    render(<MergeRequestList initialParams={{ labels: 'bug', search: 'cache', state: 'merged' }} onOpenMergeRequest={vi.fn()} />)
    const field = screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })

    // The values are tags inside the field; the search word is the field's own text.
    const tags = screen.getByLabelText('適用中の条件')
    expect(field.closest('.MuiInputBase-root')).toContainElement(tags)
    expect(conditionTags()).toEqual(['状態: Merged', 'ラベル: bug'])
    expect(field).toHaveValue('cache')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(field)
    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('menu', { name: '検索条件' })).getAllByRole('menuitem')).toHaveLength(10)
    // Typing hides the options; the arrow key lists them again and Escape closes them.
    fireEvent.change(field, { target: { value: 'cache v2' } })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    // Clicking a tag edits that condition instead of listing the options.
    fireEvent.click(screen.getByText('ラベル: bug'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'ラベルの条件' })).toBeInTheDocument()
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

  it('passes the group, label, and branch filters to GitLab and serializes them into route state', () => {
    const onSearchStateChange = vi.fn()
    render(<MergeRequestList initialParams={{ groupId: 'team/platform', labels: 'bug, ready', sourceBranch: 'feature/search', state: 'opened', targetBranch: 'main' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    expect(latestHookMrsQuery()).toMatchObject({
      groupId: 'team/platform',
      labels: ['bug', 'ready'],
      sourceBranch: 'feature/search',
      state: 'opened',
      targetBranch: 'main',
    })
    // Every applied condition is a tag; a tag opens the editor of its condition.
    expect(conditionTags()).toEqual(['状態: Open', 'グループ: team/platform', 'ラベル: bug, ready', 'ブランチ: feature/search', 'ターゲット: main'])
    fireEvent.click(screen.getByText('ラベル: bug, ready'))
    expect(within(screen.getByRole('dialog', { name: 'ラベルの条件' })).getByRole('textbox', { name: 'MRのラベル' })).toHaveValue('bug, ready')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByText('グループ: team/platform'))
    // A path saved before groups were chosen from candidates stays selected as it is.
    expect(screen.getByRole('combobox', { name: 'MRのグループ' })).toHaveValue('team/platform · 保存済みのグループパス')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '検索' }))
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      groupId: 'team/platform',
      labels: 'bug,ready',
      sourceBranch: 'feature/search',
      targetBranch: 'main',
    }))
  })

  it('chooses a group from candidates, stores its ID, shows its path, and clears the project scope', async () => {
    const onSearchStateChange = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'groups' ? { ...emptyResult, data: [groupCandidate] } : emptyResult)
    render(<MergeRequestList initialParams={{ projectId: '77', state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    addCondition('グループ')
    const picker = screen.getByRole('combobox', { name: 'MRのグループ' })
    fireEvent.change(picker, { target: { value: 'pl' } })
    await waitFor(() => expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'groups', page: 1, search: 'pl' }))
    // Choosing the group applies it at once.
    fireEvent.click(await screen.findByRole('option', { name: /team\/platform/u }))

    expect(latestHookMrsQuery()).toMatchObject({ groupId: '12', state: 'opened' })
    expect(latestHookMrsQuery()).not.toHaveProperty('projectId')
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: '12' }))
    expect(onSearchStateChange.mock.lastCall?.[0]).not.toHaveProperty('projectId')
    expect(screen.getByText('グループ: team/platform')).toBeInTheDocument()
  })

  it('rejects a route that scopes the search to both a project and a group', () => {
    render(<MergeRequestList initialParams={{ groupId: 'team/platform', projectId: '77' }} onOpenMergeRequest={vi.fn()} />)

    expect(screen.getByText('グループとプロジェクトは同時に指定できません。')).toBeInTheDocument()
    expect(latestHookMrsQuery()).toBeNull()
  })

  it('rejects an invalid numeric group id before querying GitLab', () => {
    render(<MergeRequestList initialParams={{ groupId: '0' }} onOpenMergeRequest={vi.fn()} />)

    expect(screen.getByText('グループIDまたはグループパスを確認してください。')).toBeInTheDocument()
    expect(latestHookMrsQuery()).toBeNull()
  })

  it('restores added filters from a saved group search and emits them into route state', () => {
    const onSearchStateChange = vi.fn()
    localStorage.setItem(savedSearchKey, JSON.stringify([{
      groupId: 'team/platform',
      id: 'group-search',
      label: 'Platform bug fixes',
      labels: 'bug,ready',
      query: 'cache',
      sourceBranch: 'feature/cache',
      state: 'opened',
      targetBranch: 'main',
    }]))
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Platform bug fixes' }))

    expect(latestHookMrsQuery()).toMatchObject({ groupId: 'team/platform', labels: ['bug', 'ready'], sourceBranch: 'feature/cache', targetBranch: 'main' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'team/platform', labels: 'bug,ready', sourceBranch: 'feature/cache', targetBranch: 'main' }))
  })

  it('saves group, label, and branch filters with the current search', async () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'groups' ? { ...emptyResult, data: [groupCandidate] } : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    addCondition('グループ')
    fireEvent.change(screen.getByRole('combobox', { name: 'MRのグループ' }), { target: { value: 'plat' } })
    fireEvent.click(await screen.findByRole('option', { name: /team\/platform/u }))
    for (const [name, value] of [['ラベル', 'bug, ready'], ['ソースブランチ', 'feature/cache'], ['ターゲットブランチ', 'main']]) {
      addCondition(name)
      fireEvent.change(screen.getByRole('textbox', { name: `MRの${name}` }), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: '適用' }))
    }
    expect(conditionTags()).toEqual(['グループ: team/platform', 'ラベル: bug, ready', 'ブランチ: feature/cache', 'ターゲット: main'])
    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: '検索を保存' }))

    expect(JSON.parse(localStorage.getItem(savedSearchKey) ?? '[]')).toEqual([
      expect.objectContaining({ groupId: '12', labels: 'bug,ready', sourceBranch: 'feature/cache', targetBranch: 'main' }),
    ])
  })

  it('stages search text until Enter/search is submitted', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    const search = screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })

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

  it('appends the next page below the rows with the same conditions, showing a row that moved pages once', () => {
    const onSearchStateChange = vi.fn()
    const first = createMergeRequest({ id: 'mr-3', iid: '3', title: 'First page MR' })
    const pageResults: Record<number, object> = {
      1: { ...emptyResult, data: [first], snapshot: { completeness: 'complete' as const, data: [first], fetchedAt: 1, nextPage: 2, source: 'network' as const } },
      2: { ...emptyResult, data: [first, createMergeRequest({ id: 'mr-4', iid: '4', title: 'Second page MR' })], snapshot: { completeness: 'complete' as const, data: [], fetchedAt: 1, nextPage: null, source: 'network' as const } },
    }
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string; page?: number } | null) => query?.kind === 'mrs' ? pageResults[query.page ?? 1] : emptyResult)

    render(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))

    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '42', page: 2, state: 'opened' })
    const rows = within(screen.getByRole('list', { name: 'MR検索結果' })).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('First page MR'), expect.stringContaining('Second page MR')])
    expect(screen.getByText('すべて表示しました')).toBeInTheDocument()
    // Scrolling is not a change of conditions, so the URL keeps the first page.
    expect(onSearchStateChange).not.toHaveBeenCalled()
  })

  it('loads the next page when the end of the list scrolls into view', () => {
    const observers: Array<{ callback: IntersectionObserverCallback; disconnect: () => void }> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(public callback: IntersectionObserverCallback) { observers.push(this) }
      observe() {}
      disconnect() {}
    })
    const first = createMergeRequest()
    const page = { ...emptyResult, data: [first], snapshot: { completeness: 'complete' as const, data: [first], fetchedAt: 1, nextPage: 2, source: 'network' as const } }
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs' ? page : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    act(() => observers.at(-1)!.callback([{ isIntersecting: true } as IntersectionObserverEntry], observers.at(-1) as unknown as IntersectionObserver))

    expect(latestHookMrsQuery()).toMatchObject({ page: 2 })
    vi.unstubAllGlobals()
  })

  it('shows the creation time on rows when the list is ordered by creation', () => {
    const mergeRequest = createMergeRequest({ createdAt: '2026-10-01T09:00:00.000Z' })
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs' ? { ...emptyResult, data: [mergeRequest] } : emptyResult)
    const view = render(<MergeRequestList initialParams={{ orderBy: 'created_at', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    const created = view.container.querySelector('time')
    expect(created).toHaveAttribute('datetime', '2026-10-01T09:00:00.000Z')
    expect(created?.textContent).toMatch(/^作成 /u)

    view.unmount()
    const updated = render(<MergeRequestList initialParams={{ state: 'opened' }} onOpenMergeRequest={vi.fn()} />).container.querySelector('time')
    expect(updated).toHaveAttribute('datetime', mergeRequest.updatedAt)
    expect(updated?.textContent).toMatch(/^更新 /u)
  })

  it('applies the order and the state at once, leaving typed text for Enter, and preserves them in URL state', () => {
    const onSearchStateChange = vi.fn()
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }), { target: { value: 'typed' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'MRの並び順' }))
    fireEvent.click(screen.getByRole('option', { name: '作成日時' }))
    expect(latestHookMrsQuery()).toMatchObject({ orderBy: 'created_at', search: '' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '並び順の方向' }))
    fireEvent.click(screen.getByRole('option', { name: '古い順' }))
    addCondition('状態')
    fireEvent.click(within(screen.getByRole('dialog', { name: '状態の条件' })).getByRole('menuitem', { name: 'Merged' }))
    expect(conditionTags()).toEqual(['状態: Merged'])

    expect(latestHookMrsQuery()).toMatchObject({ orderBy: 'created_at', search: '', sort: 'asc', state: 'merged' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: 'created_at', sort: 'asc', state: 'merged' }))
    expect(onSearchStateChange.mock.lastCall?.[0]).not.toHaveProperty('search')
  })

  it('adds a reviewer only once a person is chosen, and names the person in the tag', async () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'users'
      ? { ...emptyResult, data: [{ id: '17', name: 'Alice Example', username: 'alice' }] }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    addCondition('レビュアー')
    const picker = screen.getByRole('combobox', { name: 'MRのレビュアー' })
    expect(picker).toHaveValue('')
    expect(latestHookMrsQuery()).not.toHaveProperty('reviewerId')

    fireEvent.change(picker, { target: { value: 'Al' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Alice Example/u })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: /Alice Example/u }))
    expect(latestHookMrsQuery()).toMatchObject({ reviewerId: '17' })
    expect(conditionTags()).toEqual(['レビュアー: Alice Example'])

    // 「自分」 sets the reviewer to the connected user.
    fireEvent.click(screen.getByText('レビュアー: Alice Example'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'レビュアーの条件' })).getByRole('button', { name: '自分' }))
    expect(latestHookMrsQuery()).toMatchObject({ reviewerId: '42' })
    expect(conditionTags()).toEqual(['レビュアー: 自分'])
  })

  it('passes an explicit assignee ID from the URL to the query', () => {
    render(<MergeRequestList initialParams={{ assignee: '17', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '17', state: 'opened' })
    expect(conditionTags()).toEqual(['状態: Open', '担当者: ID 17'])
  })

  it('saves and reapplies the self-assignee filter', async () => {
    const onSearchStateChange = vi.fn()
    localStorage.setItem(savedSearchKey, JSON.stringify([{ assignee: '17', id: 'owner-17', label: 'Other assignee', query: '', state: 'opened' }]))
    // With a further condition it is an MR search rather than the fixed assigned queue.
    render(<MergeRequestList initialParams={{ assignee: 'self', labels: 'bug', state: 'opened' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)

    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: '検索を保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const savedSearches = JSON.parse(localStorage.getItem(savedSearchKey) ?? '[]') as Array<{ assignee?: string }>
    expect(savedSearches).toHaveLength(2)
    expect(savedSearches[0]).toMatchObject({ assignee: 'self', orderBy: 'updated_at', sort: 'desc' })
    expect(savedSearches[1]).toMatchObject({ assignee: '17' })

    fireEvent.change(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }), { target: { value: 'temporary' } })
    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Other assignee' }))
    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '17', search: '' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }), { target: { value: 'temporary' } })
    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(onSearchStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: 'self', state: 'opened' }))
    expect(latestHookMrsQuery()).toMatchObject({ assigneeId: '42', search: '', state: 'opened' })
  })

  it('saves the applied conditions rather than unsubmitted text, named in Japanese by default', () => {
    render(<MergeRequestList initialParams={{ search: 'cache', state: 'merged' }} onOpenMergeRequest={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }), { target: { value: 'not submitted' } })
    fireEvent.click(screen.getByRole('button', { name: /保存済み検索を管理/ }))
    fireEvent.click(screen.getByRole('button', { name: '検索を保存' }))

    expect(JSON.parse(localStorage.getItem(savedSearchKey) ?? '[]')).toEqual([
      expect.objectContaining({ label: 'Merged · cache', query: 'cache', state: 'merged' }),
    ])
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

  it('applies a project chosen from candidates and names it in the tag', async () => {
    const onSearchStateChange = vi.fn()
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return query && typeof query === 'object' && 'kind' in query && query.kind === 'projects' ? { ...emptyResult, data: [projectCandidate] } : emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)
    addCondition('プロジェクト')
    fireEvent.change(screen.getByRole('combobox', { name: 'MRのプロジェクト' }), { target: { value: 'Desk' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Desktop/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: /Desktop/ }))
    expect(onSearchStateChange).toHaveBeenCalledWith(expect.objectContaining({ projectId: '77' }))
    expect(latestMrsQuery(seen)).toMatchObject({ projectId: '77' })
    expect(conditionTags()).toEqual(['プロジェクト: team/desktop'])
    // Typed text then searches within the project.
    fireEvent.click(screen.getByRole('button', { name: '検索' }))
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

  it('shows available MR metadata and keeps the pipeline control outside the open button', async () => {
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

    expect(screen.getByLabelText('Draft')).toBeInTheDocument()
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    // Rows name the author only; assignees and reviewers belong to the MR itself.
    expect(screen.queryByText(/担当 担当者|レビュー レビュアー/u)).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'MR検索結果' })).getByLabelText('Open')).toBeInTheDocument()
    expect(screen.getByLabelText('CI 成功')).toBeInTheDocument()
    expect(screen.getByLabelText('未読 1')).toBeInTheDocument()

    // A row pins its MR to the sidebar with the title it shows.
    fireEvent.click(screen.getByRole('button', { name: '!3をサイドバーに固定' }))
    expect(screen.getByRole('button', { name: '!3の固定を外す' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:personal-workspace') ?? '{}')).toMatchObject({ pinned: [{ iid: '3', projectId: '77' }], tabs: { '77:3': { state: 'opened', title: mergeRequest.title } } })

    fireEvent.click(screen.getByRole('button', { name: '!3のCIパイプラインを開く' }))
    await waitFor(() => expect(openGitLabUrlMock).toHaveBeenCalledWith('session-1', 'https://gitlab.example/team/desktop/-/pipelines/100'))
    expect(onOpenMergeRequest).not.toHaveBeenCalled()
  })

  it('shows CI only when GitLab included it, without a lookup button', async () => {
    const pipelineUrl = 'https://gitlab.example/team/desktop/-/pipelines/100'
    const onOpenMergeRequest = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [createMergeRequest({ pipeline: { status: 'failed', webUrl: pipelineUrl } }), createMergeRequest({ id: 'mr-4', iid: '4', pipeline: null })] }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={onOpenMergeRequest} />)

    expect(screen.queryByRole('button', { name: 'CIを確認' })).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('CI 失敗')).toHaveLength(1)
    expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'mr')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '!3のCIパイプラインを開く' }))
    await waitFor(() => expect(openGitLabUrlMock).toHaveBeenCalledWith('session-1', pipelineUrl))
    expect(onOpenMergeRequest).not.toHaveBeenCalled()
  })

  it('leaves the project out of rows inside a project', () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [createMergeRequest({ projectPath: 'team/desktop' })] }
      : emptyResult)
    const view = render(<MergeRequestList initialParams={{ projectId: '77', projectName: 'team/desktop' }} onOpenMergeRequest={vi.fn()} projectId="77" projectName="team/desktop" />)
    const results = screen.getByRole('list', { name: 'MR検索結果' })
    expect(within(results).getByText('!3')).toBeInTheDocument()
    expect(within(results).queryByText(/team\/desktop/u)).not.toBeInTheDocument()

    view.unmount()
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    expect(within(screen.getByRole('list', { name: 'MR検索結果' })).getByText('team/desktop !3')).toBeInTheDocument()
  })

  it('previews a row with Space without opening it, follows the focused row, and closes with Escape', () => {
    const onOpenMergeRequest = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [createMergeRequest({ description: '最初の説明', title: 'First' }), createMergeRequest({ description: '次の説明', id: 'mr-4', iid: '4', title: 'Second' })] }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={onOpenMergeRequest} />)

    const [first, second] = within(screen.getByRole('list', { name: 'MR検索結果' })).getAllByRole('button', { name: /First|Second/u })
    fireEvent.keyDown(first, { key: ' ' })
    fireEvent.keyUp(first, { key: ' ' })
    expect(screen.getByLabelText('!3の概要')).toHaveTextContent('最初の説明')
    expect(onOpenMergeRequest).not.toHaveBeenCalled()

    fireEvent.focus(second)
    expect(screen.getByLabelText('!4の概要')).toHaveTextContent('次の説明')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('!4の概要')).not.toBeInTheDocument()
  })

  it('splits the review queue by whether you approved, using one approvals request for the page', () => {
    const mergeRequests = [
      createMergeRequest({ id: 'mr-3', iid: '3', projectPath: 'team/desktop', title: 'Approved by me' }),
      createMergeRequest({ id: 'mr-4', iid: '4', projectPath: 'team/desktop', title: 'Approved by others' }),
      createMergeRequest({ id: 'mr-5', iid: '5', projectPath: 'team/desktop', title: 'Not approved' }),
    ]
    const approvalQueries: unknown[] = []
    const approvals = [
      { approvedBy: ['42', '9'], iid: '3', projectPath: 'team/desktop' },
      { approvedBy: ['9'], iid: '4', projectPath: 'team/desktop' },
      { approvedBy: [], iid: '5', projectPath: 'team/desktop' },
    ]
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => {
      if (query?.kind === 'mrs') return { ...emptyResult, data: mergeRequests }
      if (query?.kind === 'mrApprovals') {
        approvalQueries.push(query)
        return { ...emptyResult, data: approvals }
      }
      return emptyResult
    })
    render(<MergeRequestList initialParams={{ reviewer: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    expect(approvalQueries.at(-1)).toEqual({ items: [{ iid: '3', projectPath: 'team/desktop' }, { iid: '4', projectPath: 'team/desktop' }, { iid: '5', projectPath: 'team/desktop' }], kind: 'mrApprovals' })
    // One list with the section headings among the rows.
    const list = screen.getByRole('list', { name: 'MR検索結果' })
    expect(Array.from(list.querySelectorAll('h2'), (heading) => heading.textContent)).toEqual(['自分の承認待ち · 2件', '自分が承認済み · 1件'])
    expect(list.textContent?.replace(/\s+/gu, ' ')).toMatch(/自分の承認待ち · 2件.*Approved by others.*Not approved.*自分が承認済み · 1件.*Approved by me/u)
    expect(screen.getByLabelText('自分が承認済み', { selector: '[role="img"]' })).toBeInTheDocument()
    expect(screen.getByLabelText('1人が承認済み')).toBeInTheDocument()
    expect(screen.getByLabelText('未承認')).toBeInTheDocument()
  })

  it('shows rows while approvals load, groups them once approvals arrive, and falls back to a flat list when they fail', () => {
    const mergeRequests = [createMergeRequest({ projectPath: 'team/desktop' })]
    let approvals: object = { ...emptyResult, loading: true }
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: mergeRequests }
      : query?.kind === 'mrApprovals' ? approvals : emptyResult)
    const view = render(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)

    expect(within(screen.getByRole('list', { name: 'MR検索結果' })).getByText('Metadata preview')).toBeInTheDocument()
    expect(screen.getByLabelText('承認状態を確認中')).toBeInTheDocument()
    const row = screen.getByRole('list', { name: 'MR検索結果' }).querySelector<HTMLElement>('[data-list-row="true"]')
    row?.focus()

    approvals = { ...emptyResult, data: [{ approvedBy: [], iid: '3', projectPath: 'team/desktop' }] }
    view.rerender(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)
    const list = screen.getByRole('list', { name: 'MR検索結果' })
    expect(list.textContent).toMatch(/承認待ち · 1件.*Metadata preview/u)
    // Grouping keeps the row's element, so focus stays on it.
    expect(list.querySelector('[data-list-row="true"]')).toBe(row)
    expect(row).toHaveFocus()
    expect(screen.queryByLabelText('承認状態を確認中')).not.toBeInTheDocument()

    approvals = { ...emptyResult, error: new Error('graphql disabled') }
    view.rerender(<MergeRequestList initialParams={{ assignee: 'self', state: 'opened' }} onOpenMergeRequest={vi.fn()} />)
    expect(screen.getByRole('list', { name: 'MR検索結果' })).toBeInTheDocument()
    expect(screen.getByText('承認状態を取得できませんでした: graphql disabled')).toBeInTheDocument()
  })

  it('moves focus through MR rows with j/k and arrow keys without handling search input keys', () => {
    const mergeRequests = [createMergeRequest(), createMergeRequest({ id: 'mr-4', iid: '4', title: 'Second MR' })]
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: mergeRequests }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    const search = screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })
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
    fireEvent.keyDown(rows[0], { key: 'End' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
  })

  it('marks each row with its MR and keeps the MR just returned from selected', () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [createMergeRequest(), createMergeRequest({ id: 'mr-4', iid: '4', title: 'Second MR' })] }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} recentMrId="77-4" />)

    const rows = screen.getByRole('list', { name: 'MR検索結果' }).querySelectorAll<HTMLElement>('[data-list-row="true"]')
    expect([...rows].map((row) => row.dataset.mrId)).toEqual(['77-3', '77-4'])
    expect(rows[0]).not.toHaveAttribute('aria-current')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
  })

  it('labels the row time by the order, folds labels past three, and explains an empty result with a way back', () => {
    const labels = ['a', 'b', 'c', 'd', 'e']
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [createMergeRequest({ labels })] }
      : emptyResult)
    const view = render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    const results = screen.getByRole('list', { name: 'MR検索結果' })
    expect(within(results).getByText(/^更新 /u)).toBeInTheDocument()
    expect(within(results).getByText('c')).toBeInTheDocument()
    expect(within(results).queryByText('d')).not.toBeInTheDocument()
    expect(within(results).getByLabelText('+2 ほかのラベル: d, e')).toHaveTextContent('+2')
    // Default conditions offer nothing to clear.
    expect(screen.queryByRole('button', { name: '条件をクリア' })).not.toBeInTheDocument()

    view.unmount()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs' ? { ...emptyResult, data: [] } : emptyResult)
    const onSearchStateChange = vi.fn()
    render(<MergeRequestList initialParams={{ labels: 'bug', search: 'cache', state: 'merged' }} onOpenMergeRequest={vi.fn()} onSearchStateChange={onSearchStateChange} />)
    expect(screen.getByText('条件に一致するMRがありません')).toBeInTheDocument()
    expect(screen.getByText(/適用中の条件: 検索語: cache · 状態: Merged · ラベル: bug/u)).toBeInTheDocument()
    const [headerReset, emptyReset] = screen.getAllByRole('button', { name: '条件をクリア' })
    expect(headerReset).toBeInTheDocument()
    fireEvent.click(emptyReset)
    expect(latestHookMrsQuery()).toEqual({ kind: 'mrs', orderBy: 'updated_at', page: 1, search: '', sort: 'desc', state: 'all' })
    expect(onSearchStateChange).toHaveBeenLastCalledWith({ orderBy: 'updated_at', page: '1', sort: 'desc', state: 'all' })
  })

  it('names the reader\'s condition in an empty result and clears it with the others', () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs' ? { ...emptyResult, data: [] } : emptyResult)
    render(<MergeRequestList initialParams={{ reviewer: 'self', search: 'cache', state: 'merged' }} onOpenMergeRequest={vi.fn()} />)

    expect(screen.getByText(/検索語: cache · 状態: Merged · レビュアー: 自分/u)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '条件をクリア' })[0])
    expect(latestHookMrsQuery()).toEqual({ kind: 'mrs', orderBy: 'updated_at', page: 1, search: '', sort: 'desc', state: 'all' })
  })

  it('offers MR number search outside a project too', () => {
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }), { target: { value: '!123' } })
    expect(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })).toHaveAttribute('placeholder', 'タイトル・説明・MR番号（!123）を検索')
    expect(screen.queryByText('MR番号での検索はプロジェクト内で使えます')).not.toBeInTheDocument()
  })

  it('offers a retry beside saved results whose refresh failed, and closes a condition editor once applied', () => {
    const refresh = vi.fn()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => query?.kind === 'mrs'
      ? { ...emptyResult, data: [createMergeRequest()], error: new Error('offline'), refresh, stale: true }
      : emptyResult)
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(refresh).toHaveBeenCalled()

    addCondition('ラベル')
    fireEvent.change(screen.getByRole('textbox', { name: 'MRのラベル' }), { target: { value: 'bug' } })
    fireEvent.submit(screen.getByRole('textbox', { name: 'MRのラベル' }).closest('form') as HTMLFormElement)
    expect(latestHookMrsQuery()).toMatchObject({ labels: ['bug'] })
    expect(screen.queryByRole('dialog', { name: 'ラベルの条件' })).not.toBeInTheDocument()
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
    expect(buildQuery({ assignee: '', authorId: '', groupId: '', labels: '', orderBy: 'updated_at', page: 1, projectId: '12', reviewer: '', search: '', sourceBranch: '', sort: 'desc', state: 'all', targetBranch: '', updatedAfter: '', updatedBefore: '' }, '42')).toEqual({ kind: 'mrs', orderBy: 'updated_at', page: 1, projectId: '12', search: '', sort: 'desc', state: 'all' })
  })

  it('does not drop a self-assignee filter without the user id', () => {
    expect(() => buildQuery({ assignee: 'self', authorId: '', groupId: '', labels: '', orderBy: 'updated_at', page: 1, projectId: '', reviewer: '', search: '', sourceBranch: '', sort: 'desc', state: 'opened', targetBranch: '', updatedAfter: '', updatedBefore: '' })).toThrow('自分の担当MRを検索できません')
  })

  it('matches all comma-separated labels and includes exact branch filters', () => {
    expect(buildQuery({ assignee: '', authorId: '', groupId: 'team/platform', labels: 'bug, ready,bug', orderBy: 'updated_at', page: 1, projectId: '', reviewer: '', search: '', sourceBranch: 'feature/search', sort: 'desc', state: 'opened', targetBranch: 'main', updatedAfter: '', updatedBefore: '' }, '42')).toEqual({
      groupId: 'team/platform',
      kind: 'mrs',
      labels: ['bug', 'ready'],
      orderBy: 'updated_at',
      page: 1,
      search: '',
      sort: 'desc',
      sourceBranch: 'feature/search',
      state: 'opened',
      targetBranch: 'main',
    })
  })

  it('rejects a query that scopes to both a group and a project', () => {
    expect(() => buildQuery({ assignee: '', authorId: '', groupId: 'team/platform', labels: '', orderBy: 'updated_at', page: 1, projectId: '12', reviewer: '', search: '', sourceBranch: '', sort: 'desc', state: 'all', targetBranch: '', updatedAfter: '', updatedBefore: '' }, '42')).toThrow('グループとプロジェクトは同時に指定できません。')
  })
})
