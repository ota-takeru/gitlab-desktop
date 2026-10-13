import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabSession } from '../../types/gitlab'
import { preferenceScope, scopedKey } from '../shared/preferences'
import { readWorkspace, type MrRef } from '../shared/personalWorkspace'
import { MergeRequestShortcuts } from './MergeRequestShortcuts'

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: () => ({ data: null, error: new Error('not found'), loading: false }),
}))

const sessionFixture: GitLabSession = {
  id: 'session-1',
  instanceUrl: 'https://gitlab.example',
  serverVersion: null,
  user: { id: '42', name: 'Reviewer', username: 'reviewer' },
}
const scope = preferenceScope(sessionFixture.instanceUrl, sessionFixture.user.id)
const pinnedRefs: MrRef[] = [{ projectId: '7', iid: '3' }, { projectId: '7', iid: '4' }]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(scopedKey(scope, 'personal-workspace'), JSON.stringify({ pinned: pinnedRefs, recent: pinnedRefs }))
})

it('unpins a merge request from the pinned list, even when it can no longer be loaded', () => {
  render(<MergeRequestShortcuts kind="pinned" onOpen={() => undefined} />)

  fireEvent.click(screen.getByRole('button', { name: '!3を固定解除' }))

  expect(readWorkspace(scope).pinned).toEqual([{ projectId: '7', iid: '4' }])
  expect(screen.queryByRole('button', { name: '!3を固定解除' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '!4を固定解除' })).toBeInTheDocument()
})

it('does not offer unpinning in the recent list', () => {
  render(<MergeRequestShortcuts kind="recent" onOpen={() => undefined} />)

  expect(screen.queryByRole('button', { name: /固定解除/u })).not.toBeInTheDocument()
})
