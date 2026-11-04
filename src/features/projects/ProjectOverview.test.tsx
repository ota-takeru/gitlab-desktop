import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { ProjectOverview } from './ProjectOverview'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

const readme = Array.from({ length: 400 }, (_, index) => `Line ${index}`).join('\n\n')
const commits = Array.from({ length: 8 }, (_, index) => ({ authorName: 'Ann', committedAt: '2026-11-04T12:00:00Z', createdAt: '2026-11-04T12:00:00Z', id: String(index).repeat(40), title: `Commit ${index}` }))
const mergeRequest = { author: { id: '1', name: 'Bob', username: 'bob' }, iid: '5', projectId: '7', state: 'opened', title: 'Open change', updatedAt: '2026-11-04T12:00:00Z' }

function result(data: unknown, extra: object = {}) {
  return { data, error: null, loading: false, previous: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false, ...extra }
}

beforeEach(() => {
  queryMock.mockReset().mockImplementation((_sessionId: string, query: { kind: string } | null) => {
    if (query?.kind === 'project') return result({ description: 'What this is' })
    if (query?.kind === 'repositoryCommits') return result(commits)
    if (query?.kind === 'mrs') return result([mergeRequest])
    if (query?.kind === 'tree') return result([{ id: 'r'.repeat(40), name: 'README.md', path: 'README.md', type: 'blob' }])
    if (query?.kind === 'blob') return result({ content: readme })
    return result(null)
  })
})

function renderOverview(props: Partial<Parameters<typeof ProjectOverview>[0]> = {}) {
  render(<ProjectOverview instanceUrl="https://gitlab.example" projectId="7" projectName="app" projectUrl="https://gitlab.example/team/app" sessionId="s" {...props} />)
}

it('shows the whole README under its file name', () => {
  renderOverview()
  expect(screen.getByRole('heading', { name: 'README.md' })).toBeTruthy()
  expect(screen.getByText('Line 0')).toBeTruthy()
  expect(screen.getByText('Line 399')).toBeTruthy()
})

it('shows the project description from its lookup by path', () => {
  renderOverview()
  expect(queryMock).toHaveBeenCalledWith('s', { kind: 'project', path: 'team/app' })
  expect(screen.getByText('What this is')).toBeTruthy()
})

it('lists the latest five commits and open MRs, each leading to its screen', () => {
  const onOpenCommit = vi.fn()
  const onOpenMergeRequest = vi.fn()
  const onShowHistory = vi.fn()
  const onShowMergeRequests = vi.fn()
  renderOverview({ onOpenCommit, onOpenMergeRequest, onShowHistory, onShowMergeRequests })

  const recent = within(screen.getByRole('region', { name: '最近の変更' }))
  expect(recent.getAllByRole('listitem')).toHaveLength(5)
  fireEvent.click(recent.getByRole('button', { name: /Commit 1/u }))
  expect(onOpenCommit).toHaveBeenCalledWith(commits[1].id)
  fireEvent.click(recent.getByRole('button', { name: 'すべて表示' }))
  expect(onShowHistory).toHaveBeenCalled()

  const open = within(screen.getByRole('region', { name: '開いているMR' }))
  fireEvent.click(open.getByRole('button', { name: /Open change/u }))
  expect(onOpenMergeRequest).toHaveBeenCalledWith({ iid: '5', projectId: '7' })
  fireEvent.click(open.getByRole('button', { name: 'すべて表示' }))
  expect(onShowMergeRequests).toHaveBeenCalled()
})

it('tells an empty list from a failed one', () => {
  queryMock.mockImplementation((_sessionId: string, query: { kind: string } | null) => {
    if (query?.kind === 'repositoryCommits') return result(null, { error: new Error('boom') })
    if (query?.kind === 'mrs') return result([])
    return result(null)
  })
  renderOverview()
  expect(screen.getByText('取得できませんでした: boom')).toBeTruthy()
  expect(screen.getByText('開いているMRはありません。')).toBeTruthy()
})
