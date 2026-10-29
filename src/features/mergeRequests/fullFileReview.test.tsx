import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    // Shown above the lines and again below the last one.
    expect(screen.getAllByText(/表示 1001.*1400.*1400行/u)).toHaveLength(2)
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

  describe('keeping the line on screen', () => {
    // jsdom has no layout: whole-file lines are 20px apart, rendered blocks 40px and diff rows 30px, inside one scrolling box.
    let scroller: HTMLDivElement
    beforeEach(() => {
      scroller = document.createElement('div')
      scroller.style.overflowY = 'auto'
      Object.defineProperty(scroller, 'scrollHeight', { value: 100_000 })
      Object.defineProperty(scroller, 'clientHeight', { value: 700 })
      Object.defineProperty(scroller, 'scrollTop', { value: 400, writable: true })
      document.body.appendChild(scroller)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const { fileAnchor, fileLine, sourceStart } = this.dataset
        const top = (fileLine ? Number(fileLine) * 20 : sourceStart ? Number(sourceStart) * 40 : fileAnchor ? Number(fileAnchor) * 30 : 0) - scroller.scrollTop
        return { bottom: top + 20, height: 20, left: 0, right: 0, top, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
      })
      Element.prototype.scrollIntoView = vi.fn()
    })
    afterEach(() => {
      vi.restoreAllMocks()
      scroller.remove()
      delete (Element.prototype as Partial<Element>).scrollIntoView
    })

    it('keeps the Markdown block or source line at the top in place when switching between them', () => {
      const content = Array.from({ length: 30 }, (_, index) => `para ${index * 2 + 1}`).join('\n\n')
      const lines = parsed('docs/guide.md', '@@ -1 +1 @@\n-old\n+para 1\n')
      render(<ThemeProvider theme={theme}><FullFileView content={content} diffLines={lines} language="markdown" loading={false} path="docs/guide.md" targetLine={1} /></ThemeProvider>, { container: scroller })
      vi.mocked(Element.prototype.scrollIntoView).mockClear()

      // Block 11 is the first one below the top (at 40px); its source line goes to the same place.
      fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
      expect(scroller.scrollTop).toBe(180)
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
      // Source line 9 is now at the top; the rendered paragraph of line 9 takes its place.
      fireEvent.click(screen.getByRole('button', { name: 'Markdownをレンダリング' }))
      expect(scroller.scrollTop).toBe(360)
    })

    it('keeps the place in rendered Markdown that has no diff marks or Blame', () => {
      const content = Array.from({ length: 30 }, (_, index) => `para ${index * 2 + 1}`).join('\n\n')
      render(<ThemeProvider theme={theme}><FullFileView content={content} language="markdown" loading={false} path="README.md" /></ThemeProvider>, { container: scroller })
      expect(screen.getByText('para 11').closest('[data-source-start]')).toHaveAttribute('data-source-start', '11')
      expect(document.querySelector('[data-review-change]')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
      expect(scroller.scrollTop).toBe(180)
    })

    it('opens the whole file with the diff line shown at the top in the same place', () => {
      const content = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
      const diff: Diff = { collapsed: false, deletedFile: false, diff: '@@ -18,5 +18,6 @@\n line 18\n line 19\n+line 20\n line 21\n line 22\n line 23\n', newFile: false, newPath: 'src/a.ts', oldPath: 'src/a.ts', renamedFile: false, tooLarge: false }
      function Harness() {
        const [view, setView] = useState<'diff' | 'file'>('diff')
        return <ThemeProvider theme={theme}><DiffViewer diffs={[diff]} fileContent={content} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={setView} selectedFile="src/a.ts" selectedPosition={undefined} view={view} /></ThemeProvider>
      }
      render(<Harness />, { container: scroller })
      vi.mocked(Element.prototype.scrollIntoView).mockClear()
      // Diff row 18 is the first on screen (at 140px); whole-file line 18 is put there rather than centred.
      fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))
      expect(scroller.scrollTop).toBe(220)
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    })

    it('returns from the whole file to the diff at the line shown at the top, not the line it opened on', () => {
      const content = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
      const diff: Diff = { collapsed: false, deletedFile: false, diff: '@@ -18,5 +18,6 @@\n line 18\n line 19\n+line 20\n line 21\n line 22\n line 23\n', newFile: false, newPath: 'src/a.ts', oldPath: 'src/a.ts', renamedFile: false, tooLarge: false }
      function Harness() {
        const [view, setView] = useState<'diff' | 'file'>('file')
        return <ThemeProvider theme={theme}><DiffViewer diffs={[diff]} fileContent={content} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={setView} selectedFile="src/a.ts" selectedPosition={undefined} view={view} /></ThemeProvider>
      }
      render(<Harness />, { container: scroller })
      // Line 20 is at the top of the whole file; its diff row (at 600px) is brought to the top.
      fireEvent.click(screen.getByRole('button', { name: /^差分$/u }))
      expect(scroller.scrollTop).toBe(600)
    })
  })
})
