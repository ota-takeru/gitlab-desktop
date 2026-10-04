import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitLabCommandError } from '../../types/gitlab'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed, useAutoUpdateSafety } from './AutoUpdateSafety'
import { clearGitLabMutationStates, useGitLabMutation } from './useGitLabMutation'

const { acknowledgePendingOperationMock, getPendingOperationMock, isTauriMock, mutateGitLabMock } = vi.hoisted(() => ({ acknowledgePendingOperationMock: vi.fn(), getPendingOperationMock: vi.fn(), isTauriMock: vi.fn(() => false), mutateGitLabMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')
  return { ...actual, isTauri: isTauriMock }
})

vi.mock('../../lib/gitlab', async () => {
  const actual = await vi.importActual<typeof import('../../lib/gitlab')>('../../lib/gitlab')
  return { ...actual, mutateGitLab: mutateGitLabMock }
})

vi.mock('../../lib/pendingOperations', async () => {
  const actual = await vi.importActual<typeof import('../../lib/pendingOperations')>('../../lib/pendingOperations')
  return { ...actual, acknowledgePendingOperation: acknowledgePendingOperationMock, getPendingOperation: getPendingOperationMock }
})

const action = { body: 'hello', iid: '1', kind: 'comment' as const, projectId: 'project-1', thread: false }
const nativeResource = JSON.stringify({ iid: '1', projectId: 'project-1' })
const wrapper = ({ children }: { children: ReactNode }) => <AutoUpdateSafetyProvider>{children}</AutoUpdateSafetyProvider>

describe('useGitLabMutation', () => {
  beforeEach(() => {
    mutateGitLabMock.mockReset()
    acknowledgePendingOperationMock.mockReset()
    getPendingOperationMock.mockReset()
    isTauriMock.mockReturnValue(false)
    clearGitLabMutationStates()
  })

  it('allows exactly one native write for rapid duplicate invocations', async () => {
    let resolve!: () => void
    mutateGitLabMock.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const { result } = renderHook(() => useGitLabMutation('session-1', 'project-1:1'))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.run(action)
      second = result.current.run(action)
    })
    expect(mutateGitLabMock).toHaveBeenCalledTimes(1)
    await expect(second).resolves.toBe(false)
    await act(async () => resolve())
    await expect(first).resolves.toBe(true)
    expect(result.current.status).toBe('success')
  })

  it('forwards a local draft key only when a composer supplies one', async () => {
    mutateGitLabMock.mockResolvedValue(undefined)
    const view = renderHook(() => useGitLabMutation('session-1', 'project-1:1'))

    await act(async () => { expect(await view.result.current.run(action, 'project-1:draft-key')).toBe(true) })
    expect(mutateGitLabMock).toHaveBeenCalledWith({ action, localDraftKey: 'project-1:draft-key', sessionId: 'session-1' })
  })

  it('keeps UNKNOWN_OUTCOME sticky across remount until explicit reset', async () => {
    mutateGitLabMock.mockRejectedValue(new GitLabCommandError({ code: 'UNKNOWN_OUTCOME', message: 'unknown' }))
    const first = renderHook(() => useGitLabMutation('session-1', 'project-1:1'))

    await act(async () => { await first.result.current.run(action) })
    expect(first.result.current.status).toBe('unknown')
    first.unmount()

    const second = renderHook(() => useGitLabMutation('session-1', 'project-1:1'))
    expect(second.result.current.status).toBe('unknown')
    await act(async () => { expect(await second.result.current.run(action)).toBe(false) })
    expect(mutateGitLabMock).toHaveBeenCalledTimes(1)

    act(() => second.result.current.reset())
    expect(second.result.current.status).toBe('idle')
  })

  it('keeps navigation unsafe until an in-flight write completes', async () => {
    let resolve!: () => void
    mutateGitLabMock.mockImplementation(() => new Promise<void>((done) => { resolve = done }))

    function Indicator() {
      return <output data-testid="safe">{useAutoUpdateAllowed() ? 'safe' : 'unsafe'}</output>
    }
    function Writer() {
      const [sent, setSent] = useState(false)
      const { setUnsafe } = useAutoUpdateSafety('writer:instance', { persistOnUnmount: true })
      const mutation = useGitLabMutation('session-1', 'project-1:1', setUnsafe)
      return <button disabled={sent} onClick={() => { setSent(true); void mutation.run(action) }}>send</button>
    }

    const view = render(<AutoUpdateSafetyProvider><Writer /><Indicator /></AutoUpdateSafetyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'send' }))
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    view.rerender(<AutoUpdateSafetyProvider><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    await act(async () => resolve())
    await waitFor(() => expect(screen.getByTestId('safe')).toHaveTextContent('safe'))
  })

  it('isolates sticky state by session and clears it on logout cleanup', async () => {
    mutateGitLabMock.mockRejectedValue(new GitLabCommandError({ code: 'UNKNOWN_OUTCOME', message: 'unknown' }))
    const first = renderHook(() => useGitLabMutation('session-1', 'project-1:1'), { wrapper })
    await act(async () => { await first.result.current.run(action) })
    first.unmount()

    const other = renderHook(() => useGitLabMutation('session-2', 'project-1:1'), { wrapper })
    expect(other.result.current.status).toBe('idle')
    other.unmount()

    act(() => clearGitLabMutationStates('session-1'))
    const restored = renderHook(() => useGitLabMutation('session-1', 'project-1:1'), { wrapper })
    expect(restored.result.current.status).toBe('idle')
  })

  it('hydrates a durable receipt after restart and acknowledges the exact receipt before unlocking', async () => {
    isTauriMock.mockReturnValue(true)
    const receipt = { action, id: 'receipt-1', startedAt: 1_700_000_000_000 }
    getPendingOperationMock.mockResolvedValue(receipt)
    acknowledgePendingOperationMock.mockResolvedValue(undefined)
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))

    await waitFor(() => expect(view.result.current.status).toBe('unknown'))
    expect(view.result.current.isLocked).toBe(true)
    expect(view.result.current.unknownAction).toEqual(action)
    await act(async () => { expect(await view.result.current.run(action)).toBe(false) })
    expect(mutateGitLabMock).not.toHaveBeenCalled()

    await act(async () => { expect(await view.result.current.reset()).toBe(true) })
    expect(acknowledgePendingOperationMock).toHaveBeenCalledWith({ iid: '1', projectId: 'project-1', receiptId: 'receipt-1', sessionId: 'session-1' })
    expect(view.result.current.status).toBe('idle')
    expect(view.result.current.isLocked).toBe(false)
  })

  it('keeps posting locked when receipt hydration fails', async () => {
    isTauriMock.mockReturnValue(true)
    getPendingOperationMock.mockRejectedValue(new GitLabCommandError({ code: 'NETWORK', message: 'offline' }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))

    await waitFor(() => expect(view.result.current.status).toBe('unknown'))
    await act(async () => { expect(await view.result.current.run(action)).toBe(false) })
    expect(mutateGitLabMock).not.toHaveBeenCalled()
    expect(view.result.current.isLocked).toBe(true)
  })

  it('keeps the durable receipt locked when acknowledgement fails', async () => {
    isTauriMock.mockReturnValue(true)
    getPendingOperationMock.mockResolvedValue({ action, id: 'receipt-2', startedAt: 1_700_000_000_001 })
    acknowledgePendingOperationMock.mockRejectedValue(new GitLabCommandError({ code: 'NETWORK', message: 'offline' }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))
    await waitFor(() => expect(view.result.current.status).toBe('unknown'))

    await act(async () => { expect(await view.result.current.reset()).toBe(false) })
    expect(view.result.current.status).toBe('unknown')
    expect(view.result.current.isLocked).toBe(true)
    expect(view.result.current.error?.code).toBe('NETWORK')
  })

  it('retries a failed hydration lookup when the user explicitly verifies the result', async () => {
    isTauriMock.mockReturnValue(true)
    getPendingOperationMock
      .mockRejectedValueOnce(new GitLabCommandError({ code: 'NETWORK', message: 'offline' }))
      .mockResolvedValueOnce(null)
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))

    await waitFor(() => expect(view.result.current.status).toBe('unknown'))
    expect(view.result.current.isLocked).toBe(true)

    await act(async () => { expect(await view.result.current.reset()).toBe(true) })
    expect(getPendingOperationMock).toHaveBeenCalledTimes(2)
    expect(view.result.current.status).toBe('idle')
    expect(view.result.current.isLocked).toBe(false)
  })

  it('can re-read a failed hydration lookup and restore the pending action without acknowledging it', async () => {
    isTauriMock.mockReturnValue(true)
    const receipt = { action, id: 'receipt-retry', startedAt: 1_700_000_000_004 }
    getPendingOperationMock
      .mockRejectedValueOnce(new GitLabCommandError({ code: 'NETWORK', message: 'offline' }))
      .mockResolvedValueOnce(receipt)
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))

    await waitFor(() => expect(view.result.current.status).toBe('unknown'))
    await act(async () => { expect(await view.result.current.retryLookup()).toBe(true) })

    expect(view.result.current.status).toBe('unknown')
    expect(view.result.current.unknownAction).toEqual(action)
    expect(acknowledgePendingOperationMock).not.toHaveBeenCalled()
  })

  it('refreshes an unknown result before acknowledging a receipt discovered during reset', async () => {
    isTauriMock.mockReturnValue(true)
    const receipt = { action, id: 'receipt-after-unknown', startedAt: 1_700_000_000_003 }
    getPendingOperationMock
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new GitLabCommandError({ code: 'NETWORK', message: 'offline' }))
      .mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce(receipt)
    acknowledgePendingOperationMock.mockResolvedValue(undefined)
    mutateGitLabMock.mockRejectedValue(new GitLabCommandError({ code: 'UNKNOWN_OUTCOME', message: 'unknown' }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))

    await waitFor(() => expect(getPendingOperationMock).toHaveBeenCalledTimes(1))
    await act(async () => { expect(await view.result.current.run(action)).toBe(false) })
    expect(view.result.current.status).toBe('unknown')
    expect(view.result.current.isLocked).toBe(true)

    await act(async () => { expect(await view.result.current.reset()).toBe(false) })
    expect(view.result.current.status).toBe('unknown')
    await act(async () => { expect(await view.result.current.reset()).toBe(true) })
    expect(getPendingOperationMock).toHaveBeenCalledTimes(4)
    expect(acknowledgePendingOperationMock).toHaveBeenCalledWith({ iid: '1', projectId: 'project-1', receiptId: receipt.id, sessionId: 'session-1' })
    expect(view.result.current.status).toBe('idle')
  })

  it('does not acknowledge a newer receipt discovered during explicit verification', async () => {
    isTauriMock.mockReturnValue(true)
    const initialReceipt = { action, id: 'receipt-before', startedAt: 1_700_000_000_005 }
    const newerAction = { body: 'newer', iid: '1', kind: 'reply' as const, discussionId: 'discussion-2', projectId: 'project-1' }
    const newerReceipt = { action: newerAction, id: 'receipt-after', startedAt: 1_700_000_000_006 }
    getPendingOperationMock
      .mockResolvedValueOnce(initialReceipt)
      .mockRejectedValueOnce(new GitLabCommandError({ code: 'NETWORK', message: 'offline' }))
      .mockResolvedValueOnce(newerReceipt)
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))

    await waitFor(() => expect(view.result.current.status).toBe('unknown'))
    await act(async () => { expect(await view.result.current.reset()).toBe(false) })
    await act(async () => { expect(await view.result.current.reset()).toBe(false) })

    expect(acknowledgePendingOperationMock).not.toHaveBeenCalled()
    expect(view.result.current.status).toBe('unknown')
    expect(view.result.current.unknownAction).toEqual(newerAction)
  })

  it('single-flights concurrent durable resets and acknowledges only once', async () => {
    isTauriMock.mockReturnValue(true)
    const receipt = { action, id: 'receipt-single-flight', startedAt: 1_700_000_000_007 }
    getPendingOperationMock.mockResolvedValue(receipt)
    let resolveAck!: () => void
    acknowledgePendingOperationMock.mockImplementation(() => new Promise<void>((resolve) => { resolveAck = resolve }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))
    await waitFor(() => expect(view.result.current.status).toBe('unknown'))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = view.result.current.reset() as Promise<boolean>
      second = view.result.current.reset() as Promise<boolean>
    })
    expect(second).toBe(first)
    await waitFor(() => expect(acknowledgePendingOperationMock).toHaveBeenCalledTimes(1))

    resolveAck()
    await act(async () => { expect(await Promise.all([first, second])).toEqual([true, true]) })
    expect(view.result.current.status).toBe('idle')
  })

  it('does not resurrect a late hydration response after logout cleanup', async () => {
    isTauriMock.mockReturnValue(true)
    let resolveRefresh!: (value: null) => void
    getPendingOperationMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => new Promise((done) => { resolveRefresh = done }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))
    await waitFor(() => expect(getPendingOperationMock).toHaveBeenCalledTimes(1))
    mutateGitLabMock.mockRejectedValue(new GitLabCommandError({ code: 'UNKNOWN_OUTCOME', message: 'unknown' }))
    let result!: Promise<boolean>
    act(() => { result = view.result.current.run(action) })
    await waitFor(() => expect(getPendingOperationMock).toHaveBeenCalledTimes(2))

    act(() => clearGitLabMutationStates('session-1'))
    resolveRefresh(null)
    await act(async () => { expect(await result).toBe(false) })

    expect(view.result.current.status).toBe('pending')
    expect(view.result.current.unknownAction).toBeNull()
  })

  it('returns a cancelled result when a write succeeds after logout cleanup', async () => {
    let resolve!: () => void
    mutateGitLabMock.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const view = renderHook(() => useGitLabMutation('session-1', 'project-1:1'))
    let result!: Promise<ReturnType<typeof view.result.current.runDetailed> extends Promise<infer Outcome> ? Outcome : never>
    act(() => { result = view.result.current.runDetailed(action) })
    expect(mutateGitLabMock).toHaveBeenCalledTimes(1)

    act(() => clearGitLabMutationStates('session-1'))
    resolve()
    await act(async () => {
      const outcome = await result
      expect(outcome.ok).toBe(false)
      expect(outcome.status).toBe('error')
      expect(outcome.error?.code).toBe('CANCELLED')
    })
    expect(view.result.current.status).toBe('pending')
  })

  it('waits for hydration before sending a new write', async () => {
    isTauriMock.mockReturnValue(true)
    let resolve!: (value: null) => void
    getPendingOperationMock.mockImplementation(() => new Promise((done) => { resolve = done }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))
    let result!: Promise<boolean>
    act(() => { result = view.result.current.run(action) })
    expect(mutateGitLabMock).not.toHaveBeenCalled()
    resolve(null)
    mutateGitLabMock.mockResolvedValue(undefined)
    await act(async () => { expect(await result).toBe(true) })
    expect(mutateGitLabMock).toHaveBeenCalledTimes(1)
  })

  it('uses the native receipt action when an unknown write reports a different stored action', async () => {
    isTauriMock.mockReturnValue(true)
    const storedAction = { body: 'stored', iid: '1', kind: 'reply' as const, discussionId: 'discussion-1', projectId: 'project-1' }
    getPendingOperationMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ action: storedAction, id: 'receipt-3', startedAt: 1_700_000_000_002 })
    mutateGitLabMock.mockRejectedValue(new GitLabCommandError({ code: 'UNKNOWN_OUTCOME', message: 'unknown' }))
    const view = renderHook(() => useGitLabMutation('session-1', nativeResource))
    await waitFor(() => expect(getPendingOperationMock).toHaveBeenCalledTimes(1))

    await act(async () => { expect(await view.result.current.run(action)).toBe(false) })
    expect(view.result.current.status).toBe('unknown')
    expect(view.result.current.unknownAction).toEqual(storedAction)
  })
})
