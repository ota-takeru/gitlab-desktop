import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../theme'
import { AUTO_INSTALL_DELAY_MS, UpdatePanel } from './UpdatePanel'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

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

function renderPanel(autoInstallAllowed = false) {
  return render(
    <ThemeProvider theme={createAppTheme('dark')}>
      <UpdatePanel autoInstallAllowed={autoInstallAllowed} />
    </ThemeProvider>,
  )
}

describe('UpdatePanel', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    invokeMock.mockReset()
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
})
