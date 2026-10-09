import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@mui/material/styles'
import DevelopmentApp from './pages/DevelopmentApp'
import { createAppTheme } from './theme'

function App() {
  return <ThemeProvider theme={createAppTheme('dark', 'workbench')}><DevelopmentApp mode="dark" onModeChange={() => undefined} route="foundation" /></ThemeProvider>
}

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

describe('development-only foundation screens', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    setTauriEnvironment(true)
    window.history.replaceState(null, '', '#foundation')
  })

  it('renders the overview and keeps modules explicitly disconnected', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '自分の GitLab 作業を、軽く始める' })).toBeInTheDocument()
    expect(screen.getByText('Rust runtime')).toBeInTheDocument()
    expect(screen.getByText('未接続')).toBeInTheDocument()
  })

  it('navigates to an empty module page without inventing GitLab data', () => {
    render(<App />)

    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Merge requests レビュー待ち/ }))

    expect(screen.getByRole('heading', { name: 'Merge requests' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Merge requests は未接続です' })).toBeInTheDocument()
    expect(screen.getByText(/現在はデータを読み込んでいません/)).toBeInTheDocument()
  })

  it('reports the browser preview honestly instead of calling invoke', async () => {
    setTauriEnvironment(false)
    render(<App />)

    expect(screen.getAllByText('ブラウザプレビュー')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Rust 環境を確認' }))

    expect(await screen.findByText('ブラウザプレビューのため Rust コマンドを実行できません。')).toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('calls runtime_info and displays typed runtime details on success', async () => {
    invokeMock.mockResolvedValue({ appVersion: '0.1.0', os: 'windows', arch: 'x86_64' })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Rust 環境を確認' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('runtime_info'))
    expect(await screen.findByText('デスクトップブリッジが応答しました。')).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByText('windows')).toBeInTheDocument()
    expect(screen.getByText('x86_64')).toBeInTheDocument()
  })

  it('keeps the health action pending while the Rust command is in flight', () => {
    invokeMock.mockReturnValue(new Promise(() => undefined))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Rust 環境を確認' }))

    expect(screen.getByText('確認中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確認中…' })).toBeDisabled()
  })

  it('shows a connection error when the Rust command rejects', async () => {
    invokeMock.mockRejectedValue(new Error('command unavailable'))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Rust 環境を確認' }))

    expect(await screen.findByText('command unavailable')).toBeInTheDocument()
    expect(screen.getByText('接続エラー')).toBeInTheDocument()
  })

  it('opens the UI catalog for shared component review', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /UI catalog コンポーネント一覧/ }))

    expect(await screen.findByRole('heading', { name: 'UI catalog' }, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText('Status pills')).toBeInTheDocument()
    expect(await screen.findByText('表示するデータがありません')).toBeInTheDocument()
  })
})
