import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    throw new Error(`Unexpected command: ${command}`)
  })
  const app = () => <ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>
  const view = render(app())
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
  expect(screen.getByRole('button', { name: 'レビュー待ち' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: /UI catalog/u })).not.toBeInTheDocument()
  expect(screen.queryByText('GitLab workspace')).not.toBeInTheDocument()
  expect(screen.queryByText('自分の GitLab 作業を、軽く始める')).not.toBeInTheDocument()
})

it('maps a legacy home URL to the authenticated review queue', async () => {
  window.history.replaceState(null, '', '#client/home')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened'))
  expect(screen.getByRole('button', { name: 'レビュー待ち' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: /ホーム/u })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /UI catalog/u })).not.toBeInTheDocument()
})

it('opens a legacy full-page MR link beside the review queue', async () => {
  window.history.replaceState(null, '', '#client/mr?iid=7&projectId=42')
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  gitlabQueryMock.mockImplementation((_sessionId: string | null, query: { kind?: string } | null) => query?.kind === 'mr'
    ? { ...emptyQueryResult(), data: mergeRequestFixture, snapshot: snapshot(mergeRequestFixture) }
    : emptyQueryResult())
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7'))
  expect(await screen.findByRole('heading', { name: 'Add searchable list' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'レビュー待ち' })).toHaveAttribute('aria-current', 'page')
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
  fireEvent.click(await screen.findByText('Add searchable list'))
  await waitFor(() => expect(window.location.hash).toBe('#client/mrs?reviewer=self&state=opened&mr=42-7'))
  fireEvent.click(await screen.findByRole('button', { name: '一覧に戻る' }))
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

  fireEvent.click(await screen.findByText('Add searchable list'))
  fireEvent.click(await screen.findByRole('button', { name: '一覧に戻る' }))

  await waitFor(() => expect(window.location.hash).toContain('reviewer=self&state=opened&search=needle'))
  expect(screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' })).toHaveValue('needle')
  expect(screen.getByRole('button', { name: 'レビュー待ち' })).toHaveAttribute('aria-current', 'page')
})

it.each([
  ['自分の担当MR', 'assignee=self&state=opened', 'assigneeId'],
  ['自分が作成', 'authorId=1&state=opened', 'authorId'],
] as const)('opens and returns to the %s queue without highlighting MR search', async (label, queryString, queryKey) => {
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
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(screen.getByRole('button', { name: label }))
  await waitFor(() => expect(window.location.hash).toBe(`#client/mrs?${queryString}`))
  expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
  expect(gitlabQueryMock.mock.calls.some(([, query]) => query?.[queryKey] === '1')).toBe(true)

  fireEvent.click(await screen.findByText('Add searchable list'))
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'MR検索' })).not.toHaveAttribute('aria-current', 'page')

  fireEvent.click(await screen.findByRole('button', { name: '一覧に戻る' }))
  await waitFor(() => expect(window.location.hash).toBe(`#client/mrs?${queryString}`))
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'MR検索' })).not.toHaveAttribute('aria-current', 'page')
})

it('keeps the collapsed navigation controls accessible', () => {
  invokeMock.mockResolvedValue({ configured: false, version: null, notes: null })
  render(<ThemeProvider theme={createAppTheme('dark')}><ClientApp mode="dark" onModeChange={() => undefined} /></ThemeProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'ナビゲーションを折りたたむ' }))

  expect(screen.getByRole('button', { name: 'ナビゲーションを展開' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'レビュー待ち' })).toBeInTheDocument()
})

it('clears in-memory composer buffers after an explicit logout event', () => {
  clearComposerBufferStore()
  const probe = render(<AutoUpdateSafetyProvider><ComposerProbe /></AutoUpdateSafetyProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'retained body' }), { target: { value: '明示切断前の本文' } })

  invokeMock.mockImplementation((command: string) => {
    if (command === 'check_app_update') return Promise.resolve({ configured: false, version: null, notes: null })
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
