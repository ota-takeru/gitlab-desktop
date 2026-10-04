import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AutoUpdateSafetyProvider, useAutoUpdateSafety } from '../features/shared/AutoUpdateSafety'
import { WindowCloseProtection } from './WindowCloseProtection'

const { flushMock, invokeMock, isTauriMock, listenMock, retainedComposerUnsafeMock } = vi.hoisted(() => ({
  flushMock: vi.fn(),
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
  retainedComposerUnsafeMock: { value: false },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('../features/mergeRequests/useComposerBuffer', () => ({
  flushComposerBuffers: flushMock,
  useRetainedComposerUnsafe: () => retainedComposerUnsafeMock.value,
}))

type CloseCallback = (event: { payload: boolean }) => void

let closeCallback: CloseCallback | null = null

function SafetyHarness({ unsafe }: { unsafe: boolean }) {
  const { setUnsafe } = useAutoUpdateSafety('window-test', { persistOnUnmount: true })
  useEffect(() => setUnsafe(unsafe), [setUnsafe, unsafe])
  return <WindowCloseProtection />
}

function renderProtection(unsafe = false) {
  return render(<AutoUpdateSafetyProvider><SafetyHarness unsafe={unsafe} /></AutoUpdateSafetyProvider>)
}

async function emitClose(payload: boolean) {
  if (!closeCallback) throw new Error('close listener was not registered')
  closeCallback({ payload })
  await Promise.resolve()
}

describe('WindowCloseProtection', () => {
  beforeEach(() => {
    retainedComposerUnsafeMock.value = false
    invokeMock.mockReset().mockResolvedValue(undefined)
    flushMock.mockReset().mockResolvedValue(true)
    isTauriMock.mockReset().mockReturnValue(true)
    listenMock.mockReset().mockImplementation(async (_event: string, callback: CloseCallback) => {
      closeCallback = callback
      return vi.fn()
    })
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    vi.spyOn(globalThis, 'alert').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not enable native interception when event registration fails and allows retry', async () => {
    listenMock.mockRejectedValueOnce(new Error('event unavailable'))
    renderProtection()

    expect(await screen.findByRole('status')).toHaveTextContent('終了保護を有効にできませんでした')
    expect(invokeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: false }))
    expect(listenMock).toHaveBeenCalledTimes(2)
  })

  it('serializes guard writes while the handshake is pending', async () => {
    const guardResolvers: Array<() => void> = []
    invokeMock.mockImplementation((command: string) => command === 'set_window_close_guard' ? new Promise<void>((resolve) => guardResolvers.push(resolve)) : Promise.resolve())
    const view = renderProtection()

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1))
    view.rerender(<AutoUpdateSafetyProvider><SafetyHarness unsafe /></AutoUpdateSafetyProvider>)
    await Promise.resolve()
    expect(invokeMock).toHaveBeenCalledTimes(1)

    guardResolvers[0]?.()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2))
    expect(invokeMock.mock.calls[1]).toEqual(['set_window_close_guard', { unsafeToClose: true }])
    guardResolvers[1]?.()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2))
  })

  it('keeps an unsafe close open when the user cancels', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    renderProtection(true)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: true }))

    await emitClose(true)
    expect(globalThis.confirm).toHaveBeenCalledWith('未送信の入力、編集中の内容、または結果未確認の投稿があります。端末への保存を待って終了しますか？保存済みの未送信コメントは次回復元されます。')
    expect(flushMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalledWith('close_app_window')
  })

  it('flushes before closing even when native reports a safe close', async () => {
    const order: string[] = []
    flushMock.mockImplementation(async () => { order.push('flush'); return true })
    invokeMock.mockImplementation(async (command: string) => { if (command === 'close_app_window') order.push('close') })
    renderProtection()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: false }))

    await emitClose(false)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('close_app_window'))
    expect(order).toEqual(['flush', 'close'])
    expect(globalThis.confirm).not.toHaveBeenCalled()
  })

  it('requires an explicit loss confirmation after a save failure', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    flushMock.mockResolvedValue(false)
    renderProtection()
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: false }))

    await emitClose(false)
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith('未保存の内容を保存できませんでした。内容を失って終了しますか？'))
    expect(invokeMock).not.toHaveBeenCalledWith('close_app_window')
  })

  it('deduplicates repeated native close requests while flushing', async () => {
    let resolveFlush: ((value: boolean) => void) | undefined
    flushMock.mockImplementation(() => new Promise<boolean>((resolve) => { resolveFlush = resolve }))
    renderProtection(true)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: true }))

    await emitClose(true)
    await emitClose(true)
    expect(flushMock).toHaveBeenCalledTimes(1)
    resolveFlush?.(true)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('close_app_window'))
    expect(invokeMock.mock.calls.filter(([command]) => command === 'close_app_window')).toHaveLength(1)
  })

  it('keeps the module-lifetime listener after the component unmounts', async () => {
    const listenerCallsBefore = listenMock.mock.calls.length
    const view = renderProtection(true)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: true }))
    view.unmount()

    await emitClose(true)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('close_app_window'))
    expect(listenMock).toHaveBeenCalledTimes(listenerCallsBefore)
  })

  it('does not call Tauri APIs in the browser preview', async () => {
    isTauriMock.mockReturnValue(false)
    const before = listenMock.mock.calls.length
    renderProtection(true)
    await Promise.resolve()

    expect(listenMock).toHaveBeenCalledTimes(before)
    expect(invokeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
