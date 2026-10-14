import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../theme'
import { UpdatePanel } from './UpdatePanel'

const { invokeMock, flushMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), flushMock: vi.fn() }))
vi.mock('../features/mergeRequests/useComposerBuffer', () => ({ flushComposerBuffers: flushMock }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: () => Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__),
}))

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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderPanel(autoInstallAllowed = false, compact = false, withBackgroundInput = false, notificationOnly = false) {
  return render(
    <ThemeProvider theme={createAppTheme('dark')}>
      {withBackgroundInput ? <><input aria-label="background input" /><UpdatePanel autoInstallAllowed={autoInstallAllowed} compact={compact} notificationOnly={notificationOnly} /></> : <UpdatePanel autoInstallAllowed={autoInstallAllowed} compact={compact} notificationOnly={notificationOnly} />}
    </ThemeProvider>,
  )
}

describe('UpdatePanel', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    invokeMock.mockReset()
    flushMock.mockReset().mockResolvedValue(true)
    setTauriEnvironment(true)
  })

  it('checks for updates when the desktop panel mounts and offers an explicit install action', async () => {
    invokeMock.mockResolvedValue({
      configured: true,
      version: '0.2.0',
      notes: '改善と修正',
    })
    renderPanel(true)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('check_app_update'))
    expect(await screen.findByText('v0.2.0')).toBeInTheDocument()
    expect(screen.getByText('改善と修正')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '再起動して更新' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('install_app_update'))
    expect(await screen.findByText('更新を適用しました')).toBeInTheDocument()
  })

  it('runs the first check once a window that opened hidden becomes visible', async () => {
    invokeMock.mockResolvedValue({ configured: true, version: '0.2.0', notes: null })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    renderPanel(true)
    await act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 0)) })
    expect(invokeMock).not.toHaveBeenCalledWith('check_app_update')

    visibility.mockReturnValue('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })

    expect(await screen.findByText('v0.2.0')).toBeInTheDocument()
    visibility.mockRestore()
  })

  it('does not invoke desktop commands in the browser preview', async () => {
    setTauriEnvironment(false)
    renderPanel()

    expect(screen.getByText('デスクトップで更新を確認できます')).toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('hides the current-version state in notification-only mode', async () => {
    invokeMock.mockResolvedValue({ configured: true, version: null, notes: null })
    renderPanel(true, true, false, true)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('check_app_update'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'アプリの更新' })).not.toBeInTheDocument())
  })

  it('keeps available updates and their install guard actionable in notification-only mode', async () => {
    const installation = createDeferred<void>()
    invokeMock.mockImplementation((command: string) => command === 'install_app_update'
      ? installation.promise
      : Promise.resolve({ configured: true, version: '0.2.0', notes: '改善と修正' }))
    const panel = renderPanel(true, true, false, true)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('check_app_update'))
    const region = await screen.findByRole('region', { name: 'アプリの更新' })
    await waitFor(() => expect(region).toHaveTextContent('v0.2.0 ダウンロード済み ·'))
    fireEvent.click(screen.getByRole('button', { name: '再起動して更新' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('更新中…完了後再起動')
    await act(async () => installation.resolve(undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    panel.unmount()
  })

  it('hides the browser preview label in notification-only mode', async () => {
    setTauriEnvironment(false)
    renderPanel(false, true, false, true)

    expect(screen.queryByText('デスクトップで更新を確認できます')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'アプリの更新' })).not.toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('waits for local draft persistence and stops updating if it fails', async () => {
    const saving = createDeferred<boolean>()
    flushMock.mockReturnValue(saving.promise)
    invokeMock.mockResolvedValue({ configured: true, version: '0.2.0', notes: null })
    renderPanel(true)
    fireEvent.click(await screen.findByRole('button', { name: '再起動して更新' }))
    expect(flushMock).toHaveBeenCalledOnce()
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')
    await act(async () => saving.resolve(false))
    expect(await screen.findByText(/未送信コメントを端末に保存できないため/u)).toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')
  })

  it('lets a compact notification recover from an initial check failure', async () => {
    invokeMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ configured: true, version: null, notes: null })
    render(<ThemeProvider theme={createAppTheme('dark')}><UpdatePanel compact autoInstallAllowed /></ThemeProvider>)
    expect(await screen.findByText('offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))
    expect(await screen.findByText('最新バージョンです')).toBeInTheDocument()
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('never installs or restarts by itself, and waits for a safe state before the user can', async () => {
    vi.useFakeTimers()
    invokeMock.mockResolvedValue({ configured: true, version: '0.2.0', notes: null })
    const panel = renderPanel(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('button', { name: '再起動して更新' })).toBeEnabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000) })
    expect(invokeMock).toHaveBeenCalledWith('download_app_update')
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')

    panel.rerender(<ThemeProvider theme={createAppTheme('dark')}><UpdatePanel autoInstallAllowed={false} /></ThemeProvider>)
    expect(screen.getByRole('button', { name: '再起動して更新' })).toBeDisabled()
    expect(screen.getByText(/入力の保存または破棄と送信処理の確認が済むと更新できます/u)).toBeInTheDocument()
  })

  it('downloads a found update in the background and only installs on a click', async () => {
    const download = createDeferred<void>()
    invokeMock.mockImplementation((command: string) => (
      command === 'download_app_update' ? download.promise : Promise.resolve({ configured: true, version: '0.2.0', notes: null })
    ))
    renderPanel(true, false, false, true)

    const region = await screen.findByRole('region', { name: 'アプリの更新' })
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('download_app_update'))
    expect(region).toHaveTextContent('v0.2.0 に更新できます')
    await act(async () => download.resolve(undefined))
    await waitFor(() => expect(region).toHaveTextContent('v0.2.0 ダウンロード済み ·再起動して更新'))
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')
    expect(invokeMock.mock.calls.filter(([command]) => command === 'download_app_update')).toHaveLength(1)
  })

  it('skips the download when Rust already holds the package of the found version', async () => {
    invokeMock.mockResolvedValue({ configured: true, version: '0.2.0', notes: null, downloaded: true })
    renderPanel(true, false, false, true)

    const region = await screen.findByRole('region', { name: 'アプリの更新' })
    expect(region).toHaveTextContent('v0.2.0 ダウンロード済み ·')
    await act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 0)) })
    expect(invokeMock).not.toHaveBeenCalledWith('download_app_update')
  })

  it('shows a failed download as a dismissible footer notice and keeps the update installable', async () => {
    invokeMock.mockImplementation((command: string) => (
      command === 'download_app_update'
        ? Promise.reject({ code: 'NETWORK', message: '署名付き更新をダウンロードできませんでした。現在のバージョンは引き続き使用できます。' })
        : Promise.resolve({ configured: true, version: '0.2.0', notes: null })
    ))
    renderPanel(true, false, false, true)

    expect(await screen.findByText('署名付き更新をダウンロードできませんでした。現在のバージョンは引き続き使用できます。')).toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')
    fireEvent.click(screen.getByRole('button', { name: '更新の通知を閉じる' }))
    expect(screen.queryByText(/ダウンロードできませんでした/u)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'アプリの更新' })).toHaveTextContent('v0.2.0 に更新できます')
    expect(screen.getByRole('button', { name: '再起動して更新' })).toBeEnabled()
  })

  it('shows a failed check as a dismissible footer notice with the message Tauri sent', async () => {
    localStorage.removeItem('gitlab-desktop:update-check-error-dismissed-at')
    invokeMock.mockRejectedValue({ code: 'NETWORK', message: '更新を確認できませんでした。現在のバージョンは引き続き使用できます。' })
    const first = renderPanel(true, false, false, true)

    expect(await screen.findByText('更新を確認できませんでした。現在のバージョンは引き続き使用できます。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更新の通知を閉じる' }))
    expect(screen.queryByText(/更新を確認できませんでした/u)).not.toBeInTheDocument()
    first.unmount()

    // The next launch fails again, but the notice stays dismissed for a while.
    renderPanel(true, false, false, true)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/更新を確認できませんでした/u)).not.toBeInTheDocument()
    localStorage.removeItem('gitlab-desktop:update-check-error-dismissed-at')
  })

  it('shares one check between the footer and the settings', async () => {
    invokeMock.mockImplementation((command: string) => command === 'runtime_info'
      ? Promise.resolve({ appVersion: '0.1.0', arch: 'x86_64', os: 'windows' })
      : Promise.resolve({ configured: true, version: null, notes: null }))
    render(<ThemeProvider theme={createAppTheme('dark')}><UpdatePanel notificationOnly /><UpdatePanel /></ThemeProvider>)

    expect(await screen.findByText('最新バージョンです')).toBeInTheDocument()
    expect(await screen.findByText('現在のバージョン v0.1.0')).toBeInTheDocument()
    expect(invokeMock.mock.calls.filter(([command]) => command === 'check_app_update')).toHaveLength(1)
  })

  it('blocks background interaction until an install finishes', async () => {
    const install = createDeferred<void>()
    invokeMock.mockImplementation((command: string) => (
      command === 'check_app_update'
        ? Promise.resolve({ configured: true, version: '0.2.0', notes: null })
        : install.promise
    ))
    renderPanel(true, false, true)

    fireEvent.click(await screen.findByRole('button', { name: '再起動して更新' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('更新中…完了後再起動')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(screen.queryByRole('textbox', { name: 'background input' })).not.toBeInTheDocument()
  })

  it('closes the install guard after a compact install failure and restores background access', async () => {
    const install = createDeferred<void>()
    invokeMock.mockImplementation((command: string) => (
      command === 'check_app_update'
        ? Promise.resolve({ configured: true, version: '0.2.0', notes: null })
        : install.promise
    ))
    renderPanel(true, true, true, true)

    fireEvent.click(await screen.findByRole('button', { name: '再起動して更新' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('更新中…完了後再起動')

    await act(async () => {
      install.reject(new Error('download failed'))
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'background input' })).toBeInTheDocument()
    expect(screen.getByText('download failed')).toBeInTheDocument()
  })
})
