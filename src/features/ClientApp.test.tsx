import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setLocalePreference } from '../i18n/i18n'
import { createAppTheme } from '../theme'
import type { GitLabSession, GitLabSnapshot, MergeRequest } from '../types/gitlab'
import { AutoUpdateSafetyProvider } from './shared/AutoUpdateSafety'
import { ClientApp } from './ClientApp'
import { reportGitLabConnectivity } from './connectivity'
import { clearComposerBufferStore, createComposerBufferKey, useComposerBuffer } from './mergeRequests/useComposerBuffer'
import { scopedKey } from './shared/preferences'

/** The chips that switch the MR list between the reader's own MRs. */
const ownMrs = () => within(screen.getByRole('group', { name: '自分のMR' }))
/** Which of the reader's own MRs the list shows; null for the search of every MR. */
function expectOwnMrs(shown: 'レビュー依頼' | '担当' | '作成' | null) {
  for (const name of ['レビュー依頼', '担当', '作成']) expect(ownMrs().getByRole('button', { name })).toHaveAttribute('aria-pressed', String(name === shown))
}

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
}))
vi.mock('./connections/connectionContext', async (importOriginal) => ({ ...await importOriginal<object>(), useConnection: () => connection }))
vi.mock('./shared/useGitLabQuery', () => ({ prefetchGitLabQuery: vi.fn(), useGitLabQuery: gitlabQueryMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => true }))
vi.mock('../lib/localRepository', async () => ({ ...await vi.importActual<typeof import('../lib/localRepository')>('../lib/localRepository'), getLocalScanFolders: async () => [] }))

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

it('keeps a user MR list and its filters when switching profile tabs and returning from an MR', async () => {
  window.history.replaceState(null, '', '#client/user?username=one&search=searchable')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    const data = query?.kind === 'user' ? sessionFixture.user
      : query?.kind === 'mrs' ? [mergeRequestFixture]
      : query?.kind === 'mr' ? mergeRequestFixture
      : query?.kind === 'userProjects' ? [] : null
    return { ...emptyQueryResult(), data, snapshot: data === null ? null : snapshot(data) }
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)
  expect(await screen.findByRole('tab', { name: '作成したMR' })).toHaveAttribute('aria-selected', 'true')
  expect(gitlabQueryMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ kind: 'mrs', authorId: '1', state: 'all', search: 'searchable' }), expect.anything())
  fireEvent.change(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }), { target: { value: 'searchable list' } })
  fireEvent.submit(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' }).closest('form')!)
  expect(window.location.hash).toContain('#client/user?')
  expect(new URLSearchParams(window.location.hash.split('?')[1]).get('username')).toBe('one')
  fireEvent.click(screen.getByRole('tab', { name: 'プロジェクト' }))
  expect(await screen.findByRole('tab', { name: 'プロジェクト' })).toHaveAttribute('aria-selected', 'true')
  expect(gitlabQueryMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ kind: 'userProjects', userId: '1' }), expect.anything())
  fireEvent.click(screen.getByRole('tab', { name: '作成したMR' }))
  expect(await screen.findByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })).toHaveValue('searchable list')
  fireEvent.click(document.querySelector('[data-screen-active="true"] [data-list-row="true"][data-mr-id="42-7"]')!)
  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '@oneに戻る' }))
  await waitFor(() => expect(window.location.hash).not.toContain('mr='))
  expect(screen.getByRole('tab', { name: '作成したMR' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'MRをタイトル・説明・MR番号で検索' })).toHaveValue('searchable list')
})

it('shows a missing user without fetching unscoped MRs or projects', () => {
  window.history.replaceState(null, '', '#client/user?username=missing')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'user'
    ? { ...emptyQueryResult(), snapshot: snapshot(null) } : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)
  expect(screen.getByText('ユーザーが見つかりません')).toBeInTheDocument()
  expect(gitlabQueryMock.mock.calls.some(([, query]) => query?.kind === 'userProjects' || query?.kind === 'mrs' && !query.reviewerId && !query.assigneeId && !query.authorId)).toBe(false)
})

it('retains the installation guard when authentication expiry resets the private workspace', async () => {
  let rejectInstall: (reason: Error) => void = () => undefined
  invokeMock.mockImplementation((command: string) => {
    if (command === 'check_app_update') return Promise.resolve({ configured: true, version: '0.2.0', notes: null })
    if (command === 'download_app_update') return Promise.resolve(null)
    if (command === 'install_app_update') return new Promise((_, reject) => { rejectInstall = reject })
    if (command === 'runtime_info') return Promise.resolve({ appVersion: '9.9.9', arch: 'x86_64', os: 'windows' })
    throw new Error(`Unexpected command: ${command}`)
  })
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>
  const view = render(app())
  expect(await screen.findByLabelText('アプリのバージョン 9.9.9')).toHaveTextContent('v9.9.9')
  // The footer offers the update on every screen; the settings show it too.
  fireEvent.click(await within(screen.getByRole('contentinfo')).findByRole('button', { name: '再起動して更新' }))
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
  expect(within(screen.getByRole('contentinfo')).getByText('download failed')).toBeInTheDocument()
})

it('waits for session restoration before choosing the default route', async () => {
  window.history.replaceState(null, '', '/')
  connection.session = null
  connection.status = 'checking'
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>
  const view = render(app())

  expect(window.location.hash).toBe('')
  expect(screen.getByText('GitLab接続を確認中…')).toBeInTheDocument()

  connection.session = sessionFixture
  connection.status = 'connected'
  view.rerender(app())

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs'))
  expect(screen.getByRole('button', { name: 'MR一覧' })).toHaveAttribute('aria-current', 'page')
  expectOwnMrs(null)
  expect(screen.queryByRole('button', { name: /UI catalog/u })).not.toBeInTheDocument()
  expect(screen.queryByText('GitLab workspace')).not.toBeInTheDocument()
  expect(screen.queryByText('自分の GitLab 作業を、軽く始める')).not.toBeInTheDocument()
})

it('maps a legacy home URL to the MR search, the first tab by default', async () => {
  window.history.replaceState(null, '', '#client/home')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs'))
  expectOwnMrs(null)
  expect(screen.queryByRole('button', { name: /ホーム/u })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /UI catalog/u })).not.toBeInTheDocument()
})

it('starts the MR list at the first tab in the reader order and searches all MRs with Ctrl+K', async () => {
  localStorage.setItem('gitlab-desktop:mr-hub-tab-order', JSON.stringify(['waiting', 'search']))
  try {
    window.history.replaceState(null, '', '#client/home')
    invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
    render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

    await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
    expectOwnMrs('レビュー依頼')

    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' })
    await waitFor(() => expect(window.location.hash).toBe('#client/mrs'))
  } finally {
    localStorage.removeItem('gitlab-desktop:mr-hub-tab-order')
  }
})

it('opens a legacy full-page MR link over the first MR list tab', async () => {
  window.history.replaceState(null, '', '#client/mr?iid=7&projectId=42')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?mr=42-7'))
  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs'))
  expectOwnMrs(null)
})

it('keeps the navigation as it is while an MR is open, and remembers one choice', async () => {
  localStorage.removeItem('gitlab-desktop:sidebar-collapsed')
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  expect(await screen.findByRole('button', { name: 'ナビゲーションを折りたたむ' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' }))
  expect(localStorage.getItem('gitlab-desktop:sidebar-collapsed')).toBe('true')

  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()
  localStorage.removeItem('gitlab-desktop:sidebar-collapsed')
})

it('shows an open MR in place of the list and returns to the list with Esc', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

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
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  await within(screen.getByRole('region', { name: '一覧' })).findByText('Second request')
  fireEvent.keyDown(window, { key: 'j' })
  fireEvent.keyDown(window, { key: 'j' })
  expect(document.activeElement).toHaveTextContent('Second request')
  fireEvent.keyDown(window, { key: 'k' })
  expect(document.activeElement).toHaveTextContent('Add searchable list')
  expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened')

  // An open menu keeps its letter keys.
  const menu = document.body.appendChild(document.createElement('div'))
  menu.setAttribute('role', 'menu')
  const item = menu.appendChild(document.createElement('button'))
  item.setAttribute('role', 'menuitem')
  item.focus()
  fireEvent.keyDown(item, { key: 'j' })
  expect(item).toHaveFocus()
  menu.remove()
})

it('keeps the list mounted and only toggles the selection parameter when opening an MR', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  fireEvent.change(screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' }), { target: { value: 'unsent draft' } })
  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7'))
  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })).toHaveValue('unsent draft')
})

it('returns to the list through history, so Back does not reopen the MR', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7'))
  fireEvent.click(await screen.findByRole('tab', { name: '変更' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7&tab=changes'))
  expect(window.history.state).toEqual({ depth: 2, list: '#client/mrs?reviewer=self&state=opened' })
  const entries = window.history.length

  // Two entries back to the list, not a third entry on top of the MR.
  fireEvent.click(screen.getByRole('button', { name: 'レビュー依頼に戻る' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(window.history.length).toBe(entries)
  expect(screen.queryByRole('button', { name: 'レビュー依頼に戻る' })).not.toBeInTheDocument()

  // Reached directly, the MR has no list behind it and the list is opened instead.
  act(() => {
    window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
    globalThis.dispatchEvent(new Event('gitlab-client-location-change'))
  })
  expect(await screen.findByRole('button', { name: 'レビュー依頼に戻る' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
})

it('opens an MR on its overview the first time and on the discussion after that', async () => {
  localStorage.removeItem(scopedKey({ instanceUrl: sessionFixture.instanceUrl, userId: sessionFixture.user.id }, 'personal-workspace'))
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>
  const first = render(app())
  expect(await screen.findByRole('tab', { name: '概要' })).toHaveAttribute('aria-selected', 'true')
  first.unmount()

  render(app())
  expect(await screen.findByRole('tab', { name: /議論/u })).toHaveAttribute('aria-selected', 'true')
  // The overview chosen by hand is named in the location, so Back returns to it.
  fireEvent.click(screen.getByRole('tab', { name: '概要' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7&tab=overview'))
  expect(screen.getByRole('tab', { name: '概要' })).toHaveAttribute('aria-selected', 'true')
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
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>
  render(app())

  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))

  // Returning goes back through history, which completes after the click.
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&search=needle'))
  expect(screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })).toHaveValue('needle')
  expectOwnMrs('レビュー依頼')
})

it.each([
  ['担当', '担当しているMR', 'page=1&state=opened&assignee=self&orderBy=updated_at&sort=desc', 'assigneeId'],
  ['作成', '作成したMR', 'page=1&state=opened&authorId=1&orderBy=updated_at&sort=desc', 'authorId'],
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
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(ownMrs().getByRole('button', { name: tab }))
  await waitFor(() => expect(window.location.hash).toBe(`#client/mrs?${queryString}`))
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  expectOwnMrs(tab)
  expect(gitlabQueryMock.mock.calls.some(([, query]) => query?.[queryKey] === '1')).toBe(true)

  // The list just left stays mounted, hidden, so only the shown one is searched.
  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' }).querySelector<HTMLElement>('[data-screen-active="true"]')!).findByText('Add searchable list'))
  // The open MR is marked by its sidebar tab, not by the list's place.
  expect(screen.getByRole('button', { name: 'MR一覧' })).not.toHaveAttribute('aria-current', 'page')

  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(window.location.hash).toBe(`#client/mrs?${queryString}`))
  expectOwnMrs(tab)
  expect(screen.getByRole('button', { name: 'MR一覧' })).toHaveAttribute('aria-current', 'page')
})

it('returns to the last MR list tab from the navigation', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(ownMrs().getByRole('button', { name: '担当' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?page=1&state=opened&assignee=self&orderBy=updated_at&sort=desc'))
  // Projects are a place of their own, without the MR list's chips.
  fireEvent.click(screen.getByRole('button', { name: 'プロジェクト' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/projects'))
  expect(screen.queryByRole('group', { name: '自分のMR' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'MR一覧' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?page=1&state=opened&assignee=self&orderBy=updated_at&sort=desc'))
  expectOwnMrs('担当')
})

it('opens the project screen from an MR and names where Back returns to', async () => {
  window.history.replaceState(null, '', '#client/mrs?assignee=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const withPath = { ...mergeRequestFixture, projectPath: 'group/project' }
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: withPath, snapshot: snapshot(withPath) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  expect(await screen.findByRole('button', { name: '担当に戻る' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'group/project' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/overview?projectId=42&projectName=group%2Fproject'))
  expect(screen.getByRole('tab', { name: '概要' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('heading', { name: 'group/projectの概要' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'プロジェクト' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('group', { name: '自分のMR' })).not.toBeInTheDocument()
})

it('switches a project screen between its MRs and branches, and shows the MRs of a branch', async () => {
  window.history.replaceState(null, '', '#client/mrs?projectId=42&projectName=group%2Fproject')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const branch = { commit: null, default: false, merged: false, name: 'feature/search', protected: false, webUrl: '' }
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'branches'
    ? { ...emptyQueryResult(), data: [branch], snapshot: snapshot([branch]) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  expect(screen.getByRole('tab', { name: 'MR' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: 'ブランチ' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/branches?projectId=42&projectName=group%2Fproject'))
  expect(screen.getByRole('button', { name: 'プロジェクト' })).toHaveAttribute('aria-current', 'page')
  expect(gitlabQueryMock.mock.calls.some(([, query]) => query?.kind === 'branches' && query.projectId === '42')).toBe(true)

  fireEvent.click(await screen.findByRole('button', { name: 'feature/searchのMRを表示' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?projectId=42&projectName=group%2Fproject&sourceBranch=feature%2Fsearch&state=all'))
  expect(screen.getByRole('tab', { name: 'MR' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('ブランチ: feature/search')).toBeInTheDocument()

  // Choosing MR again returns to all the project's MRs.
  fireEvent.click(screen.getByRole('tab', { name: 'MR' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?projectId=42&projectName=group%2Fproject'))
  // The branch's MRs stay mounted for a quick return, hidden.
  expect(screen.getByText('ブランチ: feature/search')).not.toBeVisible()
})

it('keeps the account, theme and connection in one settings entry', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const onColorPreferenceChange = vi.fn()
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={onColorPreferenceChange} /></ThemeProvider>)

  expect(screen.queryByRole('button', { name: /モードに切り替え/u })).not.toBeInTheDocument()
  const settings = screen.getByRole('button', { name: '@one · 設定' })
  expect(settings).toHaveTextContent('@one')
  fireEvent.click(settings)
  await waitFor(() => expect(window.location.hash).toBe('#client/settings'))
  expect(screen.getByRole('heading', { name: '設定' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'ダーク' }))
  expect(onColorPreferenceChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'ライト' }))
  expect(onColorPreferenceChange).toHaveBeenLastCalledWith('light')
  fireEvent.click(screen.getByRole('button', { name: 'システムに合わせる' }))
  expect(onColorPreferenceChange).toHaveBeenLastCalledWith('system')
  expect(screen.getByRole('heading', { name: '自動取得と通知' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'アプリの更新' })).toBeInTheDocument()
})

it('switches the settings page to the chosen language', async () => {
  window.history.replaceState(null, '', '#client/settings')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={vi.fn()} /></ThemeProvider>)

  expect(await screen.findByRole('heading', { name: '設定' })).toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '言語' }))
  fireEvent.click(screen.getByRole('option', { name: 'English' }))

  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Match system' })).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('en')
  await act(() => setLocalePreference('ja'))
})

it.each(['#client/pinned', '#client/recent'])('starts the MR list for the former list link %s', async (hash) => {
  window.history.replaceState(null, '', hash)
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs'))
  expectOwnMrs(null)
})

it('moves back and forward with the mouse side buttons without moving twice', async () => {
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
  const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined)
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

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
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' }))

  expect(screen.getByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'MR一覧' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'プロジェクト' })).toBeInTheDocument()
})

it('keeps the navigation folded while the notifications are open', async () => {
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  localStorage.removeItem('gitlab-desktop:sidebar-collapsed')
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' }))
  const aside = screen.getByRole('complementary')
  const peekDelay = () => act(() => new Promise((resolve) => globalThis.setTimeout(resolve, 400)))

  // Resting on the notification button does not unfold the navigation; resting elsewhere in it does.
  fireEvent.mouseOver(screen.getByRole('button', { name: '通知' }))
  await peekDelay()
  expect(screen.queryByText('GitLab Desktop')).not.toBeInTheDocument()
  fireEvent.mouseOver(screen.getByRole('button', { name: 'MR一覧' }))
  await peekDelay()
  expect(screen.getByText('GitLab Desktop')).toBeInTheDocument()

  // Opening the notifications folds it, and the panel's own pointer events (a portal's still
  // reach the navigation) do not unfold it while they are open.
  fireEvent.click(screen.getByRole('button', { name: '通知' }))
  expect(screen.queryByText('GitLab Desktop')).not.toBeInTheDocument()
  fireEvent.mouseOver(screen.getByRole('dialog', { name: '通知' }))
  await peekDelay()
  expect(screen.queryByText('GitLab Desktop')).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('dialog', { name: '通知' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '通知' })).not.toBeInTheDocument())
  fireEvent.mouseLeave(aside)
  localStorage.removeItem('gitlab-desktop:sidebar-collapsed')
})

it('keeps places in the navigation, the reader\'s own MRs in chips, and opening by URL beside the title', () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  const navigation = screen.getByRole('navigation', { name: 'GitLab client navigation' })
  expect(within(within(navigation).getAllByRole('list')[0]).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['MR一覧', 'プロジェクト'])
  // Notifications open over the page from their own button, not as a place.
  expect(screen.getByRole('button', { name: '通知' })).toHaveAttribute('aria-haspopup', 'dialog')
  expect(ownMrs().getAllByRole('button').map((chip) => chip.textContent)).toEqual(['レビュー依頼', '担当', '作成'])
  expect(within(navigation).queryByRole('button', { name: 'MR検索' })).not.toBeInTheDocument()
  expect(within(navigation).queryByRole('button', { name: 'GitLabのURLから開く' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'GitLabのURLから開く' }))
  expect(screen.getByRole('dialog', { name: 'GitLabのURLから開く' })).toBeInTheDocument()
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
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

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
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

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

it('leaves Ctrl+K and Esc to the composer and lists the shortcuts with ?', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)
  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()

  const comment = document.createElement('textarea')
  const toolbar = document.createElement('div')
  toolbar.setAttribute('role', 'toolbar')
  const bold = document.createElement('button')
  toolbar.append(bold)
  document.body.append(comment, toolbar)
  try {
    fireEvent.keyDown(comment, { ctrlKey: true, key: 'k' })
    fireEvent.keyDown(bold, { key: 'Escape' })
    await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
    expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7')

    fireEvent.keyDown(comment, { key: '?' })
    expect(screen.queryByRole('dialog', { name: 'キーボードショートカット' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: '?' })
    const dialog = await screen.findByRole('dialog', { name: 'キーボードショートカット' })
    expect(within(dialog).getByText('すべてのMRを検索')).toBeInTheDocument()
  } finally {
    comment.remove()
    toolbar.remove()
  }
})

it('returns the focus to the MR row it was opened from', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.mrId).toBe('42-7'))
})

it.each([
  ['FORBIDDEN', '権限がありません'],
  ['NOT_FOUND', 'MRが見つかりません'],
  ['NETWORK', 'GitLabに接続できません'],
] as const)('explains an MR that cannot open (%s) and retries it', async (code, title) => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  const refresh = vi.fn()
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), error: { code, message: 'GitLabの応答' }, refresh }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  const detail = screen.getByRole('main')
  expect(await within(detail).findByText(title)).toBeInTheDocument()
  fireEvent.click(within(detail).getByRole('button', { name: '再試行' }))
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('keeps the screen and its URL when the token expires, and offers reconnecting in place', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened&mr=42-7')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  connection.session = null
  connection.status = 'disconnected'
  Object.assign(connection, { reauthRequired: { instanceUrl: 'https://gitlab.com', username: 'one' } })
  try {
    render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

    expect(screen.getByRole('button', { name: '再接続' })).toBeInTheDocument()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 20))
    expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7')
    expect(screen.getByRole('button', { name: 'MR一覧' })).toHaveClass('Mui-disabled')
    expect(within(screen.getByRole('contentinfo')).getByText(/再認証が必要です/u)).toBeInTheDocument()
  } finally {
    Object.assign(connection, { reauthRequired: null })
  }
})

it('shows the restore state at startup even when the window opens on a screen', () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  connection.session = null
  connection.status = 'checking'
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  expect(screen.getByText('GitLab接続を確認中…')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'GitLab URL' })).not.toBeInTheDocument()
  expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened')
})

it('turns the footer amber while GitLab cannot be reached and green again after a success', () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getByText(/^接続済み/u)).toBeInTheDocument()

  act(() => reportGitLabConnectivity({ code: 'NETWORK' }, true))
  expect(within(footer).getByText(/GitLabに接続できません · 保存済みデータを表示中/u)).toBeInTheDocument()
  // A denied resource still means GitLab answered; it does not change reachability.
  act(() => reportGitLabConnectivity({ code: 'FORBIDDEN' }))
  expect(within(footer).getByText(/GitLabに接続できません/u)).toBeInTheDocument()
  act(() => reportGitLabConnectivity(null))
  expect(within(footer).getByText(/^接続済み/u)).toBeInTheDocument()
})

it('keeps the MR list mounted when it applies a search itself', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  const search = screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })
  fireEvent.change(search, { target: { value: 'needle' } })
  fireEvent.submit(search.closest('form')!)
  await waitFor(() => expect(window.location.hash).toContain('search=needle'))
  expect(screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })).toBe(search)

  // Switching to the reader's other MRs changes one condition in the same list and keeps the text.
  fireEvent.click(ownMrs().getByRole('button', { name: '担当' }))
  await waitFor(() => expect(window.location.hash).toContain('assignee=self'))
  expect(window.location.hash).toContain('search=needle')
  expect(window.location.hash).not.toContain('reviewer=')
  expect(screen.getByRole('combobox', { name: '担当しているMRをタイトル・説明・MR番号で検索' })).toBe(search)
})

it('shows a list and an MR visited before as they were left, without building them again', async () => {
  window.history.replaceState(null, '', '#client/mrs?reviewer=self&state=opened')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => {
    if (query?.kind === 'mrs') return { ...emptyQueryResult(), data: [mergeRequestFixture], snapshot: snapshot([mergeRequestFixture]) }
    if (query?.kind === 'mr') return { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    return emptyQueryResult()
  })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp colorPreference="dark" onColorPreferenceChange={() => undefined} /></ThemeProvider>)

  // Text typed but not applied survives a visit to another place.
  const search = screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })
  fireEvent.change(search, { target: { value: 'typed' } })
  fireEvent.click(screen.getByRole('button', { name: /設定$/u }))
  await waitFor(() => expect(window.location.hash).toBe('#client/settings'))
  expect(search).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'MR一覧' }))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('combobox', { name: 'レビュー依頼をタイトル・説明・MR番号で検索' })).toBe(search)
  expect(search).toHaveValue('typed')

  // An MR opened again is the same rendered page.
  fireEvent.click(await within(screen.getByRole('region', { name: '一覧' })).findByText('Add searchable list'))
  const heading = await screen.findByRole('heading', { level: 1, name: 'Add searchable list' })
  fireEvent.click(await screen.findByRole('button', { name: /に戻る$/u }))
  await waitFor(() => expect(heading).not.toBeVisible())
  fireEvent.click(within(screen.getByRole('region', { name: '一覧' })).getByText('Add searchable list'))
  await waitFor(() => expect(heading).toBeVisible())
  expect(screen.getByRole('heading', { level: 1, name: 'Add searchable list' })).toBe(heading)
})
