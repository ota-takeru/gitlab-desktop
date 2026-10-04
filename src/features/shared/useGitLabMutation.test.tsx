import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitLabCommandError } from '../../types/gitlab'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed, useAutoUpdateSafety } from './AutoUpdateSafety'
import { clearGitLabMutationStates, useGitLabMutation } from './useGitLabMutation'

const { mutateGitLabMock } = vi.hoisted(() => ({ mutateGitLabMock: vi.fn() }))

vi.mock('../../lib/gitlab', async () => {
  const actual = await vi.importActual<typeof import('../../lib/gitlab')>('../../lib/gitlab')
  return { ...actual, mutateGitLab: mutateGitLabMock }
})

const action = { body: 'hello', iid: '1', kind: 'comment' as const, projectId: 'project-1', thread: false }
const wrapper = ({ children }: { children: ReactNode }) => <AutoUpdateSafetyProvider>{children}</AutoUpdateSafetyProvider>

describe('useGitLabMutation', () => {
  beforeEach(() => {
    mutateGitLabMock.mockReset()
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
})
