import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Diff, Position } from '../../types/gitlab'
import { DIFF_PAGE_SIZE, FILE_PAGE_SIZE, DiffViewer } from './DiffViewer'

function renderViewer(diff: Diff, options: { fileContent?: string | null; selectedPosition?: Position; view?: 'diff' | 'file' } = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <DiffViewer
        diffs={[diff]}
        fileContent={options.fileContent}
        onComment={vi.fn()}
        onSelectFile={vi.fn()}
        selectedFile={diff.newPath || diff.oldPath}
        selectedPosition={options.selectedPosition}
        view={options.view ?? 'diff'}
        onViewChange={vi.fn()}
      />
    </ThemeProvider>,
  )
}

function makeDiff(diff: string, oldPath = 'src/example.ts', newPath = oldPath): Diff {
  return { oldPath, newPath, diff, newFile: oldPath === '/dev/null', deletedFile: newPath === '/dev/null', renamedFile: oldPath !== newPath, tooLarge: false, collapsed: false }
}

describe('DiffViewer', () => {
  beforeEach(() => localStorage.removeItem('gitlab-desktop:diff-layout'))

  it('identifies the first displayed file before an explicit selection', () => {
    const diff = makeDiff('@@ -1 +1 @@\n-old\n+new\n')
    render(<DiffViewer diffs={[diff]} onComment={vi.fn()} onSelectFile={vi.fn()} selectedFile={null} selectedPosition={undefined} view="diff" onViewChange={vi.fn()} />)
    expect(screen.queryByText('ファイルを選択')).not.toBeInTheDocument()
    expect(screen.getByText('src/example.ts')).toBeInTheDocument()
    expect(screen.getByText('example.ts')).toBeInTheDocument()
    // The file list is shown only in wide containers; it still marks the displayed file.
    expect(screen.getByRole('button', { hidden: true, name: 'src/example.ts' })).toHaveClass('Mui-selected')
  })

  it('compares old and new side by side, pairs changed lines and comments on the chosen side', () => {
    localStorage.removeItem('gitlab-desktop:diff-layout')
    const onComment = vi.fn()
    const diff = makeDiff('@@ -1,4 +1,3 @@\n a\n-b\n-c\n+d\n e\n')
    const view = render(<ThemeProvider theme={createAppTheme('dark', 'workbench')}><DiffViewer diffs={[diff]} onComment={onComment} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={diff.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)

    expect(screen.getAllByTestId('diff-line')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '左右に並べて比較' }))

    const rows = screen.getAllByTestId('diff-split-row')
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => Array.from(row.querySelectorAll('.split-code'), (cell) => cell.textContent))).toEqual([['a', 'a'], ['b', 'd'], ['c', ''], ['e', 'e']])
    expect(screen.queryByTestId('diff-line')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'src/example.tsの変更前2行にコメント' }))
    expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ newLine: undefined, oldLine: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'src/example.tsの2行にコメント' }))
    expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ newLine: 2, oldLine: undefined }))
    // A context row offers one action carrying both line numbers.
    fireEvent.click(screen.getByRole('button', { name: 'src/example.tsの3行にコメント' }))
    expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ newLine: 3, oldLine: 4 }))

    // The choice is remembered for the next file or session.
    view.unmount()
    render(<ThemeProvider theme={createAppTheme('dark', 'workbench')}><DiffViewer diffs={[diff]} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={diff.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)
    expect(screen.getAllByTestId('diff-split-row')).toHaveLength(4)
    localStorage.removeItem('gitlab-desktop:diff-layout')
  })

  it('moves between changed files from the file header', () => {
    const onSelectFile = vi.fn()
    const first = makeDiff('@@ -1 +1 @@\n-a\n+b\n', 'src/a.ts')
    const second = makeDiff('@@ -1 +1 @@\n-c\n+d\n', 'src/b.ts')
    render(<ThemeProvider theme={createAppTheme('dark', 'workbench')}><DiffViewer diffs={[first, second]} onComment={vi.fn()} onSelectFile={onSelectFile} onViewChange={vi.fn()} selectedFile="src/a.ts" selectedPosition={undefined} view="diff" /></ThemeProvider>)
    expect(screen.getByRole('button', { name: '前のファイル' })).toBeDisabled()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '次のファイル' }))
    expect(onSelectFile).toHaveBeenCalledWith('src/b.ts')
  })

  it('marks unchanged lines omitted between hunks and hides paging for short diffs', () => {
    const diff = makeDiff('@@ -3,2 +3,2 @@\n a\n-b\n+c\n@@ -20,1 +20,2 @@\n d\n+e\n')
    renderViewer(diff)
    expect(screen.getByText('⋯ 変更のない2行')).toBeInTheDocument()
    expect(screen.getByText('⋯ 変更のない15行')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line')).toHaveLength(5)
    expect(screen.getByLabelText('追加2行、削除1行')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `次の${DIFF_PAGE_SIZE}行` })).not.toBeInTheDocument()
  })

  it('keeps the DOM bounded while allowing navigation to the final diff page', () => {
    const diff = makeDiff(`@@ -1,10000 +1,10000 @@\n${Array.from({ length: 10_000 }, (_, index) => ` line ${index + 1}`).join('\n')}\n`)

    renderViewer(diff)

    expect(screen.getAllByTestId('diff-line')).toHaveLength(DIFF_PAGE_SIZE)
    expect(screen.getByText(/表示 1.*600.*10000行（残り9400行）/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `前の${DIFF_PAGE_SIZE}行` })).toBeDisabled()

    act(() => {
      for (let page = 0; page < 16; page += 1) fireEvent.click(screen.getByRole('button', { name: `次の${DIFF_PAGE_SIZE}行` }))
    })

    expect(screen.getAllByTestId('diff-line')).toHaveLength(10_000 % DIFF_PAGE_SIZE)
    expect(screen.getByText(/表示 9601.*10000.*10000行/u)).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').at(-1)).toHaveTextContent('line 10000')
    expect(screen.getByRole('button', { name: `次の${DIFF_PAGE_SIZE}行` })).toBeDisabled()
  }, 15000)

  it('pages full-file content separately and reaches the end without an invented trailing line', () => {
    const content = Array.from({ length: 2_001 }, (_, index) => `内容 ${index + 1}`).join('\r\n')
    const diff = makeDiff('@@ -1 +1 @@\n-old\n+new\n')

    renderViewer(diff, { fileContent: content, view: 'file' })

    expect(screen.getAllByTestId('file-line')).toHaveLength(FILE_PAGE_SIZE)
    expect(screen.getByText(/表示 1.*1000.*2001行（残り1001行）/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `次の${FILE_PAGE_SIZE}行` }))
    expect(screen.getAllByTestId('file-line')).toHaveLength(FILE_PAGE_SIZE)
    expect(screen.getByText(/表示 1001.*2000.*2001行（残り1行）/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `次の${FILE_PAGE_SIZE}行` }))
    expect(screen.getAllByTestId('file-line')).toHaveLength(1)
    expect(screen.getByText(/表示 2001.*2001.*2001行/u)).toBeInTheDocument()
    expect(screen.getByText('内容 2001')).toBeInTheDocument()
  })

  it('opens the page containing a selected comment position and preserves its line number', async () => {
    const diff = makeDiff(`@@ -1,1800 +1,1800 @@\n${Array.from({ length: 1_800 }, (_, index) => ` line ${index + 1}`).join('\n')}\n`)
    const onComment = vi.fn()
    const position: Position = { baseSha: 'base', headSha: 'head', newLine: 1201, newPath: diff.newPath, oldPath: diff.oldPath, positionType: 'text', startSha: 'start' }

    render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <DiffViewer diffs={[diff]} onComment={onComment} onSelectFile={vi.fn()} selectedFile={diff.newPath} selectedPosition={position} view="diff" onViewChange={vi.fn()} />
      </ThemeProvider>,
    )

    await waitFor(() => expect(screen.getByText(/表示 1201.*1800.*1800行/u)).toBeInTheDocument())
    const comment = screen.getByRole('button', { name: 'src/example.tsの1201行にコメント' })
    fireEvent.click(comment)
    expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ newLine: 1201, newPath: 'src/example.ts' }))
  }, 15000)

  it('focuses the selected diff line after switching to its page', async () => {
    const diff = makeDiff(`@@ -1,1800 +1,1800 @@\n${Array.from({ length: 1_800 }, (_, index) => ` line ${index + 1}`).join('\n')}\n`)
    const position: Position = { baseSha: 'base', headSha: 'head', newLine: 1201, newPath: diff.newPath, oldPath: diff.oldPath, positionType: 'text', startSha: 'start' }

    renderViewer(diff, { selectedPosition: position })

    const comment = await screen.findByRole('button', { name: 'src/example.tsの1201行にコメント' })
    const selectedLine = comment.closest('[data-testid="diff-line"]')
    await waitFor(() => expect(selectedLine).toHaveFocus())
    expect(selectedLine).toHaveAttribute('data-line-id')
    expect(screen.getByText(/表示 1201.*1800.*1800行/u)).toBeInTheDocument()
  }, 15000)

  it('keeps invalid diff positions un-commentable and reports the unsafe state', () => {
    const diff = makeDiff('@@ -1,2 +1,2 @@\n-old\n+new\n')

    renderViewer(diff)

    expect(screen.getByRole('status')).toHaveTextContent('コメント位置を無効化')
    expect(screen.queryByRole('button', { name: /行にコメント/u })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
  })
})
