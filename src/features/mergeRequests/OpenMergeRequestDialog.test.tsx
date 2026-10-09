import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queryGitLab: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: {
    id: 'session-1',
    instanceUrl: 'https://gitlab.com',
    user: { id: '42', username: 'reviewer', name: 'Reviewer' },
    serverVersion: null,
  } }),
}))

vi.mock('../../lib/gitlab', () => ({ queryGitLab: mocks.queryGitLab }))

import { OpenMergeRequestDialog } from './OpenMergeRequestDialog'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function enterValidUrl() {
  fireEvent.change(screen.getByLabelText('MR URL'), {
    target: { value: 'https://gitlab.com/group/project/-/merge_requests/120' },
  })
  fireEvent.click(screen.getByRole('button', { name: '開く' }))
}

describe('OpenMergeRequestDialog account lifecycle', () => {
  beforeEach(() => mocks.queryGitLab.mockReset())

  it('does not navigate when project lookup resolves after account replacement', async () => {
    const lookup = deferred<{ data: { id: string } }>()
    mocks.queryGitLab.mockReturnValue(lookup.promise)
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(<OpenMergeRequestDialog open onClose={onClose} onOpen={onOpen} />)

    enterValidUrl()
    await waitFor(() => expect(mocks.queryGitLab).toHaveBeenCalledTimes(1))
    act(() => globalThis.dispatchEvent(new Event('gitlab-account-replaced')))
    await act(async () => lookup.resolve({ data: { id: '7' } }))

    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens the resolved MR for the active account', async () => {
    mocks.queryGitLab.mockResolvedValue({ data: { id: '7' } })
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(<OpenMergeRequestDialog open onClose={onClose} onOpen={onOpen} />)

    enterValidUrl()

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ projectId: '7', iid: '120' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
