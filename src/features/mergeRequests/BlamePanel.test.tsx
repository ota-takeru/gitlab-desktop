import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { BlamePanel } from './BlamePanel'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../../lib/gitlab', () => ({ openGitLabUrl: vi.fn() }))

beforeEach(() => {
  queryMock.mockReset().mockImplementation((_session: string, query: { kind: string } | null) => {
    if (query?.kind === 'blame') return {
      data: [{ authorName: 'Alice', commitId: 'abc123456789', committedAt: '2026-09-01T10:00:00Z', lines: ['const a = 1'], title: 'Introduce a' }],
      error: null, loading: false,
    }
    if (query?.kind === 'commitMergeRequests') return {
      data: [{ iid: '12', projectId: '7', state: 'merged', title: 'Introduce a', webUrl: 'https://gitlab.example/x/-/merge_requests/12' }],
      error: null, loading: false,
    }
    return { data: null, error: null, loading: false }
  })
})

it('only requests related merge requests after selecting a blame commit', () => {
  render(<BlamePanel anchorLine={18} path="src/example.ts" projectId="7" sessionId="session1" sha={'a'.repeat(40)} />)
  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', startLine: 18, endLine: 97 }))
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'commitMergeRequests')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /abc12345.*関連MR/ }))
  expect(queryMock).toHaveBeenCalledWith('session1', { kind: 'commitMergeRequests', projectId: '7', sha: 'abc123456789' })
  expect(screen.getByRole('button', { name: /!12 Introduce a/ })).toBeInTheDocument()
})
