import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppTheme } from '../theme'
import type { GitLabSession, GitLabSnapshot, MergeRequest } from '../types/gitlab'
import { AutoUpdateSafetyProvider } from './shared/AutoUpdateSafety'
import { ClientApp } from './ClientApp'
import { clearComposerBufferStore, createComposerBufferKey, useComposerBuffer } from './mergeRequests/useComposerBuffer'

const { connection, gitlabQueryMock, invokeMock } = vi.hoisted(() => ({
  connection: {
    session: null as GitLabSession | null,
    status: 'idle',
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    restore: vi.fn(),
  },
  gitlabQueryMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('./connections/ConnectionProvider', () => ({
  ConnectionProvider: ({ children }: { children: ReactNode }) => children,
  useConnection: () => connection,
}))
vi.mock('./shared/useGitLabQuery', () => ({ useGitLabQuery: gitlabQueryMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => true }))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.com', serverVersion: null, user: { id: '1', name: 'One', username: 'one' } }
const mergeRequestFixture: MergeRequest = {
  author: { id: '2', name: 'Reviewer', username: 'reviewer' },
  description: 'Details for a route restoration test.',
  diffRefs: { baseSha: 'base', headSha: 'head', startSha: 'start' },
  headSha: 'head',
  id: 'mr-7',
  iid: '7',
  projectId: '42',
  sourceBranch: 'feature/search',
  state: 'opened',
  targetBranch: 'main',
  title: 'Add searchable list',
  updatedAt: '2026-09-30T12:00:00.000Z',
  webUrl: 'https://gitlab.com/group/project/-/merge_requests/7',
}

beforeEach(() => {
  window.history.replaceState(null, '', '#client/settings')
  invokeMock.mockReset()
  gitlabQueryMock.mockReset().mockImplementation(() => emptyQueryResult())
  connection.session = sessionFixture
  connection.status = 'connected'
})
afterEach(() => window.history.replaceState(null, '', '/'))

function emptyQueryResult() {
  return { data: null, error: null, loading: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false }
}

function snapshot<T>(data: T): GitLabSnapshot<T> {
  return { completeness: 'complete', data, fetchedAt: Date.now(), nextPage: null, source: 'network' }
}

function ComposerProbe() {
  const buffer = useComposerBuffer(createComposerBufferKey(connection.session, 'project-1', '7', 'new'))
  return <textarea aria-label="retained body" onChange={(event) => buffer.change(event.target.value)} value={buffer.body} />
}

it('retains the installation guard when authentication expiry resets the private workspace', async () => {
  let rejectInstall: (reason: Error) => void = () => undefined
  invokeMock.mockImplementation((command: string) => {
    if (command === 'check_app_update') return Promise.resolve({ configured: true, version: '0.2.0', notes: null })
    if (command === 'install_app_update') return new Promise((_, reject) => { rejectInstall = reject })
    if (command === 'runtime_info') return Promise.resolve({ appVersion: '9.9.9', arch: 'x86_64', os: 'windows' })
    throw new Error(`Unexpected command: ${command}`)
  })
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>
  const view = render(app())
  expect(await screen.findByLabelText('アプリのバージョン 9.9.9')).toHaveTextContent('v9.9.9')
  fireEvent.click(await screen.findByRole('button', { name: '更新をインストール' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()

  connection.session = null
  connection.status = 'idle'
  view.rerender(app())
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'GitLab URL' })).not.toBeInTheDocument()
  expect(invokeMock.mock.calls.filter(([command]) => command === 'check_app_update')).toHaveLength(1)

  await act(async () => rejectInstall(new Error('download failed')))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('textbox', { name: 'GitLab URL' })).toBeInTheDocument()
  expect(screen.getByText('download failed')).toBeInTheDocument()
})

it('waits for session restoration before choosing the default route', async () => {
  window.history.replaceState(null, '', '/')
  connection.session = null
  connection.status = 'checking'
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>
  const view = render(app())

  expect(window.location.hash).toBe('')
  expect(screen.getByText('GitLab接続を確認中…')).toBeInTheDocument()

  connection.session = sessionFixture
  connection.status = 'connected'
  view.rerender(app())

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('button', { name: 'MR一覧' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('tab', { name: 'レビュー依頼' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('button', { name: /UI catalog/u })).not.toBeInTheDocument()
  expect(screen.queryByText('GitLab workspace')).not.toBeInTheDocument()
  expect(screen.queryByText('自分の GitLab 作業を、軽く始める')).not.toBeInTheDocument()
})

it('maps a legacy home URL to the authenticated review queue', async () => {
  window.history.replaceState(null, '', '#client/home')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('tab', { name: 'レビュー依頼' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('button', { name: /ホーム/u })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /UI catalog/u })).not.toBeInTheDocument()
})

it('opens a legacy full-page MR link over the review queue', async () => {
  window.history.replaceState(null, '', '#client/mr?iid=7&projectId=42')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7'))
  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('tab', { name: 'レビュー依頼' })).toHaveAttribute('aria-selected', 'true')
})

it('shrinks the navigation while an MR is open and remembers each choice', async () => {
  localStorage.removeItem('gitlab-desktop:sidebar-collapsed')
  localStorage.removeItem('gitlab-desktop:sidebar-collapsed-reviewing')
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  expect(await screen.findByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを展開' }))
  expect(localStorage.getItem('gitlab-desktop:sidebar-collapsed-reviewing')).toBe('false')

  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' })).toBeInTheDocument()
  expect(localStorage.getItem('gitlab-desktop:sidebar-collapsed')).toBeNull()
})

it('shows an open MR in place of the list and returns to the list with Esc', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()
  expect(document.querySelector('[data-list-pane]')).not.toBeVisible()
  expect(screen.queryByRole('button', { name: '一覧を隠す' })).not.toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('region', { name: '一覧' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /に戻る$/u })).not.toBeInTheDocument()
})

it('moves the focus through the list with J and K without opening an MR', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const second = { ...mergeRequestFixture, id: 'mr-8', iid: '8', title: 'Second request' }
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mrs'
    ? { ...emptyQueryResult(), data: [mergeRequestFixture, second], snapshot: snapshot([mergeRequestFixture, second]) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  await within(screen.getByRole('region', { name: '一覧' })).findByText('Second request')
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'j' })
  expect(document.activeElement).toHaveTextContent('Second request')
  fireEvent.keyDown(window, { key: 'k' })
  expect(document.activeElement).toHaveTextContent('Add searchable list')
  expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened')
})

it('keeps the list mounted and only toggles the selection parameter when opening an MR', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.change(screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' }), { target: { value: 'unsent draft' } })
  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7'))
  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' })).toHaveValue('unsent draft')
})

it('preserves MR search filters when returning from an opened request', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&search=needle')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') {
      return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    }
    if (query?.kind === 'mr') {
      return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    }
    return emptyQueryResult()
  })
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>
  render(app())

  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))

  await waitFor(() => expect(window.location.hash).toContain('reviewer=self&state=opened&search=needle'))
  expect(screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' })).toHaveValue('needle')
  expect(screen.getByRole('tab', { name: 'レビュー依頼' })).toHaveAttribute('aria-selected', 'true')
})

it.each([
  ['担当', '担当しているMR', 'assignee=self&state=opened', 'assigneeId'],
  ['作成', '作成したMR', 'authorId=1&state=opened', 'authorId'],
] as const)('opens and returns to the %s tab without selecting MR search', async (tab, heading, queryString, queryKey) => {
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string; assigneeId?: string; authorId?: string } | null) => {
    if (query?.kind === 'mrs') {
      return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    }
    if (query?.kind === 'mr') {
      return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    }
    return emptyQueryResult()
  })
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(screen.getByRole('tab', { name: tab }))
  await waitFor(() => expect(window.location.hash).toBe(`#client/mrs?${queryString}`))
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
  expect(gitlabQueryMock.mock.calls.some(([, query]) => query?.[queryKey] === '1')).toBe(true)

  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  // The open MR is marked by its sidebar tab, not by the list's place.
  expect(screen.getByRole('button', { name: 'MR一覧' })).not.toHaveAttribute('aria-current', 'page')

  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe(`#client/mrs?${queryString}`))
  expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'MR一覧' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('tab', { name: '検索' })).toHaveAttribute('aria-selected', 'false')
})

it('returns to the last MR list tab from the navigation', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(screen.getByRole('tab', { name: 'To-Do' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/todos'))
  fireEvent.click(screen.getByRole('button', { name: 'プロジェクト' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/projects'))
  expect(screen.queryByRole('tab', { name: 'To-Do' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'MR一覧' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/todos'))
  expect(screen.getByRole('tab', { name: 'To-Do' })).toHaveAttribute('aria-selected', 'true')
})

it('opens the project screen from an MR and names where Back returns to', async () => {
  window.history.replaceState(null, '', '#client/mrs?assignee=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const withPath = { ...mergeRequestFixture, projectPath: 'group/project' }
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: withPath, snapshot: snapshot(withPath) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  expect(await screen.findByRole('button', { name: '担当に戻る' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'group/project' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?projectId=42&projectName=group%2Fproject'))
  expect(screen.getByRole('heading', { name: 'group/project' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'プロジェクト' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('tablist', { name: 'MR一覧の切り替え' })).not.toBeInTheDocument()
})

it('switches a project screen between its MRs and branches, and shows the MRs of a branch', async () => {
  window.history.replaceState(null, '', '#client/mrs?projectId=42&projectName=group%2Fproject')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const branch = { commit: null, default: false, merged: false, name: 'feature/search', protected: false, webUrl: '' }
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'branches'
    ? { ...emptyQueryResult(), data: [branch], snapshot: snapshot([branch]) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  expect(screen.getByRole('tab', { name: 'MR' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: 'ブランチ' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/branches?projectId=42&projectName=group%2Fproject'))
  expect(screen.getByRole('button', { name: 'プロジェクト' })).toHaveAttribute('aria-current', 'page')
  expect(gitlabQueryMock.mock.calls.some(([, query]) => query?.kind === 'branches' && query.projectId === '42')).toBe(true)

  fireEvent.click(await screen.findByRole('button', { name: 'feature/searchのMRを表示' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?projectId=42&projectName=group%2Fproject&sourceBranch=feature%2Fsearch&state=all'))
  expect(screen.getByRole('tab', { name: 'MR' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: 'MRのソースブランチ' })).toHaveValue('feature/search')
})

it('keeps the account, theme and connection in one settings entry', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const onModeChange = vi.fn()
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={onModeChange} /></ThemeProvider>)

  expect(screen.queryByRole('button', { name: /モードに切り替え/u })).not.toBeInTheDocument()
  const settings = screen.getByRole('button', { name: '設定' })
  expect(settings).toHaveTextContent('@one')
  fireEvent.click(settings)
  await waitFor(() => expect(window.location.hash).toBe('#client/settings'))
  expect(screen.getByRole('heading', { name: '設定' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'ダーク' }))
  expect(onModeChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'ライト' }))
  expect(onModeChange).toHaveBeenCalledTimes(1)
})

it('shows the history for a former pinned-list link', async () => {
  window.history.replaceState(null, '', '#client/pinned')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/recent'))
  expect(screen.getByRole('tab', { name: '最近開いた' })).toHaveAttribute('aria-selected', 'true')
})

it('moves back and forward with the mouse side buttons without moving twice', async () => {
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
  const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined)
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.mouseUp(window, { button: 3 })
  await waitFor(() => expect(back).toHaveBeenCalledTimes(1))
  fireEvent.mouseUp(window, { button: 4 })
  await waitFor(() => expect(forward).toHaveBeenCalledTimes(1))

  // The WebView already went back on its own.
  fireEvent.mouseUp(window, { button: 3 })
  fireEvent.popState(window)
  await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  expect(back).toHaveBeenCalledTimes(1)
})

it('keeps the collapsed navigation controls accessible', () => {
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' }))

  expect(screen.getByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'MR一覧' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'プロジェクト' })).toBeInTheDocument()
})

it('keeps places in the navigation, the MR lists in tabs, and opening by URL beside the tabs', () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  const navigation = screen.getByRole('navigation', { name: 'GitLab client navigation' })
  expect(within(within(navigation).getAllByRole('list')[0]).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['MR一覧', 'プロジェクト'])
  expect(within(screen.getByRole('tablist', { name: 'MR一覧の切り替え' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['レビュー依頼', '担当', '作成', 'To-Do', '最近開いた', '検索'])
  expect(within(navigation).queryByRole('button', { name: 'MR検索' })).not.toBeInTheDocument()
  expect(within(navigation).queryByRole('button', { name: 'MR URLから開く' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'MR URLから開く' }))
  expect(screen.getByRole('dialog', { name: 'MR URLから開く' })).toBeInTheDocument()
})

it('clears in-memory composer buffers after an explicit logout event', () => {
  clearComposerBufferStore()
  const probe = render(<AutoUpdateSafetyProvider><ComposerProbe /></AutoUpdateSafetyProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'retained body' }), { target: { value: '明示切断前の本文' } })

  invokeMock.mockImplementation((command: string) => {
    if (command === 'check_app_update') return Promise.resolve({ configured: false, version: null, notes: null })
    if (command === 'runtime_info') return Promise.resolve({ appVersion: '9.9.9', arch: 'x86_64', os: 'windows' })
    throw new Error(`Unexpected command: ${command}`)
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  act(() => globalThis.dispatchEvent(new Event('gitlab-explicit-logout')))

  expect(screen.getByRole('textbox', { name: 'retained body' })).toHaveValue('')
  fireEvent.change(screen.getByRole('textbox', { name: 'retained body' }), { target: { value: '新しい本文' } })
  expect(screen.getByRole('textbox', { name: 'retained body' })).toHaveValue('新しい本文')
  probe.unmount()
  clearComposerBufferStore()
})

it('clears in-memory composer buffers after an account replacement event', () => {
  clearComposerBufferStore()
  const probe = render(<AutoUpdateSafetyProvider><ComposerProbe /></AutoUpdateSafetyProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'retained body' }), { target: { value: '別アカウントへ切り替える本文' } })

  invokeMock.mockImplementation((command: string) => {
    if (command === 'check_app_update') return Promise.resolve({ configured: false, version: null, notes: null })
    if (command === 'runtime_info') return Promise.resolve({ appVersion: '9.9.9', arch: 'x86_64', os: 'windows' })
    throw new Error(`Unexpected command: ${command}`)
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  act(() => globalThis.dispatchEvent(new Event('gitlab-account-replaced')))

  expect(screen.getByRole('textbox', { name: 'retained body' })).toHaveValue('')
  probe.unmount()
  clearComposerBufferStore()
})

it('preserves composer text when same-account reauthentication emits no replacement event', () => {
  clearComposerBufferStore()
  const probe = render(<AutoUpdateSafetyProvider><ComposerProbe /></AutoUpdateSafetyProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'retained body' }), { target: { value: '同一アカウントで保持する本文' } })

  connection.session = { ...connection.session!, id: 'session-reauthenticated' }
  probe.rerender(<AutoUpdateSafetyProvider><ComposerProbe /></AutoUpdateSafetyProvider>)

  expect(screen.getByRole('textbox', { name: 'retained body' })).toHaveValue('同一アカウントで保持する本文')
  probe.unmount()
  clearComposerBufferStore()
})
