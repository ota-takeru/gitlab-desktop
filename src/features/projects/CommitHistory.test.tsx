import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { Commit, GitLabBranch, GitLabSession } from '../../types/gitlab'
import { CommitHistory } from './CommitHistory'

const { queryMock, diffMock } = vi.hoisted(() => ({ queryMock: vi.fn(), diffMock: vi.fn() }))

vi.mock('../connections/connectionContext', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../mergeRequests/useAllDiffPages', () => ({ useAllDiffPages: diffMock }))
vi.mock('../mergeRequests/DiffViewer', () => ({ DiffViewer: ({ allowComments, diffs, fileSource }: { allowComments: boolean; diffs: { newPath: string }[]; fileSource: { beforeSha?: string; sha: string } }) => <div data-testid="diff">{`${String(allowComments)}|${diffs.map((diff) => diff.newPath).join(',')}|${fileSource.sha}|${fileSource.beforeSha ?? ''}`}</div> }))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: null, user: { id: '42', name: 'Reviewer', username: 'reviewer' } }
const sha = (char: string) => char.repeat(40)
const commits: Commit[] = [
  { authorName: 'Ann', committedAt: '2026-11-04T12:00:00Z', createdAt: '2026-11-04T12:00:00Z', id: sha('a'), message: 'Newest\n\nWhy it changed', parentIds: [sha('b')], title: 'Newest' },
  { authorName: 'Bob', committedAt: '2026-11-04T11:00:00Z', createdAt: '2026-11-04T11:00:00Z', id: sha('b'), parentIds: [sha('c')], title: 'Middle' },
  { authorName: 'Cy', committedAt: '2026-10-01T11:00:00Z', createdAt: '2026-10-01T11:00:00Z', id: sha('c'), parentIds: [], title: 'Oldest' },
]
const branches: GitLabBranch[] = [{ commit: null, default: true, merged: false, name: 'main', protected: true, webUrl: '' }]

function result(data: unknown, extra: object = {}) {
  return { data, error: null, loading: false, previous: false, refreshing: false, refresh: vi.fn(), snapshot: data ? { completeness: 'complete', data, fetchedAt: 1, nextPage: null, source: 'network' } : null, stale: false, ...extra }
}

beforeEach(() => {
  diffMock.mockReset().mockReturnValue(result([{ deletedFile: false, diff: '', newPath: 'src/a.ts', oldPath: 'src/a.ts' }]))
  queryMock.mockReset().mockImplementation((_sessionId: string, query: { kind: string; sha?: string } | null) => {
    if (query?.kind === 'repositoryCommits') return result(commits)
    if (query?.kind === 'branches') return result(branches)
    if (query?.kind === 'repositoryCommit') return result(commits.find((commit) => commit.id === query.sha))
    if (query?.kind === 'commitMergeRequests') return result([{ iid: '9', projectId: '7', state: 'merged', title: 'The change', webUrl: 'https://gitlab.example/x/-/merge_requests/9' }])
    return result(null)
  })
})

it('lists a branch and path by day and opens a commit', () => {
  const onNavigate = vi.fn()
  render(<CommitHistory location={{ path: 'src', ref: 'feature/x' }} onNavigate={onNavigate} projectId="7" projectName="app" />)

  expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'repositoryCommits', page: 1, path: 'src', projectId: '7', ref: 'feature/x' }, { keepPrevious: true })
  // Two commits on one day and one on another make two days.
  const days = within(screen.getByRole('group', { name: 'コミット' })).getAllByRole('list')
  expect(days).toHaveLength(2)
  expect(within(days[0]).getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /Middle/u }))
  expect(onNavigate).toHaveBeenCalledWith({ path: 'src', ref: 'feature/x', sha: sha('b') })
})

it('applies the path box and offers to clear a path that matches nothing', () => {
  const onNavigate = vi.fn()
  queryMock.mockImplementation((_sessionId: string, query: { kind: string } | null) => query?.kind === 'repositoryCommits' ? result([]) : result(query?.kind === 'branches' ? branches : null))
  render(<CommitHistory location={{ path: 'gone', ref: 'dev' }} onNavigate={onNavigate} projectId="7" projectName="app" />)

  fireEvent.click(screen.getByRole('button', { name: 'パスの絞り込みを解除' }))
  expect(onNavigate).toHaveBeenLastCalledWith({ ref: 'dev' })
  fireEvent.change(screen.getByRole('textbox', { name: 'パスで絞り込む' }), { target: { value: '/src/lib/' } })
  fireEvent.submit(screen.getByRole('textbox', { name: 'パスで絞り込む' }).closest('form') as HTMLFormElement)
  expect(onNavigate).toHaveBeenLastCalledWith({ path: 'src/lib', ref: 'dev' })
})

it('shows a commit with its message, related MR and read-only changes from its parent', () => {
  const onOpenMergeRequest = vi.fn()
  render(<CommitHistory location={{ sha: sha('a') }} onNavigate={vi.fn()} onOpenMergeRequest={onOpenMergeRequest} projectId="7" projectName="app" />)

  expect(screen.getByText('Why it changed')).toBeTruthy()
  expect(screen.getByTestId('diff').textContent).toBe(`false|src/a.ts|${sha('a')}|${sha('b')}`)
  fireEvent.click(screen.getByRole('button', { name: /!9 The change/u }))
  expect(onOpenMergeRequest).toHaveBeenCalledWith({ iid: '9', projectId: '7' })
})

it('moves to the neighbouring commits of the list and returns to it with the keys', () => {
  const onNavigate = vi.fn()
  const { container } = render(<CommitHistory location={{ ref: 'dev', sha: sha('b') }} onNavigate={onNavigate} projectId="7" projectName="app" />)
  const detail = container.querySelector('[tabindex="-1"]') as HTMLElement

  fireEvent.keyDown(detail, { key: 'j' })
  expect(onNavigate).toHaveBeenLastCalledWith({ ref: 'dev', sha: sha('c') })
  fireEvent.keyDown(detail, { key: 'k' })
  expect(onNavigate).toHaveBeenLastCalledWith({ ref: 'dev', sha: sha('a') })
  fireEvent.keyDown(detail, { key: 'Escape' })
  expect(onNavigate).toHaveBeenLastCalledWith({ ref: 'dev' })
})

it('opens a commit that is not in the list without offering neighbours', () => {
  render(<CommitHistory location={{ sha: sha('d') }} onNavigate={vi.fn()} projectId="7" projectName="app" />)
  expect(screen.queryByRole('button', { name: '古いコミットへ' })).toBeNull()
  expect(screen.getByRole('button', { name: '変更履歴に戻る' })).toBeTruthy()
})
