import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readPinnedProjectIds, readRecentProjectIds, readSavedSearches, scopedKey, writePinnedProjectIds, writeRecentProjectIds, writeSavedSearches } from '../shared/preferences'
import { ConnectionProvider } from './ConnectionProvider'
import { useConnection } from './connectionContext'
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

const otherAccountSession: GitLabSession = {
  id: 'session-other-account',
  instanceUrl: 'https://gitlab.example.com',
  user: { id: '84', username: 'another-reviewer', name: 'Another Review User' },
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
    if (command === 'list_glab_connections') return Promise.resolve([gitlabComSession.instanceUrl])
    if (command === 'connect_gitlab') {
      const url = args?.input?.url ?? gitlabComSession.instanceUrl
      return Promise.resolve({ ...gitlabComSession, instanceUrl: url })
    }
    if (command === 'connect_gitlab_from_glab') {
      const url = (args as { url?: string } | undefined)?.url ?? gitlabComSession.instanceUrl
      return Promise.resolve({ ...gitlabComSession, instanceUrl: url })
    }
    if (command === 'disconnect_gitlab') return Promise.resolve(undefined)
    throw new Error(`Unexpected IPC command: ${command}`)
  })
}

describe('GitLab connection IPC and lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    invokeMock.mockReset()
    setTauriEnvironment(true)
    localStorage.clear()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
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

  it('reads glab targets only on demand and ignores the manual PAT URL', async () => {
    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    expect(invokeMock).not.toHaveBeenCalledWith('list_glab_connections')
    fireEvent.change(screen.getByLabelText('GitLab URL'), { target: { value: 'https://unrelated.example.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'glabの認証情報で接続' }))

    expect(await screen.findByRole('dialog', { name: 'glabに保存された接続先' })).toBeInTheDocument()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_glab_connections'))
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab_from_glab')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument()
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab_from_glab')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'glabの認証情報で接続' }))
    await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === 'list_glab_connections')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'この接続先に接続' }))
    await waitFor(() => expect(screen.getByText(gitlabComSession.instanceUrl)).toBeInTheDocument())
    expect(invokeMock).toHaveBeenCalledWith('connect_gitlab_from_glab', {
      url: gitlabComSession.instanceUrl,
    })
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab')).toBe(false)
    expect(screen.queryByDisplayValue('fixture-token')).not.toBeInTheDocument()
  })

  it('requires an explicit choice when glab has multiple saved targets', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(null)
      if (command === 'list_glab_connections') return Promise.resolve([gitlabComSession.instanceUrl, otherAccountSession.instanceUrl])
      if (command === 'connect_gitlab_from_glab') return Promise.resolve(otherAccountSession)
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    fireEvent.click(screen.getByRole('button', { name: 'glabの認証情報で接続' }))

    expect(await screen.findByLabelText('glabでログイン済みのGitLab接続先')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この接続先に接続' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: otherAccountSession.instanceUrl }))
    expect(screen.getByRole('button', { name: 'この接続先に接続' })).toBeEnabled()
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab_from_glab')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'この接続先に接続' }))
    await waitFor(() => expect(screen.getByText(otherAccountSession.instanceUrl)).toBeInTheDocument())
    expect(invokeMock).toHaveBeenCalledWith('connect_gitlab_from_glab', { url: otherAccountSession.instanceUrl })
  })

  it('does not connect when a saved-target dialog is canceled and explains an empty glab config', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(null)
      if (command === 'list_glab_connections') return Promise.resolve([])
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    fireEvent.click(screen.getByRole('button', { name: 'glabの認証情報で接続' }))

    expect(await screen.findByText(/glabに保存済みの接続先がありません/u)).toBeInTheDocument()
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab_from_glab')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument()
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab_from_glab')).toBe(false)
  })

  it('keeps the current session and emits no logout event when disconnect is busy', async () => {
    const logoutListener = vi.fn()
    window.addEventListener('gitlab-explicit-logout', logoutListener)
    const busyError = { code: 'BUSY', message: '投稿処理中です。' }
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'disconnect_gitlab') return Promise.reject(busyError)
      throw new Error(`Unexpected command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))

    fireEvent.click(screen.getByRole('button', { name: 'disconnect' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent(gitlabComSession.instanceUrl)
    expect(screen.getByTestId('error-code')).toHaveTextContent('BUSY')
    expect(logoutListener).not.toHaveBeenCalled()
    window.removeEventListener('gitlab-explicit-logout', logoutListener)
  })

  it('keeps the current session when a replacement connect is busy', async () => {
    const busyError = { code: 'BUSY', message: '投稿処理中です。' }
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'connect_gitlab') return Promise.reject(busyError)
      throw new Error(`Unexpected command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent(gitlabComSession.instanceUrl)
    expect(screen.getByTestId('error-code')).toHaveTextContent('BUSY')
  })

  it('dispatches account replacement before adopting a different account after auth expiry', async () => {
    const replacementListener = vi.fn(() => expect(screen.getByTestId('instance-url')).toHaveTextContent(''))
    window.addEventListener('gitlab-account-replaced', replacementListener)
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'connect_gitlab') return Promise.resolve(otherAccountSession)
      throw new Error(`Unexpected command: ${command}`)
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

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent(otherAccountSession.instanceUrl)
    expect(replacementListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('gitlab-account-replaced', replacementListener)
  })

  it('does not dispatch account replacement for same-account reauthentication', async () => {
    const replacementListener = vi.fn()
    window.addEventListener('gitlab-account-replaced', replacementListener)
    const reauthenticatedSession = { ...gitlabComSession, id: 'session-gitlab-com-reauthenticated' }
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'connect_gitlab') return Promise.resolve(reauthenticatedSession)
      throw new Error(`Unexpected command: ${command}`)
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

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent(gitlabComSession.instanceUrl)
    expect(replacementListener).not.toHaveBeenCalled()
    window.removeEventListener('gitlab-account-replaced', replacementListener)
  })

  it('keeps the previous session visible and reports errors when connect fails', async () => {
    const connectError = { code: 'NETWORK', message: '接続できませんでした。' }
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'connect_gitlab') return Promise.reject(connectError)
      throw new Error(`Unexpected command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTestId('error-code')).toHaveTextContent('NETWORK'))
    expect(screen.getByTestId('status')).toHaveTextContent('connected')
    expect(screen.getByTestId('instance-url')).toHaveTextContent(gitlabComSession.instanceUrl)
  })

  it('resets the account identity after accepted explicit logout', async () => {
    const replacementListener = vi.fn()
    window.addEventListener('gitlab-account-replaced', replacementListener)
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'disconnect_gitlab') return Promise.resolve(undefined)
      if (command === 'connect_gitlab') return Promise.resolve(otherAccountSession)
      throw new Error(`Unexpected command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    fireEvent.click(screen.getByRole('button', { name: 'disconnect' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('disconnected'))

    fireEvent.click(screen.getByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    expect(screen.getByTestId('instance-url')).toHaveTextContent(otherAccountSession.instanceUrl)
    expect(replacementListener).not.toHaveBeenCalled()
    window.removeEventListener('gitlab-account-replaced', replacementListener)
  })

  it('shows a redacted glab error while leaving manual PAT fallback available', async () => {
    const glabError = 'glabの認証情報を読み取れませんでした。'
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(null)
      if (command === 'list_glab_connections') return Promise.resolve([gitlabComSession.instanceUrl])
      if (command === 'connect_gitlab_from_glab') return Promise.reject({ code: 'AUTH_REQUIRED', message: glabError })
      throw new Error(`Unexpected IPC command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    fireEvent.change(screen.getByLabelText('Personal Access Token'), { target: { value: 'fixture-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'glabの認証情報で接続' }))
    fireEvent.click(await screen.findByRole('button', { name: 'この接続先に接続' }))

    await waitFor(() => expect(screen.getByText(glabError)).toBeInTheDocument())
    expect(screen.getByLabelText('Personal Access Token')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '接続する' })).toBeEnabled()
  })

  it('disables glab import in the browser preview', async () => {
    setTauriEnvironment(false)
    renderConnectionView()

    const glabButton = screen.getByRole('button', { name: 'glabの認証情報で接続' })
    expect(glabButton).toBeDisabled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('clears preferences scoped to the disconnected account', async () => {
    const scope = { instanceUrl: gitlabComSession.instanceUrl, userId: gitlabComSession.user.id }
    writePinnedProjectIds(scope, ['1', '2'])
    writeRecentProjectIds(scope, ['3'])
    writeSavedSearches(scope, [{ id: 'search-1', label: 'Mine', query: 'is:opened', state: 'opened' }])
    localStorage.setItem(scopedKey(scope, 'reviewed-files'), JSON.stringify({ '77:3': { 'src/lib.rs': 'fingerprint' } }))

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
    expect(localStorage.getItem(scopedKey(scope, 'reviewed-files'))).toBeNull()
  })

  it('requires explicit confirmation before deleting connection data', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'disconnect_gitlab') return Promise.resolve(undefined)
      throw new Error(`Unexpected command: ${command}`)
    })

    renderConnectionView()
    await waitFor(() => expect(screen.getByText(gitlabComSession.instanceUrl)).toBeInTheDocument())
    vi.mocked(globalThis.confirm).mockReturnValue(false)

    fireEvent.click(screen.getByRole('button', { name: '切断' }))

    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('未送信コメント、結果未確認の投稿記録が削除されます')))
    expect(invokeMock).not.toHaveBeenCalledWith('disconnect_gitlab', { sessionId: gitlabComSession.id })
    expect(screen.getByText('GitLab接続済み')).toBeInTheDocument()
  })

  it('dispatches explicit logout after backend disconnect cleanup', async () => {
    const logoutListener = vi.fn()
    window.addEventListener('gitlab-explicit-logout', logoutListener)
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'disconnect_gitlab') return Promise.resolve(undefined)
      throw new Error(`Unexpected command: ${command}`)
    })

    render(
      <ConnectionProvider>
        <ConnectionHarness />
      </ConnectionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    fireEvent.click(screen.getByRole('button', { name: 'disconnect' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('disconnected'))
    expect(logoutListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('gitlab-explicit-logout', logoutListener)
  })

  it('reconnects an expired account in place with Enter, keeping its instance URL', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'reauthenticate_gitlab') return Promise.resolve({ ...gitlabComSession, id: 'session-renewed' })
      throw new Error(`Unexpected IPC command: ${command}`)
    })
    renderConnectionView()
    await waitFor(() => expect(screen.getByText('GitLab接続済み')).toBeInTheDocument())
    act(() => {
      window.dispatchEvent(new CustomEvent('gitlab-auth-required', { detail: { sessionId: gitlabComSession.id } }))
    })

    expect(await screen.findByRole('heading', { name: '再認証が必要です' })).toBeInTheDocument()
    expect(screen.getByLabelText('GitLab URL')).toHaveValue(gitlabComSession.instanceUrl)
    fireEvent.change(screen.getByLabelText('Personal Access Token'), { target: { value: 'renewed-token' } })
    fireEvent.submit(screen.getByLabelText('Personal Access Token').closest('form')!)

    await waitFor(() => expect(screen.getByText('GitLab接続済み')).toBeInTheDocument())
    expect(invokeMock).toHaveBeenCalledWith('reauthenticate_gitlab', { token: 'renewed-token' })
    expect(invokeMock.mock.calls.some(([command]) => command === 'connect_gitlab' || command === 'disconnect_gitlab')).toBe(false)
  })

  it('replaces the token of a connected account without disconnecting and shows a refusal as given', async () => {
    const refusal = '別のユーザーのトークンです。接続中のアカウントのトークンを入力してください。'
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'reauthenticate_gitlab') return Promise.reject({ code: 'INVALID_INPUT', message: refusal })
      throw new Error(`Unexpected IPC command: ${command}`)
    })
    renderConnectionView()
    fireEvent.click(await screen.findByRole('button', { name: 'トークンを更新' }))
    fireEvent.change(screen.getByLabelText('新しいPersonal Access Token'), { target: { value: 'other-token' } })
    fireEvent.submit(screen.getByLabelText('新しいPersonal Access Token').closest('form')!)

    expect(await screen.findByText(refusal)).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledWith('reauthenticate_gitlab', { token: 'other-token' })
    expect(screen.getByText('GitLab接続済み')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('other-token')).not.toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalledWith('disconnect_gitlab', expect.anything())
  })

  it('opens the token creation page through Rust before connecting and shows a refused URL', async () => {
    const refusal = 'HTTPSのGitLab URLを指定してください。資格情報・クエリ・フラグメントは指定できません。'
    invokeMock.mockImplementation((command: string, args?: { instanceUrl?: string }) => {
      if (command === 'restore_session') return Promise.resolve(null)
      if (command === 'open_token_creation_page') return args?.instanceUrl === 'https://gitlab.example.com' ? Promise.resolve(undefined) : Promise.reject({ code: 'INVALID_INPUT', message: refusal })
      throw new Error(`Unexpected IPC command: ${command}`)
    })
    const clipboard = vi.fn()
    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))

    fireEvent.change(screen.getByLabelText('GitLab URL'), { target: { value: 'gitlab.example.com/' } })
    fireEvent.click(screen.getByRole('button', { name: 'アクセストークンを作成' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_token_creation_page', { instanceUrl: 'https://gitlab.example.com' }))

    fireEvent.change(screen.getByLabelText('GitLab URL'), { target: { value: 'https://user:secret@gitlab.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'アクセストークンを作成' }))
    expect(await screen.findByText(refusal)).toBeInTheDocument()
    expect(clipboard).not.toHaveBeenCalled()
    expect(invokeMock.mock.calls.some(([command]) => command === 'open_gitlab_url')).toBe(false)
    Reflect.deleteProperty(globalThis.navigator, 'clipboard')
  })

  it('opens the token creation page of the connected instance through the same command', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restore_session') return Promise.resolve(gitlabComSession)
      if (command === 'open_token_creation_page') return Promise.resolve(undefined)
      throw new Error(`Unexpected IPC command: ${command}`)
    })
    renderConnectionView()
    fireEvent.click(await screen.findByRole('button', { name: 'トークンを更新' }))
    fireEvent.click(screen.getByRole('button', { name: 'アクセストークンを作成' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_token_creation_page', { instanceUrl: 'https://gitlab.com' }))
  })

  it('takes a host without a scheme as HTTPS and remembers only the URL', async () => {
    renderConnectionView()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restore_session'))
    expect(screen.queryByRole('button', { name: '保存済みの接続を再試行' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('GitLab URL'), { target: { value: 'gitlab.example.com/' } })
    fireEvent.change(screen.getByLabelText('Personal Access Token'), { target: { value: 'fixture-token' } })
    fireEvent.submit(screen.getByLabelText('Personal Access Token').closest('form')!)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connect_gitlab', { input: { token: 'fixture-token', url: 'https://gitlab.example.com' } }))
    await waitFor(() => expect(localStorage.getItem('gitlab-desktop:last-instance-url')).toBe('https://gitlab.example.com'))
    expect(Object.values(localStorage).join(' ')).not.toContain('fixture-token')
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
