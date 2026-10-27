import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AutoUpdateSafetyProvider } from '../features/shared/AutoUpdateSafety'
import { useAutoUpdateSafety } from '../features/shared/autoUpdateSafetyContext'
import { FeedbackProvider } from './Feedback'
import { WindowCloseProtection } from './WindowCloseProtection'

const { discardMock, flushMock, invokeMock, isTauriMock, listenMock, listTargetsMock, retainedComposerUnsafeMock } = vi.hoisted(() => ({
  discardMock: vi.fn(),
  flushMock: vi.fn(),
  listTargetsMock: vi.fn(),
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
  composerTargetName: (projectId: string, iid: string) => projectId === '7' && iid === '12' ? { projectPath: 'group/app', title: '検索を速くする' } : {},
  discardComposerBuffers: discardMock,
  flushComposerBuffers: flushMock,
  listUnsafeComposerTargets: listTargetsMock,
  useRetainedComposerUnsafe: () => retainedComposerUnsafeMock.value,
}))

type CloseCallback = (event: { payload: boolean }) => void

let closeCallback: CloseCallback | null = null

function SafetyHarness({ source = 'window-test', unsafe }: { source?: string; unsafe: boolean }) {
  const { setUnsafe } = useAutoUpdateSafety(source, { persistOnUnmount: true })
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
    discardMock.mockReset().mockResolvedValue(true)
    listTargetsMock.mockReset().mockReturnValue([])
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
    // Without the app's dialog provider the browser's confirm carries the same question.
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('未送信の内容があります'))
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
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('入力を保存できませんでした')))
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

  it('asks with the app dialog when one is mounted', async () => {
    render(<FeedbackProvider><AutoUpdateSafetyProvider><SafetyHarness unsafe /></AutoUpdateSafetyProvider></FeedbackProvider>)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: true }))

    await emitClose(true)
    const dialog = await screen.findByRole('dialog', { name: '未送信の内容があります' })
    expect(globalThis.confirm).not.toHaveBeenCalled()
    expect(flushMock).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '保存して終了' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('close_app_window'))
    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it('names each screen with unsent work and what in it is not sent, ten at most', async () => {
    listTargetsMock.mockReturnValue([
      { iid: '12', inputs: ['新しいコメント', '行コメント（src/a.ts:4）'], projectId: '7', projectPath: 'group/app', title: '検索を速くする' },
      { iid: '3', inputs: ['返信'], projectId: '8' },
      ...Array.from({ length: 10 }, (_, index) => ({ iid: String(100 + index), inputs: ['コメントの編集'], projectId: '9', projectPath: 'group/other', title: `MR ${index}` })),
    ])
    // An edit of the description holds the window too, though it is no stored input.
    render(<FeedbackProvider><AutoUpdateSafetyProvider><SafetyHarness source="description-edit:session-1:7:12" unsafe /></AutoUpdateSafetyProvider></FeedbackProvider>)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: true }))

    await emitClose(true)
    const dialog = await screen.findByRole('dialog', { name: '未送信の内容があります' })
    const items = within(within(dialog).getByRole('list', { name: '未送信の内容がある画面' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toHaveLength(11)
    expect(items.slice(0, 2)).toEqual(['group/app !12 検索を速くする新しいコメント、行コメント（src/a.ts:4）、説明の編集', 'プロジェクト 8 !3返信'])
    expect(items.at(-1)).toBe('ほか2件')
    fireEvent.click(within(dialog).getByRole('button', { name: '戻る' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(flushMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalledWith('close_app_window')
  })

  it('closes without saving on request, discarding the unsent input instead of saving it', async () => {
    render(<FeedbackProvider><AutoUpdateSafetyProvider><SafetyHarness unsafe /></AutoUpdateSafetyProvider></FeedbackProvider>)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('set_window_close_guard', { unsafeToClose: true }))

    await emitClose(true)
    const dialog = await screen.findByRole('dialog', { name: '未送信の内容があります' })
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual(['戻る', '保存せずに終了', '保存して終了'])
    fireEvent.click(within(dialog).getByRole('button', { name: '保存せずに終了' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('close_app_window'))
    expect(discardMock).toHaveBeenCalledTimes(1)
    expect(flushMock).not.toHaveBeenCalled()
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
