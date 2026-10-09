import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../theme'
import { AUTO_INSTALL_DELAY_MS, UpdatePanel } from './UpdatePanel'

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

    fireEvent.click(screen.getByRole('button', { name: '更新をインストール' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('install_app_update'))
    expect(await screen.findByText('更新を適用しました')).toBeInTheDocument()
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
    expect(await screen.findByRole('region', { name: 'アプリの更新' })).toHaveTextContent('新しいバージョンがあります')
    fireEvent.click(screen.getByRole('button', { name: '更新をインストール' }))
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
    fireEvent.click(await screen.findByRole('button', { name: '更新をインストール' }))
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

  it('can install automatically only after the owning screen opts in', async () => {
    vi.useFakeTimers()
    invokeMock.mockImplementation((command: string) => (
      command === 'check_app_update'
        ? Promise.resolve({ configured: true, version: '0.2.0', notes: null })
        : Promise.resolve(undefined)
    ))
    renderPanel(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/2分後に自動で更新/)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS + 1000)
    })
    expect(invokeMock).toHaveBeenCalledWith('install_app_update')
    expect(screen.getByText('更新を適用しました')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('restarts the idle period on activity and postpones while work is unsafe', async () => {
    vi.useFakeTimers()
    invokeMock.mockResolvedValue({ configured: true, version: '0.2.0', notes: null })
    const panel = renderPanel(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS - 1000) })
    fireEvent.keyDown(window, { key: 'Tab' })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')
    panel.rerender(<ThemeProvider theme={createAppTheme('dark')}><UpdatePanel autoInstallAllowed={false} /></ThemeProvider>)
    expect(screen.getByRole('button', { name: '更新をインストール' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '更新をインストール' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_INSTALL_DELAY_MS + 1000) })
    expect(invokeMock).not.toHaveBeenCalledWith('install_app_update')
  })

  it('blocks background interaction until an install finishes', async () => {
    const install = createDeferred<void>()
    invokeMock.mockImplementation((command: string) => (
      command === 'check_app_update'
        ? Promise.resolve({ configured: true, version: '0.2.0', notes: null })
        : install.promise
    ))
    renderPanel(true, false, true)

    fireEvent.click(await screen.findByRole('button', { name: '更新をインストール' }))
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

    fireEvent.click(await screen.findByRole('button', { name: '更新をインストール' }))
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
