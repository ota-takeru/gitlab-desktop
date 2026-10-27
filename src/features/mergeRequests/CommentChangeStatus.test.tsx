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
