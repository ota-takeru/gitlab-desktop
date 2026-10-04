import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPreferences, readPinnedProjectIds, readRecentProjectIds, readSavedSearches, writePinnedProjectIds, writeRecentProjectIds, writeSavedSearches } from '../shared/preferences'
import { ConnectionProvider, useConnection } from './ConnectionProvider'
import { ConnectionView } from './ConnectionView'
import type { GitLabSession } from '../../types/gitlab'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__),
}))

const gitlabComSession: GitLabSession = {
  id: 'session-gitlab-com',
  instanceUrl: 'https://gitlab.com',
  user: { id: '42', username: 'reviewer', name: 'Review User' },
  serverVersion: '18.0.0',
}

function setTauriEnvironment(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    return
  }
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  Reflect.deleteProperty(window, '__TAURI__')
}

function ConnectionHarness() {
  const { connect, disconnect, error, restore, session, status } = useConnection()

  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="instance-url">{session?.instanceUrl ?? ''}</output>
      <output data-testid="error-code">{error?.code ?? ''}</output>
      <button onClick={() => void restore()}>restore</button>
      <button onClick={() => void connect({ token: 'fixture-token', url: 'https://gitlab.com' })}>connect</button>
      <button onClick={() => void disconnect()}>disconnect</button>
    </div>
  )
}

function renderConnectionView() {
  return render(
    <ConnectionProvider>
      <ConnectionView />
    </ConnectionProvider>,
  )
}

function mockDefaultCommands() {
  invokeMock.mockImplementation((command: string, args?: { input?: { url?: string } }) => {
    if (command === 'restore_session') return Promise.resolve(null)
    if (command === 'connect_gitlab') {
      const url = args?.input?.url ?? gitlabComSession.instanceUrl
      return Promise.resolve({ ...gitlabComSession, instanceUrl: url })
    }
    if (command === 'disconnect_gitlab') return Promise.resolve(undefined)
    throw new Error(`Unexpected IPC command: ${command}`)
  })
}

describe('GitLab connection IPC and lifecycle', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    setTauriEnvironment(true)
    localStorage.clear()
    mockDefaultCommands()
  })

  it('restores a typed saved session through the Rust IPC command', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent('https://gitlab.com')
    expect(screen.getByTestId('error-code')).toHaveTextContent('')
  })

  it('ignores an auth-required event for a different session', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    act(() => {
      window.dispatchEvent(new CustomEvent('gitlab-auth-required', { detail: { sessionId: 'other-session' } }))
    })

    expect(screen.getByTestId('status')).toHaveTextContent('connected')
    expect(screen.getByTestId('instance-url')).toHaveTextContent(gitlabComSession.instanceUrl)
    expect(screen.getByTestId('error-code')).toHaveTextContent('')
  })

  it('logs out and clears account preferences for a matching auth-required event', async () => {
    const scope = { instanceUrl: gitlabComSession.instanceUrl, userId: gitlabComSession.user.id }
    writePinnedProjectIds(scope, ['project-1'])
    writeRecentProjectIds(scope, ['project-2'])
    writeSavedSearches(scope, [{ id: 'search-1', label: 'Mine', query: 'is:opened', state: 'opened' }])
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))

    act(() => {
      window.dispatchEvent(new CustomEvent('gitlab-auth-required', { detail: { sessionId: gitlabComSession.id } }))
    })

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('disconnected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent('')
    expect(screen.getByTestId('error-code')).toHaveTextContent('AUTH_REQUIRED')
    expect(readPinnedProjectIds(scope)).toEqual([])
    expect(readRecentProjectIds(scope)).toEqual([])
    expect(readSavedSearches(scope)).toEqual([])
  })

  it.each([
    ['GitLab.com', 'https://gitlab.com'],
    ['Self-Managed', 'https://gitlab.example.com/gitlab'],
  ])('connects to %s using the URL entered in the form', async (_label, url) => {
    renderConnectionView()

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    fireEvent.change(screen.getByLabelText('GitLab URL'), { target: { value: url } })
    fireEvent.change(screen.getByLabelText('Personal Access Token'), { target: { value: 'fixture-token' } })
    fireEvent.click(screen.getByRole('button', { name: '接続する' }))

    await waitFor(() => expect(screen.getByText(url)).toBeInTheDocument())
    expect(invokeMock).toHaveBeenCalledWith('connect_gitlab', {
      input: { token: 'fixture-token', url },
    })
    expect(screen.queryByDisplayValue('fixture-token')).not.toBeInTheDocument()
  })

  it('clears the PAT field when a connect attempt fails', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(null)
      if (command === 'connect_gitlab') return Promise.reject({ code: 'AUTH_REQUIRED', message: 'トークンを確認してください。' })
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    const tokenField = screen.getByLabelText('Personal Access Token')
    fireEvent.change(tokenField, { target: { value: 'fixture-token' } })
    fireEvent.click(screen.getByRole('button', { name: '接続する' }))

    await waitFor(() => expect(screen.getByText('トークンを確認してください。')).toBeInTheDocument())
    expect(screen.getByLabelText('Personal Access Token')).toHaveValue('')
    expect(screen.queryByDisplayValue('fixture-token')).not.toBeInTheDocument()
  })

  it('clears preferences scoped to the disconnected account', async () => {
    const scope = { instanceUrl: gitlabComSession.instanceUrl, userId: gitlabComSession.user.id }
    writePinnedProjectIds(scope, ['1', '2'])
    writeRecentProjectIds(scope, ['3'])
    writeSavedSearches(scope, [{ id: 'search-1', label: 'Mine', query: 'is:opened', state: 'opened' }])

    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'disconnect_gitlab') return Promise.resolve(undefined)
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(screen.getByText(gitlabComSession.instanceUrl)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '切断' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'GitLabに接続' })).toBeInTheDocument())
    expect(invokeMock).toHaveBeenCalledWith('disconnect_gitlab', { sessionId: gitlabComSession.id })
    expect(readPinnedProjectIds(scope)).toEqual([])
    expect(readRecentProjectIds(scope)).toEqual([])
    expect(readSavedSearches(scope)).toEqual([])
    clearPreferences(scope)
  })

  it('clears the visible session and shows the storage error when disconnect fails', async () => {
    const storageError = '切断処理の保存に失敗しました。'
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'disconnect_gitlab') return Promise.reject({ code: 'STORAGE', message: storageError })
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(screen.getByText(gitlabComSession.instanceUrl)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '切断' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'GitLabに接続' })).toBeInTheDocument())
    expect(screen.getByText(storageError)).toBeInTheDocument()
    expect(screen.queryByText('GitLab接続済み')).not.toBeInTheDocument()
  })
})
