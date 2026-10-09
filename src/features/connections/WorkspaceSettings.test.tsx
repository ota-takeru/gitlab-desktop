import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSession } from '../../types/gitlab'
import { WorkspaceSettings } from './WorkspaceSettings'

const mocks = vi.hoisted(() => ({
  enableDesktopNotifications: vi.fn(),
  setSettings: vi.fn(),
}))

vi.mock('./ConnectionProvider', () => ({
  useConnection: () => ({ session: {
    id: 'session-1',
    instanceUrl: 'https://gitlab.com',
    user: { id: '42', username: 'reviewer', name: 'Reviewer' },
    serverVersion: null,
  } satisfies GitLabSession }),
}))

vi.mock('../shared/personalWorkspace', () => ({
  usePersonalWorkspace: () => ({
    settings: { autoRefresh: true, notifyComments: false, notifyTodos: false },
    setSettings: mocks.setSettings,
  }),
}))

vi.mock('../../lib/notifications', () => ({
  enableDesktopNotifications: mocks.enableDesktopNotifications,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('WorkspaceSettings account lifecycle', () => {
  beforeEach(() => {
    mocks.enableDesktopNotifications.mockReset()
    mocks.setSettings.mockReset()
  })

  it('does not write notification settings when permission resolves after account replacement', async () => {
    const permission = deferred<boolean>()
    mocks.enableDesktopNotifications.mockReturnValue(permission.promise)
    render(<WorkspaceSettings />)

    fireEvent.click(screen.getByLabelText('担当・レビューMRへの新着コメントをデスクトップ通知'))
    expect(mocks.enableDesktopNotifications).toHaveBeenCalledTimes(1)

    act(() => globalThis.dispatchEvent(new Event('gitlab-account-replaced')))
    await act(async () => permission.resolve(true))

    expect(mocks.setSettings).not.toHaveBeenCalled()
  })

  it('saves a setting when the permission grant completes for the active account', async () => {
    mocks.enableDesktopNotifications.mockResolvedValue(true)
    render(<WorkspaceSettings />)

    fireEvent.click(screen.getByLabelText('メンション・承認依頼などの新しいTo-Doをデスクトップ通知'))

    await waitFor(() => expect(mocks.setSettings).toHaveBeenCalledWith({ notifyTodos: true }))
  })
})
