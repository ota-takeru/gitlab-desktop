import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { BlameCell, BlameProvider } from './BlamePanel'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../../lib/gitlab', () => ({ openGitLabUrl: vi.fn() }))

const newSha = 'a'.repeat(40)
const oldSha = 'b'.repeat(40)
const block = (sha: string) => ({ authorName: 'Alice', commitId: sha, committedAt: '2026-09-01T10:00:00Z', lines: ['one', 'two', 'three'], title: 'Introduce a' })

beforeEach(() => {
  queryMock.mockReset().mockImplementation((_session: string, query: { kind: string; sha?: string } | null) => {
    if (query?.kind === 'blame') return { data: [block(query.sha === oldSha ? oldSha : newSha)], error: null, loading: false }
    if (query?.kind === 'commitMergeRequests') return {
      data: [{ iid: '12', projectId: '7', state: 'merged', title: 'Introduce a', webUrl: 'https://gitlab.example/x/-/merge_requests/12' }],
      error: null, loading: false,
    }
    return { data: null, error: null, loading: false }
  })
})

it('shows attribution beside code only once, and loads the related MRs only after selecting a commit', () => {
  render(<BlameProvider beforeSha={oldSha} lines={[{ kind: 'context', newLine: 1, oldLine: 1, newPath: 'src/test.ts', oldPath: 'src/test.ts', text: 'only code', prefix: ' ', commentable: true }]} newPath="src/test.ts" oldPath="src/test.ts" projectId="7" sessionId="session1" sha={newSha}>
    <BlameCell line={1} side="new" /><code>only code</code>
    <BlameCell line={1} side="old" />
  </BlameProvider>)
  expect(screen.getAllByText('only code')).toHaveLength(1)
  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', path: 'src/test.ts', sha: newSha, startLine: 1, endLine: 80 }))
  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', sha: oldSha, startLine: 1, endLine: 80 }))
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'commitMergeRequests')).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: /1行のBlame: aaaaaaaa/ }))
  expect(screen.getByRole('dialog', { name: 'Blameのコミット詳細' })).toBeInTheDocument()
  expect(queryMock).toHaveBeenCalledWith('session1', { kind: 'commitMergeRequests', projectId: '7', sha: newSha })
  expect(screen.getByRole('button', { name: /!12 Introduce a/ })).toBeInTheDocument()
})

it('never attributes removed code to the new revision when its old SHA is unknown', () => {
  render(<BlameProvider lines={[{ kind: 'remove', oldLine: 17, oldPath: 'old.ts', newPath: 'new.ts', text: 'old', prefix: '-', commentable: true }]} newPath="new.ts" oldPath="old.ts" projectId="7" sessionId="session1" sha={newSha}>
    <BlameCell line={17} side="old" />
  </BlameProvider>)
  expect(screen.getByLabelText('このリビジョンの変更前の履歴はありません')).toBeInTheDocument()
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'blame')).toBe(false)
})
