import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Diff } from '../../types/gitlab'
import { DiffViewer, FullFileView } from './DiffViewer'
import { parseDiff } from './diffParser'

const theme = createAppTheme('light')
function parsed(oldPath: string, diff: string) {
  const result = parseDiff(diff, oldPath, oldPath)
  expect(result.status).toBe('valid')
  return result.lines
}

describe('full-file diff context', () => {
  it('keeps rendered Markdown, highlights added text and shows old deletions at the edit', () => {
    const content = '# Guide\n\n## **New section**\n\nKeep this paragraph\n\n## Other section\n\nUnchanged'
    const lines = parsed('docs/guide.md', '@@ -3,1 +3,1 @@\n-## Old section\n+## **New section**\n')
    render(<ThemeProvider theme={theme}><FullFileView content={content} diffLines={lines} language="markdown" loading={false} path="docs/guide.md" targetLine={3} /></ThemeProvider>)
    const area = screen.getByLabelText('Markdownプレビュー')
    const added = within(area).getByRole('heading', { name: 'New section' })
    expect(added).toHaveAttribute('data-review-change', 'add')
    const old = within(area).getByText('## Old section')
    expect(old.closest('[data-review-deleted="true"]')).not.toBeNull()
    expect(within(area).getByText('Unchanged')).toBeInTheDocument()
    expect(within(area).queryByTestId('file-line')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
    const highlightedLine = screen.getAllByTestId('file-line').find((line) => line.getAttribute('data-file-line') === '3')
    expect(highlightedLine).toHaveAttribute('data-change', 'add')
    expect(highlightedLine).toHaveTextContent('## **New section**')
    expect(screen.getByTestId('file-deletion')).toHaveTextContent('## Old section')
  })

  it('opens a 1,201-line source file at the matching paged line and marks the change', () => {
    const code = Array.from({ length: 1400 }, (_, i) => i === 1200 ? 'NEW' : `line ${i + 1}`).join('\n')
    const lines = parsed('src/large.ts', '@@ -1201 +1201 @@\n-OLD\n+NEW\n')
    render(<ThemeProvider theme={theme}><FullFileView content={code} diffLines={lines} language="typescript" loading={false} path="src/large.ts" targetLine={1201} /></ThemeProvider>)
    const rows = screen.getAllByTestId('file-line')
    expect(rows[0]).toHaveAttribute('data-file-line', '1001')
    expect(rows[200]).toHaveAttribute('data-file-line', '1201')
    expect(rows[200]).toHaveAttribute('data-change', 'add')
    expect(screen.getByTestId('file-deletion')).toHaveTextContent('OLD')
    expect(screen.getByText(/表示 1001.*1400.*1400行/u)).toBeInTheDocument()
  })

  it('follows the hunk actually visible when two distant changes are shown', () => {
    const diff: Diff = {
      oldPath: 'src/large.ts', newPath: 'src/large.ts', newFile: false, deletedFile: false, renamedFile: false, collapsed: false, tooLarge: false,
      diff: '@@ -10 +10 @@\n-old10\n+new10\n@@ -1201 +1201 @@\n-OLD\n+NEW\n',
    }
    const content = Array.from({ length: 1400 }, (_, i) => i === 9 ? 'new10' : i === 1200 ? 'NEW' : `line ${i + 1}`).join('\n')
    function Harness() {
      const [view, setView] = useState<'diff' | 'file'>('diff')
      return <DiffViewer diffs={[diff]} fileContent={content} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={setView} selectedFile={diff.newPath} selectedPosition={undefined} view={view} />
    }
    const view = render(<ThemeProvider theme={theme}><Harness /></ThemeProvider>)
    const marks = Array.from(view.container.querySelectorAll<HTMLElement>('[data-file-anchor]'))
    expect(marks.map((node) => node.dataset.fileAnchor)).toEqual(['10', '1201'])
    const rect = (top: number, bottom: number): DOMRect => ({
      top, bottom, left: 0, right: 100, x: 0, y: top, width: 100, height: bottom - top, toJSON: () => ({}),
    })
    vi.spyOn(marks[0], 'getBoundingClientRect').mockReturnValue(rect(-700, -680))
    vi.spyOn(marks[1], 'getBoundingClientRect').mockReturnValue(rect(120, 145))
    fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))
    const rows = screen.getAllByTestId('file-line')
    expect(rows[0]).toHaveAttribute('data-file-line', '1001')
    expect(rows[200]).toHaveAttribute('data-file-line', '1201')
    expect(rows[200]).toHaveAttribute('data-change', 'add')
    expect(screen.getByTestId('file-deletion')).toHaveTextContent('OLD')
    vi.restoreAllMocks()
  })

  it('does not imply stale or inconsistent diff annotations are accurate', () => {
    const lines = parsed('src/code.ts', '@@ -1 +1 @@\n-old\n+expected\n')
    render(<ThemeProvider theme={theme}><FullFileView content={'different'} diffLines={lines} language="typescript" loading={false} targetLine={1} /></ThemeProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('差分の行が一致しない')
    expect(screen.getByTestId('file-line')).not.toHaveAttribute('data-change')
    expect(screen.queryByTestId('file-deletion')).not.toBeInTheDocument()
  })

  it('switches from a distant changed hunk to its full-file page and returns to the diff', () => {
    const diff: Diff = { oldPath: 'src/large.ts', newPath: 'src/large.ts', diff: '@@ -1201 +1201 @@\n-OLD\n+NEW\n', newFile: false, deletedFile: false, renamedFile: false, collapsed: false, tooLarge: false }
    const content = Array.from({ length: 1400 }, (_, i) => i === 1200 ? 'NEW' : `line ${i+1}`).join('\n')
    function Harness() {
      const [view, setView] = useState<'diff' | 'file'>('diff')
      return <DiffViewer diffs={[diff]} fileContent={content} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={setView} selectedFile={diff.newPath} selectedPosition={undefined} view={view} />
    }
    render(<ThemeProvider theme={theme}><Harness /></ThemeProvider>)
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))
    const rows = screen.getAllByTestId('file-line')
    expect(rows[0]).toHaveAttribute('data-file-line', '1001')
    expect(rows[200]).toHaveAttribute('data-change', 'add')
    fireEvent.click(screen.getByRole('button', { name: /^差分$/u }))
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
  })
})
