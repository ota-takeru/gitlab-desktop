import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { createAppTheme } from '../../theme'
import { FullFileView } from './DiffViewer'
import { BlameCell, BlameProvider } from './BlamePanel'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../../lib/gitlab', () => ({ openGitLabUrl: vi.fn() }))

const newSha = 'a'.repeat(40)
const oldSha = 'b'.repeat(40)
const block = (sha: string, lines = ['one', 'two', 'three']) => ({ authorName: 'Alice', commitId: sha, committedAt: '2026-09-01T10:00:00Z', lines, title: 'Introduce a' })

type Query = { kind: string; sha?: string; path?: string; startLine?: number; endLine?: number } | null

beforeEach(() => {
  // One result per query, as React Query keeps it, so a re-render sees the same data.
  const stored = new Map<string, unknown>()
  queryMock.mockReset().mockImplementation((_session: string, query: Query) => {
    const key = JSON.stringify(query)
    if (!stored.has(key)) stored.set(key, answer(query))
    return stored.get(key)
  })
})

function answer(query: Query) {
  // A long file is blamed in full, one window at a time; short ones have three lines.
  if (query?.kind === 'blame' && query.path === 'src/long.ts') return { data: [block(newSha, Array.from({ length: query.endLine! - query.startLine! + 1 }, (_, index) => `line ${query.startLine! + index}`))], error: null, loading: false }
  if (query?.kind === 'blame') return { data: [block(query.sha === oldSha ? oldSha : newSha)], error: null, loading: false }
  if (query?.kind === 'commitMergeRequests') return {
    data: [{ iid: '12', projectId: '7', state: 'merged', title: 'Introduce a', webUrl: 'https://gitlab.example/x/-/merge_requests/12' }],
    error: null, loading: false,
  }
  return { data: null, error: null, loading: false }
}

it('shows attribution beside code only once, and loads the related MRs only after selecting a commit', () => {
  render(<BlameProvider beforeSha={oldSha} newPath="src/test.ts" oldPath="src/test.ts" projectId="7" sessionId="session1" sha={newSha}>
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
  render(<BlameProvider newPath="new.ts" oldPath="old.ts" projectId="7" sessionId="session1" sha={newSha}>
    <BlameCell line={17} side="old" />
  </BlameProvider>)
  expect(screen.getByLabelText('このリビジョンの変更前の履歴はありません')).toBeInTheDocument()
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'blame')).toBe(false)
})

it('annotates rendered Markdown blocks with Blame and keeps the original text once', () => {
  const body = '# Introduction\n\nA **rich** paragraph.\n\n- First item\n- Second item'
  render(<ThemeProvider theme={createAppTheme('light')}>
    <BlameProvider newPath="docs/guide.md" oldPath="docs/guide.md" projectId="7" sessionId="session1" sha={newSha}>
      <FullFileView blameEnabled content={body} language="markdown" loading={false} path="docs/guide.md" targetLine={3} />
    </BlameProvider>
  </ThemeProvider>)

  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', path: 'docs/guide.md', sha: newSha, startLine: 1, endLine: 80 }))
  const preview = screen.getByLabelText('Markdownプレビュー')
  const markers = preview.querySelectorAll('[data-review-blame-line]')
  expect(markers.length).toBeGreaterThanOrEqual(3)
  expect(within(preview).getAllByText('Introduction')).toHaveLength(1)
  expect(within(preview).getByText('rich')).toBeInTheDocument()
  expect(within(preview).getByText('First item')).toBeInTheDocument()
  expect(within(preview).getByRole('button', { name: /1行のBlame:/u })).toBeInTheDocument()
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'commitMergeRequests')).toBe(false)

  // Switching to source mode preserves line attribution and does not
  // fetch associated MRs before opening a commit.
  fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
  const line = screen.getAllByTestId('file-line')[0]
  expect(within(line).getByRole('button', { name: /1行のBlame:/u })).toBeInTheDocument()
  expect(screen.getAllByTestId('file-line')).toHaveLength(6)

  fireEvent.click(within(line).getByRole('button', { name: /1行のBlame:/u }))
  expect(screen.getByRole('dialog', { name: 'Blameのコミット詳細' })).toBeInTheDocument()
  expect(queryMock).toHaveBeenCalledWith('session1', { kind: 'commitMergeRequests', projectId: '7', sha: newSha })
})

it('blames every line shown in a long file, reading its windows a few at a time', () => {
  const content = Array.from({ length: 1250 }, (_, index) => `line ${index + 1}`).join('\n')
  render(<ThemeProvider theme={createAppTheme('light')}>
    <BlameProvider newPath="src/long.ts" oldPath="src/long.ts" projectId="7" sessionId="session1" sha={newSha}>
      <FullFileView blameEnabled content={content} language="typescript" loading={false} path="src/long.ts" targetLine={1201} />
    </BlameProvider>
  </ThemeProvider>)
  const first = screen.getAllByTestId('file-line')[0]
  expect(first).toHaveAttribute('data-file-line', '1001')
  // No line waits for a click: the windows of the page are all read, and every line names its commit.
  for (const startLine of [961, 1041, 1121, 1201]) {
    expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', path: 'src/long.ts', sha: newSha, startLine, endLine: startLine + 79 }))
  }
  expect(within(first).getByRole('button', { name: /1001行のBlame: aaaaaaaa/u })).toBeInTheDocument()
  const last = screen.getAllByTestId('file-line').at(-1)!
  expect(within(last).getByRole('button', { name: /1250行のBlame: aaaaaaaa/u })).toBeInTheDocument()
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

it('keeps full-file source mode mounted while Blame is toggled on and off', () => {
  function Harness() {
    const [enabled, setEnabled] = useState(false)
    return <ThemeProvider theme={createAppTheme('light')}>
      <BlameProvider enabled={enabled} newPath="docs/file.md" oldPath="docs/file.md" projectId="7" sessionId="session1" sha={newSha}>
        <button onClick={() => setEnabled((current) => !current)} type="button">Blame切替</button>
        <FullFileView blameEnabled={enabled} content={'# Heading\n\nBody text'} language="markdown" loading={false} path="docs/file.md" />
      </BlameProvider>
    </ThemeProvider>
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
  expect(screen.getAllByTestId('file-line')).toHaveLength(3)
  expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'blame')).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: 'Blame切替' }))
  expect(screen.getByRole('button', { name: 'Markdownをレンダリング' })).toBeInTheDocument()
  expect(screen.getAllByTestId('file-line')).toHaveLength(3)
  expect(screen.getByRole('button', { name: /1行のBlame:/u })).toBeInTheDocument()
  expect(queryMock).toHaveBeenCalledWith('session1', expect.objectContaining({ kind: 'blame', sha: newSha, startLine: 1, endLine: 80 }))

  fireEvent.click(screen.getByRole('button', { name: 'Blame切替' }))
  expect(screen.getAllByTestId('file-line')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /行のBlame/u })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Markdownをレンダリング' })).toBeInTheDocument()
})

it('opens the history of the clicked line, of its commit\'s lines, or of the chosen lines, at the revision of their side', () => {
  const onHistory = vi.fn()
  const view = (selectedLines?: { side: 'old' | 'new'; range: { start: number; end: number } }) => <BlameProvider beforeSha={oldSha} newPath="new.ts" oldPath="old.ts" onHistory={onHistory} projectId="7" projectUrl="https://gitlab.example/x" selectedLines={selectedLines} sessionId="session1" sha={newSha}>
    <BlameCell line={2} side="old" />
  </BlameProvider>
  const { rerender } = render(view())
  fireEvent.click(screen.getByRole('button', { name: /2行のBlame: bbbbbbbb/ }))
  expect(screen.getByRole('button', { name: 'GitLabでコミットを開く' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /選択中/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'このコミットの1〜3行' }))
  expect(onHistory).toHaveBeenLastCalledWith({ path: 'old.ts', range: { start: 1, end: 3 }, sha: oldSha })

  fireEvent.click(screen.getByRole('button', { name: /2行のBlame: bbbbbbbb/ }))
  fireEvent.click(screen.getByRole('button', { name: '2行だけ' }))
  expect(onHistory).toHaveBeenLastCalledWith({ path: 'old.ts', range: { start: 2, end: 2 }, sha: oldSha })

  rerender(view({ range: { end: 9, start: 2 }, side: 'old' }))
  fireEvent.click(screen.getByRole('button', { name: /2行のBlame: bbbbbbbb/ }))
  fireEvent.click(screen.getByRole('button', { name: '選択中の2〜9行' }))
  expect(onHistory).toHaveBeenLastCalledWith({ path: 'old.ts', range: { start: 2, end: 9 }, sha: oldSha })
})

it('names the commit on every line, and marks only where a run starts', () => {
  render(<BlameProvider newPath="new.ts" oldPath="new.ts" projectId="7" sessionId="session1" sha={newSha}>
    <BlameCell line={2} side="new" />
    <BlameCell line={1} side="new" />
  </BlameProvider>)
  // A row inside a run still shows the commit, so a hunk starting mid-run is readable.
  const inside = screen.getByRole('button', { name: /2行のBlame: aaaaaaaa/ })
  expect(inside).toHaveTextContent('aaaaaaaaAlice')
  expect(inside).toHaveAttribute('data-continued', 'true')
  expect(screen.getByRole('button', { name: /1行のBlame: aaaaaaaa/ })).not.toHaveAttribute('data-continued')
})
