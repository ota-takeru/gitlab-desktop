import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { Position } from '../../types/gitlab'
import { CommentChangeStatus } from './CommentChangeStatus'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

const oldSha = 'b'.repeat(40)
const newSha = 'a'.repeat(40)
const position: Position = { baseSha: 'c'.repeat(40), headSha: oldSha, newLine: 2, newPath: 'src/a.ts', oldPath: 'src/a.ts', positionType: 'text', startSha: 'c'.repeat(40) }

function serve(files: Record<string, string | undefined>) {
  queryMock.mockReset().mockImplementation((_session: string, query: { sha: string } | null) => {
    const content = query ? files[query.sha] : undefined
    return { data: content === undefined ? undefined : { content }, error: null, loading: Boolean(query) && content === undefined }
  })
}

beforeEach(() => serve({}))

it('shows that the commented code changed without being asked', () => {
  serve({ [oldSha]: 'one\nreturn 1\nthree', [newSha]: 'one\nreturn 2\nthree' })
  render(<CommentChangeStatus headSha={newSha} position={position} projectId="42" sessionId="s" />)
  expect(screen.getByText('コード変更の可能性')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(queryMock).toHaveBeenCalledWith('s', { kind: 'file', path: 'src/a.ts', projectId: '42', sha: oldSha })
  expect(queryMock).toHaveBeenCalledWith('s', { kind: 'file', path: 'src/a.ts', projectId: '42', sha: newSha })
})

it('shows unchanged code and the progress while both versions are read', () => {
  serve({ [oldSha]: 'one\nreturn 1\nthree' })
  const { rerender } = render(<CommentChangeStatus headSha={newSha} position={position} projectId="42" sessionId="s" />)
  expect(screen.getByRole('status')).toHaveTextContent('コードを照合中…')
  serve({ [oldSha]: 'one\nreturn 1\nthree', [newSha]: 'zero\none\nreturn 1\nthree' })
  rerender(<CommentChangeStatus headSha={newSha} position={{ ...position }} projectId="42" sessionId="s" />)
  expect(screen.getByText('コード一致')).toBeInTheDocument()
})

it('reads nothing for a comment it cannot track', () => {
  render(<CommentChangeStatus headSha={newSha} position={{ ...position, newLine: undefined, oldLine: 2 }} projectId="42" sessionId="s" />)
  expect(screen.getByText('コードの追跡はできません')).toBeInTheDocument()
  expect(queryMock.mock.calls.every(([, query]) => query === null)).toBe(true)
})

function serveMoved(diff: { oldPath: string; newPath: string; renamedFile?: boolean; deletedFile?: boolean }, renamedContent?: string) {
  queryMock.mockReset().mockImplementation((_session: string, query: { kind: string; path?: string; sha?: string } | null) => {
    if (!query) return { data: undefined, error: null, loading: false }
    if (query.kind === 'versionCompare') return { data: [{ renamedFile: false, deletedFile: false, ...diff }], error: null, loading: false }
    if (query.sha === oldSha) return { data: { content: 'one\nreturn 1\nthree' }, error: null, loading: false }
    if (query.path === diff.newPath && renamedContent !== undefined) return { data: { content: renamedContent }, error: null, loading: false }
    return { data: undefined, error: new Error('404 File Not Found'), loading: false }
  })
}

it('follows a file renamed after the comment and compares the code under its new name', () => {
  serveMoved({ oldPath: 'src/a.ts', newPath: 'src/b.ts', renamedFile: true }, 'zero\none\nreturn 1\nthree')
  render(<CommentChangeStatus headSha={newSha} iid="7" position={position} projectId="42" sessionId="s" />)
  expect(screen.getByText('コード一致')).toBeInTheDocument()
  expect(queryMock).toHaveBeenCalledWith('s', { fromSha: oldSha, iid: '7', kind: 'versionCompare', page: 1, projectId: '42', toSha: newSha })
  expect(queryMock).toHaveBeenCalledWith('s', { kind: 'file', path: 'src/b.ts', projectId: '42', sha: newSha })
})

it('reports a deleted file as a change, and an unexplained missing file as a failed check', () => {
  serveMoved({ oldPath: 'src/a.ts', newPath: 'src/a.ts', deletedFile: true })
  const { unmount } = render(<CommentChangeStatus headSha={newSha} iid="7" position={position} projectId="42" sessionId="s" />)
  expect(screen.getByText('コード変更の可能性')).toBeInTheDocument()
  unmount()
  serveMoved({ oldPath: 'src/other.ts', newPath: 'src/other2.ts', renamedFile: true })
  render(<CommentChangeStatus headSha={newSha} iid="7" position={position} projectId="42" sessionId="s" />)
  expect(screen.getByText('検証不能（取得失敗）')).toBeInTheDocument()
})
