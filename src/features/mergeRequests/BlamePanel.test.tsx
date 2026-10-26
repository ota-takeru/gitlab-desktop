import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import { FullFileView } from './DiffViewer'
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

it('annotates rendered Markdown blocks with Blame and keeps the original text once', () => {
  const body = '# Introduction\n\nA **rich** paragraph.\n\n- First item\n- Second item'
  render(<ThemeProvider theme={createAppTheme('light')}>
    <BlameProvider initialNewLine={3} lines={[]} newPath="docs/guide.md" oldPath="docs/guide.md" projectId="7" sessionId="session1" sha={newSha}>
      <FullFileView blameEnabled content={body} language="markdown" loading={false} path="docs/guide.md" targetLine={3} />
    </BlameProvider>
  </ThemeProvider>)

  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', path: 'docs/guide.md', sha: newSha, startLine: 1, endLine: 80 }))
  const preview = screen.getByLabelText('Markdownプレビュー')
  const markers = preview.querySelectorAll('[data-review-blame-line]')
  expect(markers.length).toBeGreaterThanOrEqual(3)
  expect(within(preview).getAllByText('Introduction')).toHaveLength(1)
  expect(within(preview).getByText('A')).toBeInTheDocument()
  expect(within(preview).getByText('First item')).toBeInTheDocument()
  expect(within(preview).getByRole('button', { name: /1行のBlame:/u })).toBeInTheDocument()
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'commitMergeRequests')).toBe(false)

  fireEvent.click(within(preview).getByRole('button', { name: /1行のBlame:/u }))
  expect(screen.getByRole('dialog', { name: 'Blameのコミット詳細' })).toBeInTheDocument()
  expect(queryMock).toHaveBeenCalledWith('session1', { kind: 'commitMergeRequests', projectId: '7', sha: newSha })

  fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
  const line = screen.getAllByTestId('file-line')[0]
  expect(within(line).getByRole('button', { name: /1行のBlame:/u })).toBeInTheDocument()
  expect(screen.getAllByTestId('file-line')).toHaveLength(7)
})

it('begins whole-file Blame at its focused 80-line window and loads a different range on demand', () => {
  const content = Array.from({ length: 1250 }, (_, index) => `line ${index + 1}`).join('\n')
  render(<ThemeProvider theme={createAppTheme('light')}>
    <BlameProvider initialNewLine={1201} lines={[]} newPath="src/long.ts" oldPath="src/long.ts" projectId="7" sessionId="session1" sha={newSha}>
      <FullFileView blameEnabled content={content} language="typescript" loading={false} path="src/long.ts" targetLine={1201} />
    </BlameProvider>
  </ThemeProvider>)
  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', path: 'src/long.ts', sha: newSha, startLine: 1201, endLine: 1280 }))
  const first = screen.getAllByTestId('file-line')[0]
  expect(first).toHaveAttribute('data-file-line', '1001')
  fireEvent.click(within(first).getByRole('button', { name: /1001行のBlameを取得/u }))
  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', path: 'src/long.ts', sha: newSha, startLine: 961, endLine: 1040 }))
})

it('leaves Markdown rendering and source mode free of Blame in standalone code browsing', () => {
  const body = '# Heading\n\nBody'
  render(<ThemeProvider theme={createAppTheme('light')}>
    <FullFileView content={body} language="markdown" loading={false} path="README.md" />
  </ThemeProvider>)
  expect(screen.queryByLabelText(/行のBlame/u)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
  expect(screen.queryByRole('button', { name: /行のBlame/u })).not.toBeInTheDocument()
})
