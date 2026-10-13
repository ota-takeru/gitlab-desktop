import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabSession } from '../../types/gitlab'
import { preferenceScope, scopedKey } from '../shared/preferences'
import type { MrRef } from '../shared/personalWorkspace'
import { RecentMergeRequests } from './RecentMergeRequests'

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
const recentRefs: MrRef[] = [{ projectId: '7', iid: '3' }, { projectId: '7', iid: '4' }]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(scopedKey(scope, 'personal-workspace'), JSON.stringify({ pinned: [], recent: recentRefs }))
})

it('lists recent merge requests, even unloadable ones, without pin controls', () => {
  const onOpen = vi.fn()
  render(<RecentMergeRequests onOpen={onOpen} />)

  expect(screen.getByRole('heading', { name: '最近開いたMR' })).toBeInTheDocument()
  expect(screen.getAllByText('プロジェクト 7 !3').length).toBeGreaterThan(0)
  expect(screen.getAllByText('プロジェクト 7 !4').length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /固定/u })).not.toBeInTheDocument()
})
