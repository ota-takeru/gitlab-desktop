import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

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
  })

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
  })

  it('keeps invalid diff positions un-commentable and reports the unsafe state', () => {
    const diff = makeDiff('@@ -1,2 +1,2 @@\n-old\n+new\n')

    renderViewer(diff)

    expect(screen.getByRole('status')).toHaveTextContent('コメント位置を無効化')
    expect(screen.queryByRole('button', { name: /行にコメント/u })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
  })
})
