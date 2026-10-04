import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import type { GitLabSession, Position } from '../../types/gitlab'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed, useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { clearComposerBufferStore, createComposerBackendKey, createComposerBufferKey, useComposerBuffer, useRetainedComposerUnsafe } from './useComposerBuffer'

const { getLocalDraftMock, isDesktopRuntimeMock, setLocalDraftMock } = vi.hoisted(() => ({
  getLocalDraftMock: vi.fn(),
  isDesktopRuntimeMock: vi.fn(),
  setLocalDraftMock: vi.fn(),
}))

vi.mock('../../lib/localDrafts', () => ({
  getLocalDraft: getLocalDraftMock,
  isDesktopRuntime: isDesktopRuntimeMock,
  setLocalDraft: setLocalDraftMock,
}))

const sessionA: GitLabSession = {
  id: 'session-a',
  instanceUrl: 'https://gitlab.example.com',
  serverVersion: '18.0',
  user: { id: '1', name: 'A', username: 'a' },
}
const sessionB: GitLabSession = {
  ...sessionA,
  id: 'session-b',
  user: { id: '2', name: 'B', username: 'b' },
}
const position: Position = {
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  newLine: 12,
  newPath: 'new.ts',
  oldLine: 10,
  oldPath: 'old.ts',
  positionType: 'text',
  startSha: 'c'.repeat(40),
}

function Indicator() {
  return <output data-testid="safe">{useAutoUpdateAllowed() ? 'safe' : 'unsafe'}</output>
}

function Composer({ bufferKey, label = 'body', sessionId = null }: { bufferKey: string; label?: string; sessionId?: string | null }) {
  const buffer = useComposerBuffer(bufferKey, sessionId)
  return <><textarea aria-label={label} onChange={(event) => buffer.change(event.target.value)} value={buffer.body} /><output data-testid={`${label}-status`}>{buffer.persistenceStatus}</output><button onClick={buffer.discard}>discard</button>{buffer.error ? <output>{buffer.error}</output> : null}</>
}

function RetainedComposerSafetyBridge() {
  const retainedUnsafe = useRetainedComposerUnsafe()
  const { setUnsafe } = useAutoUpdateSafety('retained-composers', { persistOnUnmount: true })
  useEffect(() => setUnsafe(retainedUnsafe), [retainedUnsafe, setUnsafe])
  return <output data-testid="retained-safe">{useAutoUpdateAllowed() ? 'safe' : 'unsafe'}</output>
}

describe('useComposerBuffer', () => {
beforeEach(() => {
  clearComposerBufferStore()
  isDesktopRuntimeMock.mockReturnValue(false)
  getLocalDraftMock.mockReset().mockResolvedValue(null)
  setLocalDraftMock.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

  it('retains actual buffered text and updater safety across unmount/remount', () => {
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const view = render(<AutoUpdateSafetyProvider><Composer bufferKey={key} /><Indicator /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '未送信の本文' } })
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    view.rerender(<AutoUpdateSafetyProvider><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    view.rerender(<AutoUpdateSafetyProvider><Composer bufferKey={key} /><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('未送信の本文')
    fireEvent.click(screen.getByRole('button', { name: 'discard' }))
    expect(screen.getByTestId('safe')).toHaveTextContent('safe')
  })

  it('isolates buffers by account and clearing logout state clears safety', () => {
    const keyA = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const keyB = createComposerBufferKey(sessionB, 'project-1', '7', 'new', position)
    const view = render(<AutoUpdateSafetyProvider><Composer bufferKey={keyA} /><Indicator /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'Aだけの本文' } })

    view.rerender(<AutoUpdateSafetyProvider><Composer key={keyB} bufferKey={keyB} /><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('')
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    act(() => clearComposerBufferStore())
    expect(screen.getByTestId('safe')).toHaveTextContent('safe')
  })

  it('restores retained composer safety after the provider remounts', () => {
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const view = render(<><Composer bufferKey={key} /><AutoUpdateSafetyProvider key="first"><RetainedComposerSafetyBridge /></AutoUpdateSafetyProvider></>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'Provider再生成後も保持する本文' } })
    expect(screen.getByTestId('retained-safe')).toHaveTextContent('unsafe')

    view.rerender(<><Composer bufferKey={key} /><AutoUpdateSafetyProvider key="second"><RetainedComposerSafetyBridge /></AutoUpdateSafetyProvider></>)
    expect(screen.getByTestId('retained-safe')).toHaveTextContent('unsafe')

    act(() => clearComposerBufferStore())
    expect(screen.getByTestId('retained-safe')).toHaveTextContent('safe')
  })

  it('keeps retained safety after a persisted draft save fails', async () => {
    vi.useFakeTimers()
    isDesktopRuntimeMock.mockReturnValue(true)
    setLocalDraftMock.mockRejectedValue(new Error('secret backend details'))
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const view = render(<><Composer bufferKey={key} sessionId={sessionA.id} /><AutoUpdateSafetyProvider key="first"><RetainedComposerSafetyBridge /></AutoUpdateSafetyProvider></>)

    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '保存失敗後も保持する本文' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('body-status')).toHaveTextContent('error')
    expect(screen.getByTestId('retained-safe')).toHaveTextContent('unsafe')

    view.rerender(<><Composer bufferKey={key} sessionId={sessionA.id} /><AutoUpdateSafetyProvider key="second"><RetainedComposerSafetyBridge /></AutoUpdateSafetyProvider></>)
    expect(screen.getByTestId('retained-safe')).toHaveTextContent('unsafe')
  })

  it('refuses oversized input without silently truncating retained text', () => {
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    render(<AutoUpdateSafetyProvider><Composer bufferKey={key} /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'keep' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'あ'.repeat(Math.floor((64 * 1024) / 3) + 1) } })
    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('keep')
    expect(screen.getByText(/64 KiB/)).toBeInTheDocument()
  })

  it('refuses a 101st nonempty buffer instead of evicting an existing draft', () => {
    render(<AutoUpdateSafetyProvider>{Array.from({ length: 101 }, (_, index) => <Composer key={index} bufferKey={`buffer-${index}`} label={`body-${index}`} />)}</AutoUpdateSafetyProvider>)
    const textboxes = screen.getAllByRole('textbox')
    for (let index = 0; index < 100; index += 1) {
      fireEvent.change(textboxes[index], { target: { value: `draft-${index}` } })
    }
    fireEvent.change(textboxes[100], { target: { value: 'must-not-evict' } })

    expect(textboxes[100]).toHaveValue('')
    expect(textboxes[0]).toHaveValue('draft-0')
    expect(screen.getByText(/100件まで/)).toBeInTheDocument()
  })

  it('hydrates a persisted draft after the in-memory store is cleared', async () => {
    isDesktopRuntimeMock.mockReturnValue(true)
    getLocalDraftMock.mockResolvedValue({ body: '再起動後に戻った本文', updatedAt: 1791072000000 })
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)

    const first = render(<AutoUpdateSafetyProvider><Composer bufferKey={key} sessionId={sessionA.id} /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '一時入力' } })
    first.unmount()
    clearComposerBufferStore()

    render(<AutoUpdateSafetyProvider><Composer bufferKey={key} sessionId={sessionA.id} /></AutoUpdateSafetyProvider>)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('再起動後に戻った本文'))
    expect(getLocalDraftMock).toHaveBeenCalledWith(sessionA.id, createComposerBackendKey(key))
  })

  it('keeps a pending debounce alive when the composer unmounts', async () => {
    vi.useFakeTimers()
    isDesktopRuntimeMock.mockReturnValue(true)
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const view = render(<AutoUpdateSafetyProvider><Composer bufferKey={key} sessionId={sessionA.id} /></AutoUpdateSafetyProvider>)

    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '画面遷移前の本文' } })
    view.unmount()
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(setLocalDraftMock).toHaveBeenCalledWith(sessionA.id, createComposerBackendKey(key), '画面遷移前の本文')
    vi.useRealTimers()
  })

  it('does not let late hydration overwrite text entered by the user', async () => {
    isDesktopRuntimeMock.mockReturnValue(true)
    let resolveHydration: (draft: { body: string; updatedAt: number }) => void = () => undefined
    getLocalDraftMock.mockReturnValue(new Promise((resolve) => { resolveHydration = resolve }))
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    render(<AutoUpdateSafetyProvider><Composer bufferKey={key} sessionId={sessionA.id} /></AutoUpdateSafetyProvider>)

    await waitFor(() => expect(getLocalDraftMock).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'ユーザーが入力した本文' } })
    await act(async () => resolveHydration({ body: '古い保存本文', updatedAt: 1791072000000 }))

    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('ユーザーが入力した本文')
  })

  it('serializes a pending save before the subsequent empty-body deletion', async () => {
    vi.useFakeTimers()
    isDesktopRuntimeMock.mockReturnValue(true)
    let resolveSave: () => void = () => undefined
    setLocalDraftMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve })).mockResolvedValue(undefined)
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    render(<AutoUpdateSafetyProvider><Composer bufferKey={key} sessionId={sessionA.id} /></AutoUpdateSafetyProvider>)

    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '先に保存する本文' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(setLocalDraftMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveSave()
      await Promise.resolve()
    })
    expect(setLocalDraftMock).toHaveBeenNthCalledWith(2, sessionA.id, createComposerBackendKey(key), '')
    vi.useRealTimers()
  })

  it('keeps input and shows a generic error when persistence fails', async () => {
    vi.useFakeTimers()
    isDesktopRuntimeMock.mockReturnValue(true)
    setLocalDraftMock.mockRejectedValue(new Error('secret backend details'))
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    render(<AutoUpdateSafetyProvider><Composer bufferKey={key} sessionId={sessionA.id} /></AutoUpdateSafetyProvider>)

    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '保持する本文' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('保持する本文')
    expect(screen.getByText('この端末への保存に失敗しました。入力は保持されています。')).toBeInTheDocument()
    expect(screen.queryByText('secret backend details')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('keeps the same account across reauthentication while separating another account', () => {
    const reauthenticated = { ...sessionA, id: 'session-a-renewed' }
    const keyA = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const keyAAfterReauth = createComposerBufferKey(reauthenticated, 'project-1', '7', 'new', position)
    const keyB = createComposerBufferKey(sessionB, 'project-1', '7', 'new', position)

    expect(keyAAfterReauth).toBe(keyA)
    expect(keyB).not.toBe(keyA)
    expect(createComposerBackendKey(keyAAfterReauth)).toBe(createComposerBackendKey(keyB))
  })
})
