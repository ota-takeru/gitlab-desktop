import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Diff, Position } from '../../types/gitlab'
import { scopedKey } from '../shared/preferences'
import { FILE_PAGE_SIZE } from './diffShared'
import { DiffViewer } from './DiffViewer'
import { FullFileView } from './FullFileView'
import { setFileReviewed, type ReviewedFileContext } from './useReviewedFiles'

function renderViewer(diff: Diff, options: { fileContent?: string | null; selectedPosition?: Position; view?: 'diff' | 'file' } = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('dark')}>
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

/** A file row's name starts with its path; its line counts and state follow. */
function fileRow(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}(、|$)`, 'u')
}

/** The path in the file heading. */
const shownPath = () => document.querySelector('bdi')?.textContent

function makeDiff(diff: string, oldPath = 'src/example.ts', newPath = oldPath): Diff {
  return { oldPath, newPath, diff, newFile: oldPath === '/dev/null', deletedFile: newPath === '/dev/null', renamedFile: oldPath !== newPath, tooLarge: false, collapsed: false }
}

function renderMany(diffList: Diff[], options: { context?: ReviewedFileContext; initialFile?: string } = {}) {
  function Harness() {
    const [selectedFile, setSelectedFile] = useState(options.initialFile ?? diffList[0]?.newPath ?? null)
    const [view, setView] = useState<'diff' | 'file'>('diff')
    return <ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={diffList} onComment={vi.fn()} onSelectFile={setSelectedFile} onViewChange={setView} reviewContext={options.context} selectedFile={selectedFile} selectedPosition={undefined} view={view} /></ThemeProvider>
  }
  return render(<Harness />)
}

describe('DiffViewer', () => {
  beforeEach(() => localStorage.clear())

  it('identifies the first displayed file before an explicit selection', () => {
    const diff = makeDiff('@@ -1 +1 @@\n-old\n+new\n')
    render(<DiffViewer diffs={[diff]} onComment={vi.fn()} onSelectFile={vi.fn()} selectedFile={null} selectedPosition={undefined} view="diff" onViewChange={vi.fn()} />)
    expect(screen.queryByText('ファイルを選択')).not.toBeInTheDocument()
    expect(shownPath()).toBe('src/example.ts')
    // The file list is shown only in wide containers; it still marks the displayed file.
    expect(screen.getByRole('button', { hidden: true, name: fileRow('src/example.ts') })).toHaveClass('Mui-selected')
  })

  it('compares old and new side by side, pairs changed lines and comments on the chosen side', () => {
    localStorage.removeItem('gitlab-desktop:diff-layout')
    const onComment = vi.fn()
    const diff = makeDiff('@@ -1,4 +1,3 @@\n a\n-b\n-c\n+d\n e\n')
    const view = render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={[diff]} onComment={onComment} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={diff.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)

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
    render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={[diff]} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={diff.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)
    expect(screen.getAllByTestId('diff-split-row')).toHaveLength(4)
    localStorage.removeItem('gitlab-desktop:diff-layout')
  })

  it('moves between changed files from the file header', () => {
    const onSelectFile = vi.fn()
    const first = makeDiff('@@ -1 +1 @@\n-a\n+b\n', 'src/a.ts')
    const second = makeDiff('@@ -1 +1 @@\n-c\n+d\n', 'src/b.ts')
    render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={[first, second]} onComment={vi.fn()} onSelectFile={onSelectFile} onViewChange={vi.fn()} selectedFile="src/a.ts" selectedPosition={undefined} view="diff" /></ThemeProvider>)
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

  it('marks unchanged lines omitted between hunks', () => {
    const diff = makeDiff('@@ -3,2 +3,2 @@\n a\n-b\n+c\n@@ -20,1 +20,2 @@\n d\n+e\n')
    renderViewer(diff)
    expect(screen.getByText('⋯ 変更のない2行')).toBeInTheDocument()
    expect(screen.getByText('⋯ 変更のない15行')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line')).toHaveLength(5)
    // Once for the file on screen and once for the totals, as this is the only file.
    expect(screen.getAllByLabelText('追加2行、削除1行')).toHaveLength(2)
  })

  it('totals the changed lines of every file and says which files it could not count', () => {
    const omitted = { ...makeDiff('', 'src/huge.ts'), tooLarge: true }
    renderMany([makeDiff('@@ -1 +1,2 @@\n-a\n+b\n+c\n', 'src/one.ts'), makeDiff('@@ -1,2 +1 @@\n-a\n-b\n+c\n', 'src/two.ts'), omitted])
    expect(screen.getByText('3ファイル変更')).toBeInTheDocument()
    expect(screen.getByLabelText('追加3行、削除3行')).toBeInTheDocument()
    expect(screen.getByText('差分のない1ファイルは行数に含みません')).toBeInTheDocument()
    expect(screen.getByRole('button', { hidden: true, name: 'src/two.ts、追加1行、削除2行' })).toBeInTheDocument()
    // A count of nothing would not be true of a file whose diff is not here.
    expect(screen.getByRole('button', { hidden: true, name: 'src/huge.ts' })).toBeInTheDocument()
  })

  it('counts folded whitespace changes as unchanged in the totals too', () => {
    localStorage.setItem('gitlab-desktop:diff-ignore-whitespace', 'true')
    renderMany([makeDiff('@@ -1,2 +1,2 @@\n-a\n-b\n+ a\n+c\n', 'src/one.ts'), makeDiff('@@ -1 +1,2 @@\n a\n+b\n', 'src/two.ts')])
    expect(screen.getByLabelText('追加2行、削除1行')).toBeInTheDocument()
  })

  it('keeps a long path on one line and shows all of it on hover', async () => {
    const path = 'src/features/a/very/long/path/with/many/folders/LongFileName.test.tsx'
    const view = renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n', path))
    const shown = view.container.querySelector('bdi') as HTMLElement
    const [folders, name] = Array.from(shown.children)
    expect(name).toHaveTextContent('LongFileName.test.tsx')
    // The folders give way before the file's name.
    expect(getComputedStyle(folders).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(name).whiteSpace).toBe('nowrap')
    expect(Number(getComputedStyle(folders).flexShrink)).toBeGreaterThan(Number(getComputedStyle(name).flexShrink))
    fireEvent.mouseOver(shown)
    expect((await screen.findByRole('tooltip')).textContent).toBe(path)
    fireEvent.mouseLeave(shown.parentElement!)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    // The list's rows show the whole path on hover too, anywhere on the row, and no browser tooltip beside it.
    const row = screen.getByRole('button', { hidden: true, name: fileRow(path) })
    expect(row).not.toHaveAttribute('title')
    fireEvent.mouseOver(row)
    expect((await screen.findByRole('tooltip')).textContent).toBe(path)
    // A scroll carries the row away, so the tooltip goes with no fade rather than following it.
    fireEvent.scroll(row.parentElement!)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('covers the window when maximized, and Esc restores it without leaving the merge request', () => {
    const left = vi.fn()
    window.addEventListener('keydown', left)
    try {
      const view = renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n'))
      fireEvent.click(screen.getByRole('button', { name: '差分を最大表示' }))
      const maximized = screen.getByRole('button', { name: '最大表示を解除 (Esc)' })
      expect(maximized).toHaveAttribute('aria-pressed', 'true')
      const overlay = Array.from(view.container.querySelectorAll('div')).find((element) => getComputedStyle(element).position === 'fixed')
      expect(overlay).toContainElement(maximized)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(left).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: '差分を最大表示' })).toHaveAttribute('aria-pressed', 'false')
      // Not maximized, Esc is the app's again.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(left).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', left)
    }
  })

  it('lets a focused comment editor have Esc before the maximized view', () => {
    renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n'))
    fireEvent.click(screen.getByRole('button', { name: '差分を最大表示' }))
    const composer = document.createElement('div')
    composer.dataset.composer = ''
    document.body.append(composer)
    fireEvent.keyDown(composer, { key: 'Escape' })
    composer.remove()
    expect(screen.getByRole('button', { name: '最大表示を解除 (Esc)' })).toBeInTheDocument()
  })

  describe('with the file tree beside the diff', () => {
    let realObserver: typeof ResizeObserver
    beforeEach(() => {
      realObserver = globalThis.ResizeObserver
      // A pane wide enough for the tree at a wider choice.
      globalThis.ResizeObserver = class {
        constructor(private readonly report: ResizeObserverCallback) {}
        observe() { this.report([{ contentRect: { width: 1400 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    })
    afterEach(() => { globalThis.ResizeObserver = realObserver })
    const diff = makeDiff('@@ -1 +1 @@\n-old\n+new\n')

    it('keeps a chosen table of contents entry current until the reader moves the page', async () => {
      Element.prototype.scrollIntoView = vi.fn()
      const view = renderViewer(makeDiff('@@ -1,1 +1,2 @@ function first()\n a\n+b\n@@ -20,1 +21,3 @@\n c\n+export class Second {\n+}\n'))
      const contents = screen.getByRole('navigation', { name: '目次' })
      const entry = (name: string) => within(contents).getByRole('button', { name })
      // The first line stays at the top of the view, as when the file is too short to scroll to the chosen line.
      const atTop = view.container.querySelector('.diff-row')!
      document.elementsFromPoint = () => [atTop]
      try {
        await waitFor(() => expect(entry('1行目: function first()')).toHaveAttribute('aria-current', 'location'))
        fireEvent.click(entry('21行目: class Second'))
        expect(entry('21行目: class Second')).toHaveAttribute('aria-current', 'location')
        fireEvent.scroll(window)
        await new Promise((resolve) => requestAnimationFrame(resolve))
        expect(entry('21行目: class Second')).toHaveAttribute('aria-current', 'location')
        // Wheeling the list moves only the list.
        fireEvent.wheel(contents)
        await new Promise((resolve) => requestAnimationFrame(resolve))
        expect(entry('21行目: class Second')).toHaveAttribute('aria-current', 'location')
        fireEvent.wheel(atTop)
        await waitFor(() => expect(entry('1行目: function first()')).toHaveAttribute('aria-current', 'location'))
      } finally {
        Reflect.deleteProperty(document, 'elementsFromPoint')
      }
    })

    it('changes the width of the tree by dragging its edge, and remembers it', () => {
      const view = renderViewer(diff)
      const edge = screen.getByRole('separator', { name: 'ファイル一覧の幅' })
      const tree = screen.getByRole('navigation', { name: '変更ファイル' })
      expect(tree.style.flexBasis).toBe('240px')
      fireEvent.pointerDown(edge, { button: 0, clientX: 300 })
      fireEvent.pointerMove(edge, { clientX: 400 })
      expect(tree.style.flexBasis).toBe('340px')
      fireEvent.pointerUp(edge)
      expect(localStorage.getItem('gitlab-desktop:diff-file-tree-width')).toBe('340')
      view.unmount()
      renderViewer(diff)
      expect(screen.getByRole('navigation', { name: '変更ファイル' }).style.flexBasis).toBe('340px')
    })

    it('saves no width for a click on the edge that moves nothing', () => {
      renderViewer(diff)
      const edge = screen.getByRole('separator', { name: 'ファイル一覧の幅' })
      fireEvent.pointerDown(edge, { button: 0, clientX: 300 })
      fireEvent.pointerUp(edge)
      expect(localStorage.getItem('gitlab-desktop:diff-file-tree-width')).toBeNull()
    })

    it('changes the width with the keyboard and back to the default with a double click, within its limits', () => {
      renderViewer(diff)
      const edge = screen.getByRole('separator', { name: 'ファイル一覧の幅' })
      const tree = screen.getByRole('navigation', { name: '変更ファイル' })
      fireEvent.keyDown(edge, { key: 'ArrowRight' })
      expect(tree.style.flexBasis).toBe('256px')
      fireEvent.keyDown(edge, { key: 'Home' })
      expect(tree.style.flexBasis).toBe('160px')
      fireEvent.keyDown(edge, { key: 'ArrowLeft' })
      expect(tree.style.flexBasis).toBe('160px')
      fireEvent.keyDown(edge, { key: 'End' })
      expect(tree.style.flexBasis).toBe('600px')
      fireEvent.doubleClick(edge)
      expect(tree.style.flexBasis).toBe('240px')
    })
  })

  it('opens the tree over the diff where it does not fit beside it, and closes it on choosing a file', () => {
    const onlyFile = makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/one.ts')
    renderMany([onlyFile, makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/two.ts')])
    expect(screen.queryByRole('navigation', { name: '変更ファイル' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ファイルツリーを表示' }))
    const tree = screen.getByRole('navigation', { name: '変更ファイル' })
    fireEvent.click(within(tree).getByRole('button', { name: fileRow('src/two.ts') }))
    expect(shownPath()).toBe('src/two.ts')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the contents from the file heading and moves to the chosen entry', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    renderViewer(makeDiff('@@ -1,1 +1,2 @@ function first()\n a\n+b\n@@ -20,1 +21,3 @@\n c\n+export class Second {\n+}\n'))
    fireEvent.click(screen.getByRole('button', { name: 'このファイルの目次を表示' }))
    const contents = screen.getByRole('navigation', { name: '目次' })
    expect(within(contents).getByRole('button', { name: '1行目: function first()' })).toBeInTheDocument()
    fireEvent.click(within(contents).getByRole('button', { name: '21行目: class Second' }))
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
    expect(scrolled.mock.contexts.at(-1)).toHaveAttribute('data-line-index', '2')
    // Closes as the reader goes to the place.
    expect(screen.queryByRole('navigation', { name: '目次' })).not.toBeInTheDocument()
  })

  it('moves to the rendered block holding a chosen Markdown heading', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    renderViewer(makeDiff('@@ -1,2 +1,3 @@\n # Title\n+## Added heading\n same\n@@ -30,1 +31,2 @@\n end\n+## Last heading\n', 'README.md'))
    fireEvent.click(screen.getByRole('button', { name: 'このファイルの目次を表示' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: '目次' })).getByRole('button', { name: '31行目: Last heading' }))
    const target = scrolled.mock.contexts.at(-1) as HTMLElement
    expect(target.dataset.fileAnchor).toBe('32')
  })

  it('offers no contents in the whole-file view', () => {
    renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n'), { fileContent: 'new\n', view: 'file' })
    // It keeps its place in the heading, out of sight and out of the tab order.
    expect(screen.queryByRole('button', { name: 'このファイルの目次を表示' })).not.toBeInTheDocument()
  })

  it('keeps the sideways scrollbar in view and in step with the diff while lines stay on one row', () => {
    const view = renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n'))
    expect(view.container.querySelector('[data-testid="diff-scrollbar"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '長い行を折り返す' }))
    const bar = view.container.querySelector('[data-testid="diff-scrollbar"]') as HTMLElement
    expect(getComputedStyle(bar).position).toBe('sticky')
    expect(getComputedStyle(bar).overflowX).toBe('scroll')
    const diff = bar.previousElementSibling as HTMLElement
    bar.scrollLeft = 40
    fireEvent.scroll(bar)
    expect(diff.scrollLeft).toBe(40)
    diff.scrollLeft = 12
    fireEvent.scroll(diff)
    expect(bar.scrollLeft).toBe(12)
  })

  it('keeps long lines on one line when wrapping is off, and remembers the choice', () => {
    const view = renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n'))
    const toggle = screen.getByRole('button', { hidden: true, name: '長い行を折り返す' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(getComputedStyle(view.container.querySelector('.diff-code') as HTMLElement).whiteSpace).toBe('pre-wrap')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(getComputedStyle(view.container.querySelector('.diff-code') as HTMLElement).whiteSpace).toBe('pre')
    expect(localStorage.getItem('gitlab-desktop:diff-wrap-lines')).toBe('false')
    view.unmount()
    renderViewer(makeDiff('@@ -1 +1 @@\n-old\n+new\n'))
    expect(screen.getByRole('button', { hidden: true, name: '長い行を折り返す' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows every line of a long diff without paging', () => {
    const diff = makeDiff(`@@ -1,1500 +1,1500 @@\n${Array.from({ length: 1500 }, (_, index) => ` line ${index + 1}`).join('\n')}\n`)

    renderViewer(diff)

    expect(screen.getAllByTestId('diff-line')).toHaveLength(1500)
    expect(screen.getAllByTestId('diff-line').at(-1)).toHaveTextContent('line 1500')
    expect(screen.queryByRole('button', { name: /^次の\d+行$/u })).not.toBeInTheDocument()
  })

  it('highlights code syntax and marks search matches across highlighted tokens', () => {
    renderViewer(makeDiff('@@ -1 +1 @@\n-const enabled = false\n+const enabled = true\n'))

    const added = screen.getAllByTestId('diff-line')[1]
    expect(within(added).getByText('const')).toHaveClass('hljs-keyword')
    expect(within(added).getByText('true')).toHaveClass('hljs-literal')

    fireEvent.change(screen.getByRole('textbox', { name: '差分内を検索' }), { target: { value: 't enabled' } })
    expect(Array.from(added.querySelectorAll('mark')).map((mark) => mark.textContent).join('')).toBe('t enabled')
  })

  it('pages full-file content separately and reaches the end without an invented trailing line', () => {
    const content = Array.from({ length: 2_001 }, (_, index) => `内容 ${index + 1}`).join('\r\n')
    const diff = makeDiff('@@ -1 +1 @@\n-old\n+new\n')

    renderViewer(diff, { fileContent: content, view: 'file' })

    expect(screen.getAllByTestId('file-line')).toHaveLength(FILE_PAGE_SIZE)
    expect(screen.getAllByText(/表示 1.*1000.*2001行（残り1001行）/u)).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: `次の${FILE_PAGE_SIZE}行` })[0])
    expect(screen.getAllByTestId('file-line')).toHaveLength(FILE_PAGE_SIZE)
    expect(screen.getAllByText(/表示 1001.*2000.*2001行（残り1行）/u)).toHaveLength(2)
    // The same controls follow the last line, where reading the page ends.
    const view = screen.getByTestId('file-lines').parentElement!
    const scrollIntoView = vi.fn()
    view.scrollIntoView = scrollIntoView
    fireEvent.click(screen.getAllByRole('button', { name: `次の${FILE_PAGE_SIZE}行` }).at(-1)!)
    expect(screen.getAllByTestId('file-line')).toHaveLength(1)
    expect(screen.getAllByText(/表示 2001.*2001.*2001行/u)).toHaveLength(2)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(screen.getAllByTestId('file-line').at(-1)).toHaveTextContent('内容 2001')
  })

  it('shows a selected comment position far down a long diff and preserves its line number', async () => {
    const diff = makeDiff(`@@ -1,1800 +1,1800 @@\n${Array.from({ length: 1_800 }, (_, index) => ` line ${index + 1}`).join('\n')}\n`)
    const onComment = vi.fn()
    const position: Position = { baseSha: 'base', headSha: 'head', newLine: 1201, newPath: diff.newPath, oldPath: diff.oldPath, positionType: 'text', startSha: 'start' }

    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <DiffViewer diffs={[diff]} onComment={onComment} onSelectFile={vi.fn()} selectedFile={diff.newPath} selectedPosition={position} view="diff" onViewChange={vi.fn()} />
      </ThemeProvider>,
    )

    const comment = await screen.findByRole('button', { name: 'src/example.tsの1201行にコメント' })
    fireEvent.click(comment)
    expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ newLine: 1201, newPath: 'src/example.ts' }))
  })

  it('focuses the selected diff line far down a long diff', async () => {
    const diff = makeDiff(`@@ -1,1800 +1,1800 @@\n${Array.from({ length: 1_800 }, (_, index) => ` line ${index + 1}`).join('\n')}\n`)
    const position: Position = { baseSha: 'base', headSha: 'head', newLine: 1201, newPath: diff.newPath, oldPath: diff.oldPath, positionType: 'text', startSha: 'start' }

    renderViewer(diff, { selectedPosition: position })

    const comment = await screen.findByRole('button', { name: 'src/example.tsの1201行にコメント' })
    const selectedLine = comment.closest('[data-testid="diff-line"]')
    await waitFor(() => expect(selectedLine).toHaveFocus())
    expect(selectedLine).toHaveAttribute('data-line-id')
  })

  it('keeps invalid diff positions un-commentable and reports the unsafe state', () => {
    const diff = makeDiff('@@ -1,2 +1,2 @@\n-old\n+new\n')

    renderViewer(diff)

    expect(screen.getByRole('status')).toHaveTextContent('コメント位置を無効化')
    expect(screen.queryByRole('button', { name: /行にコメント/u })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
  })

  it('searches every loaded diff line of a long diff and navigates results in order', () => {
    const lines = Array.from({ length: 610 }, (_, index) => ` line ${index + 1}${index === 600 || index === 608 ? ' needle' : ''}`).join('\n')
    const diff = makeDiff(`@@ -1,610 +1,610 @@\n${lines}\n`)
    renderMany([diff])

    fireEvent.change(screen.getByRole('textbox', { name: '差分内を検索' }), { target: { value: 'needle' } })
    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))

    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').find((line) => line.dataset.searchActive === 'true')).toHaveTextContent('line 601 needle')

    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').find((line) => line.dataset.searchActive === 'true')).toHaveTextContent('line 609 needle')
    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').find((line) => line.dataset.searchActive === 'true')).toHaveTextContent('line 601 needle')
  })

  it('searches across fetched files and marks the active split row', () => {
    const first = makeDiff('@@ -1 +1 @@\n-old\n+new\n', 'src/a.ts')
    const second = makeDiff('@@ -1 +1 @@\n-old needle\n+new needle\n', 'src/b.ts')
    renderMany([first, second])

    fireEvent.click(screen.getByRole('button', { name: '左右に並べて比較' }))
    fireEvent.change(screen.getByRole('textbox', { name: '差分内を検索' }), { target: { value: 'needle' } })
    fireEvent.click(screen.getByRole('button', { name: '次の差分内検索結果' }))

    expect(shownPath()).toBe('src/b.ts')
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
    expect(within(navigation).getByRole('button', { name: fileRow('src/feature/a.ts'), hidden: true })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: fileRow('src/feature/b.ts'), hidden: true })).toBeInTheDocument()
    expect(within(navigation).queryByRole('button', { name: fileRow('src/other.ts'), hidden: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '次の一致ファイル' }))
    expect(shownPath()).toBe('src/feature/b.ts')

    fireEvent.change(screen.getByRole('textbox', { name: 'ファイル名を検索' }), { target: { value: 'does-not-exist' } })
    expect(within(navigation).getByText('一致するファイルはありません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次の一致ファイル' })).toBeDisabled()
  })

  it('shows changed files as a folder tree that folds, keeping the shown file visible, and as a flat list', () => {
    const change = '@@ -1 +1 @@\n-old\n+new\n'
    const first = makeDiff(change, 'src/feature/a.ts')
    const second = makeDiff(change, 'src/feature/b.ts')
    const third = makeDiff(change, 'docs/readme.md')
    renderMany([first, second, third], { initialFile: 'docs/readme.md' })

    const navigation = screen.getByRole('navigation', { hidden: true })
    // A folder holding only one folder is one row; folders come before files.
    const feature = within(navigation).getByRole('button', { name: 'フォルダ src/feature', hidden: true })
    expect(feature).toHaveTextContent('src/feature')
    expect(within(navigation).getByRole('button', { name: 'フォルダ docs', hidden: true })).toBeInTheDocument()
    fireEvent.click(feature)
    expect(feature).toHaveAttribute('aria-expanded', 'false')
    expect(within(navigation).queryByRole('button', { name: fileRow('src/feature/a.ts'), hidden: true })).not.toBeInTheDocument()
    // The folder of the shown file stays open.
    fireEvent.click(within(navigation).getByRole('button', { name: 'フォルダ docs', hidden: true }))
    expect(within(navigation).getByRole('button', { name: fileRow('docs/readme.md'), hidden: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '一覧表示', hidden: true }))
    expect(within(navigation).queryByRole('button', { name: /^フォルダ/u, hidden: true })).not.toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: fileRow('src/feature/a.ts'), hidden: true })).toBeInTheDocument()
    expect(localStorage.getItem('gitlab-desktop:diff-file-list')).toBe('list')
  })

  it('shows the tree with its file search only when the diff keeps room beside it, and lets the reader hide it', () => {
    let width = 1000
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { const report = () => this.callback([{ contentRect: { width } }]); observers.push(report); report() }
      disconnect() {}
    })
    try {
      const change = '@@ -1 +1 @@\n-old\n+new\n'
      renderMany([makeDiff(change, 'src/a.ts'), makeDiff(change, 'src/b.ts')])

      const tree = screen.getByRole('navigation', { name: '変更ファイル' })
      expect(within(tree).getByRole('textbox', { name: 'ファイル名を検索' })).toBeInTheDocument()

      // Side by side needs more room, so at this width the tree steps aside and its search moves to the diff.
      fireEvent.click(screen.getByRole('button', { name: '左右に並べて比較' }))
      expect(screen.queryByRole('navigation', { name: '変更ファイル' })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'ファイル名を検索' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '統合表示' }))

      fireEvent.click(screen.getByRole('button', { name: 'ファイルツリーを隠す' }))
      expect(screen.queryByRole('navigation', { name: '変更ファイル' })).not.toBeInTheDocument()
      expect(localStorage.getItem('gitlab-desktop:diff-file-tree-hidden')).toBe('true')
      fireEvent.click(screen.getByRole('button', { name: 'ファイルツリーを表示' }))
      expect(screen.getByRole('navigation', { name: '変更ファイル' })).toBeInTheDocument()

      width = 700
      act(() => observers.forEach((report) => report()))
      // Too narrow to sit beside the diff: the button stays, and opens the tree over it.
      expect(screen.queryByRole('navigation', { name: '変更ファイル' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ファイルツリーを表示' })).toHaveAttribute('aria-haspopup', 'dialog')
    } finally {
      vi.unstubAllGlobals()
    }
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

describe('DiffViewer line comments', () => {
  const author = { id: '9', name: 'Colleague', username: 'colleague' }
  const at = (headSha: string, line: { newLine?: number; oldLine?: number }): Position => ({ baseSha: 'base', headSha, newPath: 'src/example.ts', oldPath: 'src/example.ts', positionType: 'text', startSha: 'start', ...line })
  const thread = (id: string, position: Position, body: string, resolved = false) => ({ id, individualNote: false, notes: [{ author, body, createdAt: '2026-01-01T00:00:00.000Z', id: `${id}-note`, position, resolvable: true, resolved, system: false }] })

  it('places current threads under their lines, folds resolved ones and counts outdated ones', () => {
    const diff = makeDiff('@@ -1,2 +1,2 @@\n-old\n+new\n same\n')
    render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer discussionHeadSha="head" discussions={[
      thread('removed', at('head', { oldLine: 1 }), '削除行へのコメント'),
      thread('resolved', at('head', { newLine: 2, oldLine: 2 }), '解決済みの本文', true),
      thread('outdated', at('older', { newLine: 1 }), '古い版へのコメント'),
    ]} diffs={[diff]} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile="src/example.ts" selectedPosition={undefined} view="diff" /></ThemeProvider>)

    const removed = screen.getByText('削除行へのコメント').closest('.diff-threads')
    expect(removed?.previousElementSibling?.textContent).toContain('old')
    expect(screen.queryByText('解決済みの本文')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '表示' }))
    expect(screen.getByText('解決済みの本文').closest('.diff-threads')?.previousElementSibling?.textContent).toContain('same')
    expect(screen.queryByText('古い版へのコメント')).not.toBeInTheDocument()
    expect(screen.getByText(/古い版へのコメント1件/u)).toBeInTheDocument()
  })
})

describe('DiffViewer multi-line comments and whitespace', () => {
  beforeEach(() => localStorage.clear())
  // Rows: a (10/10), -b (11), +B (11), +C (12), d (12/13) | -x (30), +y (31)
  const diff = makeDiff('@@ -10,3 +10,4 @@\n a\n-b\n+B\n+C\n d\n@@ -30 +31 @@\n-x\n+y\n')
  const renderFor = (onComment = vi.fn(), extra: Partial<React.ComponentProps<typeof DiffViewer>> = {}) => {
    render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={[diff]} onComment={onComment} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile="src/example.ts" selectedPosition={undefined} view="diff" {...extra} /></ThemeProvider>)
    return onComment
  }
  const lineButton = (label: string, index = 0) => screen.getAllByRole('button', { name: `src/example.tsの${label}行にコメント` })[index]

  it('chooses lines with Shift+↑/↓ on the comment buttons and comments on them with Enter', async () => {
    const onComment = renderFor()
    lineButton('10').focus()
    fireEvent.keyDown(lineButton('10'), { key: 'ArrowDown', shiftKey: true })
    await waitFor(() => expect(lineButton('11', 0)).toHaveFocus())
    fireEvent.keyDown(lineButton('11', 0), { key: 'ArrowDown', shiftKey: true })
    await waitFor(() => expect(lineButton('11', 1)).toHaveFocus())
    expect(screen.getByText(/10〜11行目を選択中です/u)).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').filter((row) => row.dataset.range === 'true')).toHaveLength(3)

    // Enter on a button is a click; it comments on the chosen lines.
    fireEvent.click(lineButton('11', 1))
    expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({
      lineRange: { end: { newLine: 11, newPosition: 11, oldPosition: 12 }, hunk: { newCount: 4, newStart: 10, oldCount: 3, oldStart: 10 }, start: { newLine: 10, newPosition: 10, oldLine: 10, oldPosition: 10 } },
      newLine: 11,
    }))
  })

  it('does not choose lines across hunks, and Esc drops a choice', () => {
    const onComment = renderFor()
    fireEvent.keyDown(lineButton('13'), { key: 'ArrowDown', shiftKey: true })
    expect(screen.queryByText(/行目を選択中です/u)).not.toBeInTheDocument()
    fireEvent.keyDown(lineButton('13'), { key: 'ArrowUp', shiftKey: true })
    expect(screen.getByText(/12〜13行目を選択中です/u)).toBeInTheDocument()
    fireEvent.keyDown(lineButton('12'), { key: 'Escape' })
    expect(screen.queryByText(/行目を選択中です/u)).not.toBeInTheDocument()

    fireEvent.click(lineButton('13'))
    fireEvent.click(lineButton('31'), { shiftKey: true })
    expect(onComment).toHaveBeenLastCalledWith(expect.not.objectContaining({ lineRange: expect.anything() }))
  })

  it('chooses lines by dragging over the gutter or by Shift+click', () => {
    const onComment = renderFor()
    fireEvent.mouseDown(lineButton('10'), { button: 0 })
    const rows = screen.getAllByTestId('diff-line')
    fireEvent.mouseOver(rows[3])
    expect(rows.map((row) => row.dataset.range === 'true')).toEqual([true, true, true, true, false, false, false])
    fireEvent.mouseUp(window)
    expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ lineRange: expect.objectContaining({ end: expect.objectContaining({ newLine: 12 }), start: expect.objectContaining({ newLine: 10 }) }), newLine: 12 }))

    fireEvent.click(lineButton('11', 1))
    fireEvent.click(lineButton('13'), { shiftKey: true })
    expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ lineRange: expect.objectContaining({ end: expect.objectContaining({ newLine: 13, oldLine: 12 }), start: expect.objectContaining({ newLine: 11 }) }), newLine: 13 }))
  })

  it('shows a multi-line comment under its last line with its lines', () => {
    const author = { id: '9', name: 'Colleague', username: 'colleague' }
    const position: Position = { baseSha: 'base', headSha: 'head', lineRange: { end: { newLine: 12, type: 'new' }, start: { newLine: 10, oldLine: 10, type: 'old' } }, newLine: 12, newPath: 'src/example.ts', oldPath: 'src/example.ts', positionType: 'text', startSha: 'start' }
    renderFor(vi.fn(), { discussionHeadSha: 'head', discussions: [{ id: 'range', individualNote: false, notes: [{ author, body: '3行への指摘', createdAt: '2026-01-01T00:00:00.000Z', id: 'n1', position, resolvable: true, resolved: false, system: false }] }] })
    const thread = screen.getByText('3行への指摘').closest('.diff-threads') as HTMLElement
    expect(thread.previousElementSibling?.textContent).toContain('C')
    expect(within(thread).getByText('10〜12行目へのコメント')).toBeInTheDocument()
  })

  it('folds whitespace-only changes when asked, remembers it, and stops new line comments meanwhile', () => {
    const spaced = makeDiff('@@ -1,3 +1,3 @@\n-if (a) {\n-  run()\n+if (a)  {\n+    run()\n }\n', 'src/space.ts')
    const view = render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer allowComments diffs={[spaced]} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile="src/space.ts" selectedPosition={undefined} view="diff" /></ThemeProvider>)
    expect(screen.getAllByTestId('diff-line')).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: '空白を無視' }))
    const rows = screen.getAllByTestId('diff-line')
    expect(rows.map((row) => row.dataset.kind)).toEqual(['context', 'context', 'context'])
    expect(rows[1].textContent).toContain('    run()')
    expect(screen.getByText('このファイルは空白の変更のみです。')).toBeInTheDocument()
    expect(screen.getByText(/新しい行コメントは書けません/u)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /行にコメント$/u })).not.toBeInTheDocument()
    expect(localStorage.getItem('gitlab-desktop:diff-ignore-whitespace')).toBe('true')

    view.unmount()
    renderFor()
    expect(screen.getByRole('button', { name: '空白を無視' })).toHaveAttribute('aria-pressed', 'true')
    // Real changes stay changes while whitespace is ignored.
    expect(screen.getAllByTestId('diff-line').filter((row) => row.dataset.kind !== 'context')).toHaveLength(5)
  })
})

describe('Markdown full-file preview', () => {
  it('renders Markdown by default and allows inspecting the original source', () => {
    render(<ThemeProvider theme={createAppTheme('light')}>
      <FullFileView content={'# Example heading\n\n**important**'} language="markdown" loading={false} path="docs/guide.MD" />
    </ThemeProvider>)
    expect(screen.getByRole('heading', { name: 'Example heading' })).toBeInTheDocument()
    expect(screen.queryByTestId('file-line')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Markdownのソースを表示' }))
    expect(screen.getAllByTestId('file-line').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Markdownをレンダリング' }))
    expect(screen.getByRole('heading', { name: 'Example heading' })).toBeInTheDocument()
  })
})

describe('Markdown rendered diff presentation', () => {
  beforeEach(() => localStorage.clear())

  it('renders only edited lines, highlights additions and removals, and switches back to reviewable source diff', () => {
    const diff = makeDiff('@@ -1,4 +1,4 @@\n # Unchanged title\n-## Old review\n+## **New review**\n context outside the change\n ending\n', 'docs/README.md')
    renderViewer(diff, { fileContent: '# Whole README\n\nSomething else', view: 'diff' })
    const preview = screen.getByRole('region', { name: 'Markdown差分プレビュー' })
    expect(within(preview).getByRole('heading', { name: 'Old review' })).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'New review' })).toBeInTheDocument()
    expect(within(preview).queryByText('Unchanged title')).not.toBeInTheDocument()
    expect(screen.queryByText('Whole README')).not.toBeInTheDocument()
    expect(within(preview).getByRole('region', { name: '削除 2行' })).toHaveAttribute('data-kind', 'remove')
    expect(within(preview).getByRole('region', { name: '追加 2行' })).toHaveAttribute('data-kind', 'add')
    expect(screen.queryByTestId('diff-line')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Markdown差分のソースを表示' }))
    expect(screen.getAllByTestId('diff-line')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Markdown差分をプレビュー表示' })).toBeInTheDocument()
  })

  it('opens a linked old line comment in the source diff, retaining the line selection', () => {
    const diff = makeDiff('@@ -5,1 +5,1 @@\n-before\n+after\n', 'docs/guide.markdown')
    const selectedPosition: Position = { baseSha: 'base', headSha: 'head', newLine: 5, newPath: 'docs/guide.markdown', oldPath: 'docs/guide.markdown', positionType: 'text', startSha: 'start' }
    renderViewer(diff, { selectedPosition, view: 'diff' })
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
    expect(screen.queryByRole('region', { name: 'Markdown差分プレビュー' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Markdown差分をプレビュー表示' }))
    expect(screen.getByRole('region', { name: 'Markdown差分プレビュー' })).toBeInTheDocument()
  })
})
