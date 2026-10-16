import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabBranch, GitLabSession, TreeEntry } from '../../types/gitlab'
import { CodeBrowser } from './CodeBrowser'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: null, user: { id: '42', name: 'Reviewer', username: 'reviewer' } }
const blobSha = 'b'.repeat(40)
const entries: TreeEntry[] = [
  { id: blobSha, name: 'README.md', path: 'docs/README.md', type: 'blob' },
  { id: 'a'.repeat(40), name: 'api', path: 'docs/api', type: 'tree' },
  { id: 'c'.repeat(40), name: 'vendor', path: 'docs/vendor', type: 'commit' },
]
const branches: GitLabBranch[] = [
  { commit: null, default: false, merged: false, name: 'feature/x', protected: false, webUrl: '' },
  { commit: null, default: true, merged: false, name: 'main', protected: true, webUrl: '' },
]
const fileContent = { content: 'line one\nline two\n' }

function result(data: unknown, extra: object = {}) {
  return { data, error: null, loading: false, previous: false, refreshing: false, refresh: vi.fn(), snapshot: data ? { completeness: 'complete', data, fetchedAt: 1, nextPage: null, source: 'network' } : null, stale: false, ...extra }
}

beforeEach(() => {
  queryMock.mockReset().mockImplementation((_sessionId: string, query: { kind: string } | null) => {
    if (query?.kind === 'tree') return result(entries)
    if (query?.kind === 'branches') return result(branches)
    if (query?.kind === 'blob') return result(fileContent)
    return result(null)
  })
})

it('lists a folder with folders first and opens folders, files and the parent folder', () => {
  const onNavigate = vi.fn()
  render(<CodeBrowser location={{ path: 'docs', ref: 'feature/x' }} onNavigate={onNavigate} projectId="7" projectName="group/project" />)

  expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'tree', page: 1, path: 'docs', projectId: '7', ref: 'feature/x' }, { keepPrevious: true })
  const rows = within(screen.getByRole('list', { name: 'ファイル' })).getAllByRole('listitem').map((row) => row.textContent)
  expect(rows).toEqual(['..', 'api', 'README.md', 'vendorサブモジュール'])

  fireEvent.click(screen.getByRole('button', { name: 'api' }))
  expect(onNavigate).toHaveBeenLastCalledWith({ path: 'docs/api', ref: 'feature/x' })
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  expect(onNavigate).toHaveBeenLastCalledWith({ file: { path: 'docs/README.md', sha: blobSha }, path: 'docs', ref: 'feature/x' })
  fireEvent.click(screen.getByRole('button', { name: '上のフォルダへ' }))
  expect(onNavigate).toHaveBeenLastCalledWith({ path: '', ref: 'feature/x' })
  // A submodule points at another repository, so it does not open.
  expect(screen.getByText('vendor').closest('button')).toBeDisabled()
})

it('shows a file by its blob id with line numbers, and fetches no folder meanwhile', () => {
  render(<CodeBrowser location={{ file: { path: 'docs/README.md', sha: blobSha }, path: 'docs' }} onNavigate={vi.fn()} projectId="7" projectName="group/project" />)

  expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'blob', projectId: '7', sha: blobSha })
  expect(queryMock).not.toHaveBeenCalledWith('session-1', expect.objectContaining({ kind: 'tree' }), expect.anything())
  expect(screen.getAllByTestId('file-line').map((line) => line.textContent)).toEqual(['1line one', '2line two'])
  expect(within(screen.getByRole('navigation', { name: '場所' })).getByText('README.md')).toBeInTheDocument()
})

it('names the default branch and starts at the top of the repository when another branch is chosen', () => {
  const onNavigate = vi.fn()
  render(<CodeBrowser location={{ path: 'docs' }} onNavigate={onNavigate} projectId="7" projectName="group/project" />)

  expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'tree', page: 1, path: 'docs', projectId: '7' }, { keepPrevious: true })
  const branch = screen.getByRole('combobox', { name: 'ブランチ' })
  expect(branch).toHaveTextContent('main（デフォルト）')
  fireEvent.mouseDown(branch)
  fireEvent.click(screen.getByRole('option', { name: 'feature/x' }))
  expect(onNavigate).toHaveBeenLastCalledWith({ path: '', ref: 'feature/x' })
})

it('explains a missing folder instead of showing an empty one', () => {
  queryMock.mockImplementation((_sessionId: string, query: { kind: string } | null) => query?.kind === 'tree'
    ? result(null, { error: { code: 'NOT_FOUND', message: 'not found' } })
    : result(query?.kind === 'branches' ? branches : null))
  render(<CodeBrowser location={{ path: 'gone', ref: 'feature/x' }} onNavigate={vi.fn()} projectId="7" projectName="group/project" />)

  expect(screen.getByRole('alert')).toHaveTextContent('フォルダが見つかりません')
})
