import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabBranch, GitLabSession } from '../../types/gitlab'
import { BranchList } from './BranchList'
import { forgetRememberedListStates } from './listState'

const { openGitLabUrlMock, queryMock } = vi.hoisted(() => ({ openGitLabUrlMock: vi.fn(), queryMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../../lib/gitlab', async (importOriginal) => ({ ...await importOriginal<object>(), openGitLabUrl: openGitLabUrlMock }))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: null, user: { id: '42', name: 'Reviewer', username: 'reviewer' } }
const feature: GitLabBranch = {
  commit: { authorName: 'Alice', committedDate: '2026-10-09T00:00:00.000Z', id: 'abc123', shortId: 'abc1', title: 'Add search' },
  default: false,
  merged: true,
  name: 'feature/search',
  protected: false,
  webUrl: 'https://gitlab.example/group/project/-/tree/feature/search',
}
const main: GitLabBranch = { commit: null, default: true, merged: false, name: 'main', protected: true, webUrl: '' }

function result(data: GitLabBranch[] | null, extra: object = {}) {
  return { data, error: null, loading: false, refreshing: false, refresh: vi.fn(), snapshot: data ? { completeness: 'complete', data, fetchedAt: 1, nextPage: null, source: 'network' } : null, stale: false, ...extra }
}

beforeEach(() => {
  forgetRememberedListStates()
  queryMock.mockReset().mockReturnValue(result([feature, main]))
  openGitLabUrlMock.mockReset().mockResolvedValue(undefined)
})

it('lists branches with their state and latest commit, and searches by name', () => {
  render(<BranchList onShowMergeRequests={vi.fn()} projectId="7" projectName="group/project" />)

  expect(queryMock).toHaveBeenLastCalledWith('session-1', { kind: 'branches', page: 1, projectId: '7', search: '' })
  expect(screen.getByRole('heading', { name: 'group/projectのブランチ' })).toBeInTheDocument()
  expect(screen.getByText('2件取得')).toBeInTheDocument()
  expect(screen.getByText('マージ済み')).toBeInTheDocument()
  expect(screen.getByText('デフォルト')).toBeInTheDocument()
  expect(screen.getByText('保護')).toBeInTheDocument()
  expect(screen.getByText(/Add search · Alice/u)).toBeInTheDocument()

  fireEvent.change(screen.getByRole('textbox', { name: 'ブランチを検索' }), { target: { value: ' feat ' } })
  fireEvent.click(screen.getByRole('button', { name: '検索' }))
  expect(queryMock).toHaveBeenLastCalledWith('session-1', { kind: 'branches', page: 1, projectId: '7', search: 'feat' })
})

it('opens the MRs of a branch from its row and the branch on GitLab from its action', async () => {
  const onShowMergeRequests = vi.fn()
  render(<BranchList onShowMergeRequests={onShowMergeRequests} projectId="7" projectName="group/project" />)

  fireEvent.click(screen.getByRole('button', { name: 'feature/searchをGitLabで開く' }))
  await waitFor(() => expect(openGitLabUrlMock).toHaveBeenCalledWith('session-1', feature.webUrl))
  expect(onShowMergeRequests).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'mainをGitLabで開く' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'feature/searchのMRを表示' }))
  expect(onShowMergeRequests).toHaveBeenCalledWith('feature/search')
})

it('tells an empty project from an unmatched search, and shows a failed fetch with retry', () => {
  queryMock.mockReturnValue(result([]))
  const view = render(<BranchList onShowMergeRequests={vi.fn()} projectId="7" projectName="group/project" />)
  expect(screen.getByText('ブランチはありません')).toBeInTheDocument()

  fireEvent.change(screen.getByRole('textbox', { name: 'ブランチを検索' }), { target: { value: 'nothing' } })
  fireEvent.click(screen.getByRole('button', { name: '検索' }))
  expect(screen.getByText('一致するブランチがありません')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '検索をクリア' }))
  expect(screen.getByText('ブランチはありません')).toBeInTheDocument()

  view.unmount()
  queryMock.mockReturnValue(result(null, { error: { code: 'NETWORK', message: '接続できません' } }))
  render(<BranchList onShowMergeRequests={vi.fn()} projectId="7" projectName="group/project" />)
  expect(screen.getByText('接続できません')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument()
})

it('keeps the search of each project when its branches are opened again', () => {
  const view = render(<BranchList onShowMergeRequests={vi.fn()} projectId="7" projectName="group/project" />)
  fireEvent.change(screen.getByRole('textbox', { name: 'ブランチを検索' }), { target: { value: 'feat' } })
  fireEvent.click(screen.getByRole('button', { name: '検索' }))
  view.unmount()

  const other = render(<BranchList onShowMergeRequests={vi.fn()} projectId="8" projectName="group/other" />)
  expect(screen.getByRole('textbox', { name: 'ブランチを検索' })).toHaveValue('')
  other.unmount()

  render(<BranchList onShowMergeRequests={vi.fn()} projectId="7" projectName="group/project" />)
  expect(screen.getByRole('textbox', { name: 'ブランチを検索' })).toHaveValue('feat')
  expect(queryMock).toHaveBeenLastCalledWith('session-1', { kind: 'branches', page: 1, projectId: '7', search: 'feat' })
})
