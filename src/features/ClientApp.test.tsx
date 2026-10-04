import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAppTheme } from '../theme'
import type { GitLabSession } from '../types/gitlab'
import { AutoUpdateSafetyProvider } from './shared/AutoUpdateSafety'
import { ClientApp } from './ClientApp'
import { clearComposerBufferStore, createComposerBufferKey, useComposerBuffer } from './mergeRequests/useComposerBuffer'

const { connection, invokeMock } = vi.hoisted(() => ({
  connection: {
    session: null as GitLabSession | null,
    status: 'idle',
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    restore: vi.fn(),
  },
  invokeMock: vi.fn(),
}))

vi.mock('./connections/ConnectionProvider', () => ({
  ConnectionProvider: ({ children }: { children: ReactNode }) => children,
  useConnection: () => connection,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => true }))

beforeEach(() => {
  window.history.replaceState(null, '', '#client/home')
  invokeMock.mockReset()
  connection.session = { id: 'session-1', instanceUrl: 'https://gitlab.com', serverVersion: null, user: { id: '1', name: 'One', username: 'one' } }
  connection.status = 'connected'
})
afterEach(() => window.history.replaceState(null, '', '/'))

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
