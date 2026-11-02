import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { useState, useSyncExternalStore } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Diff, Discussion, Position } from '../../types/gitlab'
import { DiffViewer } from './DiffViewer'
import { setFileReviewed, type ReviewedFileContext } from './useReviewedFiles'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

function makeDiff(diff: string, path = 'src/example.ts'): Diff {
  return { oldPath: path, newPath: path, diff, newFile: false, deletedFile: false, renamedFile: false, tooLarge: false, collapsed: false }
}

const change = '@@ -1 +1 @@\n-old\n+new\n'

function Harness({ context, diffs, discussions, fileContent, fileSource }: { context?: ReviewedFileContext; diffs: Diff[]; discussions?: Discussion[]; fileContent?: string; fileSource?: { sessionId: string; projectId: string; sha: string } }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(diffs[0].newPath)
  const [view, setView] = useState<'diff' | 'file'>('diff')
  return <ThemeProvider theme={createAppTheme('light')}><DiffViewer discussionHeadSha="head" discussions={discussions} diffs={diffs} fileContent={fileContent} fileSource={fileSource} onComment={vi.fn()} onSelectFile={setSelectedFile} onViewChange={setView} reviewContext={context} selectedFile={selectedFile} selectedPosition={undefined} view={view} /></ThemeProvider>
}

const shownPath = (container: HTMLElement) => container.querySelector('bdi')?.textContent

describe('DiffViewer review flow', () => {
  beforeEach(() => {
    localStorage.clear()
    queryMock.mockReset()
  })

  it('marks threads per file, unresolved ones with their own icon and name', () => {
    const author = { id: '9', name: 'Colleague', username: 'colleague' }
    const at = (path: string): Position => ({ baseSha: 'base', headSha: 'head', newLine: 1, newPath: path, oldPath: path, positionType: 'text', startSha: 'start' })
    const thread = (id: string, path: string, resolved: boolean): Discussion => ({ id, individualNote: false, notes: [{ author, body: id, createdAt: '2026-01-01T00:00:00.000Z', id: `${id}-note`, position: at(path), resolvable: true, resolved, system: false }] })
    render(<Harness diffs={[makeDiff(change, 'src/a.ts'), makeDiff(change, 'src/b.ts'), makeDiff(change, 'src/c.ts')]} discussions={[thread('t1', 'src/a.ts', false), thread('t2', 'src/a.ts', true), thread('t3', 'src/b.ts', true)]} />)

    const navigation = screen.getByRole('navigation', { hidden: true })
    expect(within(navigation).getByRole('button', { hidden: true, name: 'src/a.ts、スレッド2件（未解決1件）' })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { hidden: true, name: 'src/b.ts、スレッド1件（すべて解決済み）' })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { hidden: true, name: 'src/c.ts' })).toBeInTheDocument()
    expect(within(navigation).getByRole('img', { hidden: true, name: 'スレッド2件（未解決1件）' })).toHaveAttribute('data-unresolved', 'true')
    expect(within(navigation).getByRole('img', { hidden: true, name: 'スレッド1件（すべて解決済み）' })).not.toHaveAttribute('data-unresolved')

    fireEvent.click(screen.getByRole('button', { hidden: true, name: '一覧表示' }))
    expect(within(navigation).getByRole('button', { hidden: true, name: 'src/a.ts、スレッド2件（未解決1件）' })).toBeInTheDocument()
  })

  it('counts reviewed files and opens the next unreviewed file after marking one', () => {
    const context: ReviewedFileContext = { instanceUrl: 'https://gitlab.example', userId: '7', projectId: '15', mergeRequestIid: '42', revision: 'head-a' }
    const diffs = [makeDiff(change, 'src/a.ts'), makeDiff(change, 'src/b.ts'), makeDiff(change, 'src/c.ts')]
    setFileReviewed(context, diffs[1], true)
    const { container } = render(<Harness context={context} diffs={diffs} />)
    expect(screen.getByText('確認済み 1/3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '確認済みにする' }))
    // The reviewed b.ts is skipped.
    expect(shownPath(container)).toBe('src/c.ts')
    expect(screen.getByText('確認済み 2/3')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { hidden: true })).getByRole('button', { hidden: true, name: 'src/a.ts、確認済み' })).toBeInTheDocument()

    // With nothing left to review, and when unmarking, the file stays.
    fireEvent.click(screen.getByRole('button', { name: '確認済みにする' }))
    expect(shownPath(container)).toBe('src/c.ts')
    expect(screen.getByText('確認済み 3/3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認済み' }))
    expect(shownPath(container)).toBe('src/c.ts')
    expect(screen.getByText('確認済み 2/3')).toBeInTheDocument()
  })

  it('steps through files with ] and [ except while typing or in a dialog', () => {
    const { container } = render(<Harness diffs={[makeDiff(change, 'src/a.ts'), makeDiff(change, 'src/b.ts')]} />)
    expect(screen.getByRole('button', { name: '次のファイル' })).toHaveAttribute('aria-keyshortcuts', ']')

    fireEvent.keyDown(document.body, { key: ']' })
    expect(shownPath(container)).toBe('src/b.ts')
    fireEvent.keyDown(document.body, { key: ']' })
    expect(shownPath(container)).toBe('src/b.ts')

    fireEvent.keyDown(screen.getByRole('textbox', { name: '差分内を検索' }), { key: '[' })
    expect(shownPath(container)).toBe('src/b.ts')
    fireEvent.keyDown(document.body, { ctrlKey: true, key: '[' })
    expect(shownPath(container)).toBe('src/b.ts')

    const dialog = document.body.appendChild(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    fireEvent.keyDown(document.body, { key: '[' })
    expect(shownPath(container)).toBe('src/b.ts')
    dialog.remove()

    fireEvent.keyDown(document.body, { key: '[' })
    expect(shownPath(container)).toBe('src/a.ts')
  })

  it('does not step through files while an open menu or list has the keyboard', () => {
    const { container } = render(<Harness diffs={[makeDiff(change, 'src/a.ts'), makeDiff(change, 'src/b.ts')]} />)
    for (const role of ['menu', 'menubar', 'listbox']) {
      const menu = document.body.appendChild(document.createElement('div'))
      menu.setAttribute('role', role)
      const item = menu.appendChild(document.createElement('div'))
      item.tabIndex = -1
      fireEvent.keyDown(item, { key: ']' })
      expect(shownPath(container)).toBe('src/a.ts')
      menu.remove()
    }
    fireEvent.keyDown(document.body, { key: ']' })
    expect(shownPath(container)).toBe('src/b.ts')
  })

  it('keeps the diff and an open line comment editor mounted when Blame is toggled', () => {
    queryMock.mockReturnValue({ data: undefined, error: null, loading: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false })
    const diff = makeDiff(change)
    const position: Position = { baseSha: 'base', headSha: 'head', newLine: 1, newPath: diff.newPath, oldPath: diff.oldPath, positionType: 'text', startSha: 'base' }
    render(<ThemeProvider theme={createAppTheme('light')}><DiffViewer diffs={[diff]} fileSource={{ projectId: '15', sessionId: 's1', sha: 'head-sha' }} lineComposer={{ node: <textarea aria-label="composer" />, position }} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={diff.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)
    const editor = screen.getByRole('textbox', { name: 'composer' }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'half-written' } })

    fireEvent.click(screen.getByRole('button', { name: 'Blame' }))
    expect(screen.getByRole('button', { name: 'Blame' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Blame' }))
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(editor)
    expect(editor.value).toBe('half-written')
  })

  it('keeps a path starting with a symbol in order while its start is cut', () => {
    const { container } = render(<Harness diffs={[makeDiff(change, '.gitlab-ci.yml')]} />)
    const isolate = container.querySelector('bdi')
    expect(isolate).toHaveAttribute('dir', 'ltr')
    expect(isolate).toHaveTextContent('.gitlab-ci.yml')
    expect(screen.getByRole('group', { name: '差分とファイル全体の切り替え' })).toBeInTheDocument()
  })
})

describe('DiffViewer unchanged lines', () => {
  // Hunk 2 sits one line lower on the new side, so hidden lines differ by one between sides.
  const diff = makeDiff('@@ -3,2 +3,3 @@\n a\n-b\n+c\n+c2\n@@ -20,1 +21,2 @@\n d\n+e\n')
  const file = Array.from({ length: 22 }, (_, index) => ({ 3: 'a', 4: 'c', 5: 'c2', 21: 'd', 22: 'e' } as Record<number, string>)[index + 1] ?? `line ${index + 1}`).join('\n')
  const numbers = (row: Element) => Array.from(row.querySelectorAll('.diff-number, .split-number'), (cell) => cell.textContent)

  beforeEach(() => {
    localStorage.clear()
    queryMock.mockReset()
  })

  it('opens hidden lines with the line numbers of both sides', () => {
    render(<Harness diffs={[diff]} fileContent={file} />)
    fireEvent.click(screen.getByRole('button', { name: '変更のない15行を表示' }))
    const opened = screen.getAllByTestId('diff-opened-line')
    expect(opened).toHaveLength(15)
    expect(numbers(opened[0])).toEqual(['5', '6'])
    expect(opened[0]).toHaveTextContent('line 6')
    expect(numbers(opened[14])).toEqual(['19', '20'])
    expect(screen.queryByRole('button', { name: '変更のない15行を表示' })).not.toBeInTheDocument()
    // Opened lines are not part of the diff's lines.
    expect(screen.getAllByTestId('diff-line')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: '左右に並べて比較' }))
    fireEvent.click(screen.getByRole('button', { name: '変更のない2行を表示' }))
    const split = screen.getAllByTestId('diff-opened-line')
    expect(split).toHaveLength(17)
    expect(numbers(split[0])).toEqual(['1', '1'])
    expect(Array.from(split[0].querySelectorAll('.split-code'), (cell) => cell.textContent)).toEqual(['line 1', 'line 1'])
    localStorage.removeItem('gitlab-desktop:diff-layout')
  })

  it('keeps the row with a short error when the file does not match the diff', () => {
    render(<Harness diffs={[diff]} fileContent={file.replace('\nd\n', '\nchanged\n')} />)
    fireEvent.click(screen.getByRole('button', { name: '変更のない15行を表示' }))
    expect(screen.getByText('ファイルの内容が差分と一致しないため表示できません。')).toBeInTheDocument()
    expect(screen.getByText('⋯ 変更のない15行')).toBeInTheDocument()
    expect(screen.queryByTestId('diff-opened-line')).not.toBeInTheDocument()
  })

  it('opens a long gap one bounded step at a time', () => {
    const long = makeDiff('@@ -1 +1 @@\n-a\n+b\n@@ -1000 +1000 @@\n x\n')
    const content = Array.from({ length: 1000 }, (_, index) => index === 0 ? 'b' : index === 999 ? 'x' : `line ${index + 1}`).join('\n')
    render(<Harness diffs={[long]} fileContent={content} />)
    fireEvent.click(screen.getByRole('button', { name: '変更のない998行を表示' }))
    expect(screen.getAllByTestId('diff-opened-line')).toHaveLength(600)
    fireEvent.click(screen.getByRole('button', { name: '変更のない398行を表示' }))
    expect(screen.getAllByTestId('diff-opened-line')).toHaveLength(998)
  })

  it('reads the file on demand with the whole-file query and keeps the row when that fails', () => {
    const refresh = vi.fn()
    const state = (data: unknown, error: unknown) => ({ data, error, loading: false, refreshing: false, refresh, snapshot: null, stale: false })
    // A disabled (null) query, as the closed Blame's, has no data. A new answer renders the
    // components that read the query again, as React Query does, not the whole tree.
    const listeners = new Set<() => void>()
    let version = 0
    const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
    const answer = (data: unknown, error: unknown) => {
      queryMock.mockImplementation((_session: string, query: unknown) => {
        useSyncExternalStore(subscribe, () => version)
        return query ? state(data, error) : state(undefined, null)
      })
      version += 1
      listeners.forEach((listener) => listener())
    }
    answer(null, { message: 'offline' })
    render(<Harness diffs={[diff]} fileSource={{ projectId: '15', sessionId: 's1', sha: 'head-sha' }} />)
    // Only the closed Blame's disabled queries are asked for before the row is opened.
    expect(queryMock.mock.calls.every(([, query]) => query === null)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '変更のない15行を表示' }))
    expect(queryMock).toHaveBeenLastCalledWith('s1', { kind: 'file', path: 'src/example.ts', projectId: '15', sha: 'head-sha' })
    // Same key order as the whole-file view's query, so both share one cache entry.
    expect(JSON.stringify(queryMock.mock.lastCall?.[1])).toBe(JSON.stringify({ kind: 'file', path: 'src/example.ts', projectId: '15', sha: 'head-sha' }))
    expect(screen.getByText('ファイルを取得できなかったため表示できません。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '変更のない15行を表示' }))
    expect(refresh).toHaveBeenCalled()

    act(() => answer({ content: file }, null))
    expect(screen.getAllByTestId('diff-opened-line')).toHaveLength(15)
  })

  it('leaves the row closed when the file cannot be read', () => {
    render(<Harness diffs={[diff]} />)
    expect(screen.getByText('⋯ 変更のない15行')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /変更のない.*行を表示/u })).not.toBeInTheDocument()
  })
})
