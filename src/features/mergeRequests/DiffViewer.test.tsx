import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Diff, Position } from '../../types/gitlab'
import { scopedKey } from '../shared/preferences'
import { DIFF_PAGE_SIZE, FILE_PAGE_SIZE, DiffViewer } from './DiffViewer'
import { setFileReviewed, type ReviewedFileContext } from './useReviewedFiles'

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

function renderMany(diffList: Diff[], options: { context?: ReviewedFileContext; initialFile?: string } = {}) {
  function Harness() {
    const [selectedFile, setSelectedFile] = useState(options.initialFile ?? diffList[0]?.newPath ?? null)
    const [view, setView] = useState<'diff' | 'file'>('diff')
    return <ThemeProvider theme={createAppTheme('dark', 'workbench')}><DiffViewer diffs={diffList} onComment={vi.fn()} onSelectFile={setSelectedFile} onViewChange={setView} reviewContext={options.context} selectedFile={selectedFile} selectedPosition={undefined} view={view} /></ThemeProvider>
  }
  return render(<Harness />)
}

describe('DiffViewer', () => {
  beforeEach(() => localStorage.clear())

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

  it('starts each newly selected file in a fresh scroll area while keeping the search text', () => {
    const view = renderMany([makeDiff('@@ -1 +1 @@\n-a\n+b\n', 'src/a.ts'), makeDiff('@@ -1 +1 @@\n-c\n+d\n', 'src/b.ts')])
    fireEvent.change(screen.getByLabelText('差分内を検索'), { target: { value: 'zzz' } })
    const firstRows = view.container.querySelector('.diff-rows')

    fireEvent.click(screen.getByRole('button', { name: '次のファイル' }))

    expect(view.container.querySelector('.diff-rows')).not.toBe(firstRows)
    expect(screen.getByLabelText('差分内を検索')).toHaveValue('zzz')
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

  it('searches every loaded diff line beyond the rendered page and navigates results in order', () => {
    const lines = Array.from({ length: 610 }, (_, index) => ` line ${index + 1}${index === 600 || index === 608 ? ' needle' : ''}`).join('\n')
    const diff = makeDiff(`@@ -1,610 +1,610 @@\n${lines}\n`)
    renderMany([diff])

    fireEvent.change(screen.getByRole('textbox', { name: '差分内を検索' }), { target: { value: 'needle' } })
    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))

    expect(screen.getByText(/表示 601.*610.*610行/u)).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').find((line) => line.dataset.searchActive === 'true')).toHaveTextContent('line 601 needle')

    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').find((line) => line.dataset.searchActive === 'true')).toHaveTextContent('line 609 needle')
    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').find((line) => line.dataset.searchActive === 'true')).toHaveTextContent('line 601 needle')
  }, 15000)

  it('searches across fetched files and marks the active split row', () => {
    const first = makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/a.ts')
    const second = makeDiff('@@ -1 +1 @@\n-old needle\n+new needle\n', 'src/b.ts')
    renderMany([first, second])

    fireEvent.click(screen.getByRole('button', { name: '左右に並べて比較' }))
    fireEvent.change(screen.getByRole('textbox', { name: '差分内を検索' }), { target: { value: 'needle' } })
    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))

    expect(screen.getByText('src/b.ts')).toBeInTheDocument()
    const activeRow = screen.getAllByTestId('diff-split-row').find((row) => row.dataset.searchActive === 'true')
    expect(activeRow).toHaveTextContent('old needle')
    expect(activeRow).toHaveTextContent('new needle')
  })

  it('filters filenames, navigates matching paths, and reports an empty result truthfully', () => {
    const first = makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/feature/a.ts')
    const second = makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/feature/b.ts')
    const third = makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/other.ts')
    renderMany([first, second, third])

    const navigation = screen.getByRole('navigation', { hidden: true })
    fireEvent.change(screen.getByRole('textbox', { name: 'ファイル名を検索' }), { target: { value: 'src/feature/' } })
    expect(within(navigation).getByRole('button', { name: 'src/feature/a.ts', hidden: true })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'src/feature/b.ts', hidden: true })).toBeInTheDocument()
    expect(within(navigation).queryByRole('button', { name: 'src/other.ts', hidden: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '次の一致ファイル' }))
    expect(screen.getByText('src/feature/b.ts')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'ファイル名を検索' }), { target: { value: 'does-not-exist' } })
    expect(within(navigation).getByText('一致するファイルはありません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次の一致ファイル' })).toBeDisabled()
  })

  it('persists per-file review marks by account and invalidates them when the diff or head changes', () => {
    const diff = makeDiff('@@ -1 +1 @@\n-old\n+new\n')
    const context: ReviewedFileContext = { instanceUrl: 'https://gitlab.example', userId: '7', projectId: '15', mergeRequestIid: '42', revision: 'head-a' }
    const otherAccount = { ...context, userId: '8' }

    const first = renderMany([diff], { context })
    fireEvent.click(screen.getByRole('button', { name: '確認済みにする' }))
    expect(screen.getByRole('button', { name: '確認済み' })).toHaveAttribute('aria-pressed', 'true')
    first.unmount()

    const second = renderMany([diff], { context })
    expect(screen.getByRole('button', { name: '確認済み' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('確認済み')).toBeInTheDocument()
    second.unmount()

    const changedDiff = makeDiff('@@ -1 +1 @@\n-old\n+changed\n')
    const changed = renderMany([changedDiff], { context: { ...context, revision: 'head-a' } })
    expect(screen.getByRole('button', { name: '確認済みにする' })).toBeInTheDocument()
    changed.unmount()

    const changedHead = renderMany([diff], { context: { ...context, revision: 'head-b' } })
    expect(screen.getByRole('button', { name: '確認済みにする' })).toBeInTheDocument()
    expect(screen.queryByLabelText('確認済み')).not.toBeInTheDocument()
    changedHead.unmount()

    renderMany([diff], { context: otherAccount })
    expect(screen.getByRole('button', { name: '確認済みにする' })).toBeInTheDocument()
  })

  it('does not offer review marks for incomplete or invalid diffs', () => {
    const context: ReviewedFileContext = { instanceUrl: 'https://gitlab.example', userId: '7', projectId: '15', mergeRequestIid: '42', revision: 'head-a' }
    const incomplete = { ...makeDiff('@@ -1 +1 @@\n-old\n+new\n'), tooLarge: true }
    const collapsed = { ...makeDiff('@@ -1 +1 @@\n-old\n+new\n'), collapsed: true }
    const malformed = makeDiff('@@ -1,2 +1,2 @@\n-old\n+new\n')

    for (const diff of [incomplete, collapsed, malformed]) {
      const rendered = renderMany([diff], { context })
      expect(screen.queryByRole('button', { name: '確認済みにする' })).not.toBeInTheDocument()
      rendered.unmount()
    }
  })

  it('bounds persisted review marks to 500 files per merge request', () => {
    const context: ReviewedFileContext = { instanceUrl: 'https://gitlab.example', userId: '7', projectId: '15', mergeRequestIid: '42', revision: 'head-a' }
    const diffText = '@@ -1 +1 @@\n-old\n+new\n'
    for (let index = 0; index < 505; index += 1) setFileReviewed(context, makeDiff(diffText, `src/${index}.ts`), true)

    const saved = JSON.parse(localStorage.getItem(scopedKey(context, 'reviewed-files')) ?? '{}') as Record<string, Record<string, string>>
    const files = saved['15:42']
    expect(Object.keys(files)).toHaveLength(500)
    expect(files['src/0.ts']).toBeUndefined()
    expect(files['src/504.ts']).toBeDefined()
  })
})
