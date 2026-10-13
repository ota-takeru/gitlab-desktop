import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabSession } from '../../types/gitlab'
import { preferenceScope, scopedKey } from '../shared/preferences'
import { openWorkspaceTab, readWorkspace } from '../shared/personalWorkspace'
import { MergeRequestTabs } from './MergeRequestTabs'

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))

const sessionFixture: GitLabSession = {
  id: 'session-1',
  instanceUrl: 'https://gitlab.example',
  serverVersion: null,
  user: { id: '42', name: 'Reviewer', username: 'reviewer' },
}
const scope = preferenceScope(sessionFixture.instanceUrl, sessionFixture.user.id)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(scopedKey(scope, 'personal-workspace'), JSON.stringify({
    pinned: [{ projectId: '7', iid: '1' }],
    open: [{ projectId: '7', iid: '2' }, { projectId: '7', iid: '3' }],
    tabs: { '7:1': { projectPath: 'team/app', state: 'opened', title: '固定したMRの題名' }, '7:2': { projectPath: 'team/app', state: 'merged', title: '開いているMRの題名' } },
  }))
})

it('lists pinned tabs above open tabs with the remembered titles', () => {
  render(<MergeRequestTabs collapsed={false} onOpen={vi.fn()} selected={null} />)

  expect(within(screen.getByRole('list', { name: '固定したMR' })).getByText('固定したMRの題名')).toBeInTheDocument()
  const open = screen.getByRole('list', { name: '開いているMR' })
  expect(within(open).getByText('開いているMRの題名')).toBeInTheDocument()
  // A tab without a remembered title still shows which MR it is.
  expect(within(open).getByText('!3')).toBeInTheDocument()
})

it('pins and unpins in the sidebar, keeping an unpinned MR as an open tab', () => {
  render(<MergeRequestTabs collapsed={false} onOpen={vi.fn()} selected={null} />)

  fireEvent.click(screen.getByRole('button', { name: '!2を固定' }))
  expect(readWorkspace(scope).pinned.map((ref) => ref.iid)).toEqual(['2', '1'])
  expect(readWorkspace(scope).open.map((ref) => ref.iid)).toEqual(['3'])

  fireEvent.click(screen.getByRole('button', { name: '!1を固定解除' }))
  expect(readWorkspace(scope).pinned.map((ref) => ref.iid)).toEqual(['2'])
  expect(readWorkspace(scope).open.map((ref) => ref.iid)).toEqual(['1', '3'])
})

it('closing the shown tab opens its neighbour', () => {
  const onOpen = vi.fn()
  render(<MergeRequestTabs collapsed={false} onOpen={onOpen} selected={{ projectId: '7', iid: '2' }} />)

  fireEvent.click(screen.getByRole('button', { name: '!2を閉じる' }))
  expect(onOpen).toHaveBeenCalledWith({ projectId: '7', iid: '3' })
  expect(readWorkspace(scope).open.map((ref) => ref.iid)).toEqual(['3'])
})

it('adds an opened MR as the newest tab only when it has no tab yet', () => {
  openWorkspaceTab(scope, { projectId: '7', iid: '9' })
  openWorkspaceTab(scope, { projectId: '7', iid: '3' })
  openWorkspaceTab(scope, { projectId: '7', iid: '1' })
  expect(readWorkspace(scope).open.map((ref) => ref.iid)).toEqual(['9', '2', '3'])
  expect(readWorkspace(scope).pinned.map((ref) => ref.iid)).toEqual(['1'])
})
