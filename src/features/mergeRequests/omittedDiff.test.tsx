import { ThemeProvider } from '@mui/material/styles'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppTheme } from '../../theme'
import type { Diff, FileQuery } from '../../types/gitlab'
import { DiffViewer } from './DiffViewer'
import { parseDiff } from './diffParser'
import { diffFromFiles, listMissesFiles } from './omittedDiff'

const files = vi.hoisted(() => new Map<string, { data?: { content: string }; error?: Error }>())

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_session: string | null, query: FileQuery | null) => {
    const file = query ? files.get(`${query.sha}:${query.path}`) : undefined
    return { data: file?.data ?? null, error: file?.error ?? null, loading: Boolean(query && !file), refresh: vi.fn(), refreshing: false, snapshot: null }
  },
}))

const omitted: Diff = { collapsed: false, deletedFile: false, diff: '', newFile: false, newPath: 'src/large.ts', oldPath: 'src/large.ts', renamedFile: false, tooLarge: true }
const source = { projectId: '42', sessionId: 's', sha: 'head', beforeSha: 'base' }

function renderViewer(diff: Diff, fileSource: { projectId: string; sessionId: string; sha: string; beforeSha?: string } = source) {
  return render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={[diff]} fileSource={fileSource} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={diff.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)
}

describe('diffFromFiles', () => {
  it('shapes the comparison so the diff parser reads it with its line numbers', () => {
    const parsed = parseDiff(diffFromFiles('a\nb\nc\n', 'a\nB\nc\nd\n') ?? '', 'x', 'x')
    expect(parsed.status).toBe('valid')
    expect(parsed.lines.filter((line) => line.kind !== 'context').map((line) => [line.prefix, line.text, line.oldLine ?? line.newLine])).toEqual([['-', 'b', 2], ['+', 'B', 2], ['+', 'd', 4]])
  })

  it('reads a new file, a deleted file and a missing last newline', () => {
    expect(parseDiff(diffFromFiles('', 'a\n') ?? '', 'x', 'x').lines.map((line) => [line.prefix, line.newLine])).toEqual([['+', 1]])
    expect(parseDiff(diffFromFiles('a\n', '') ?? '', 'x', 'x').lines.map((line) => [line.prefix, line.oldLine])).toEqual([['-', 1]])
    expect(parseDiff(diffFromFiles('a', 'a\n') ?? '', 'x', 'x').status).toBe('valid')
  })

  it('has no diff for the same content and gives up on what is not text', () => {
    expect(diffFromFiles('a\n', 'a\n')).toBe('')
    expect(diffFromFiles('a\0b', 'c')).toBeNull()
  })

  it('gives up on two versions too large to compare on the UI thread', () => {
    expect(diffFromFiles('a\n'.repeat(300_000), 'b\n'.repeat(250_000))).toBeNull()
  })
})

describe('listMissesFiles', () => {
  it('reads a capped count as missing files and otherwise compares the list', () => {
    expect(listMissesFiles('1000+', 1000)).toBe(true)
    expect(listMissesFiles('300+', 100)).toBe(true)
    expect(listMissesFiles('12', 10)).toBe(true)
    expect(listMissesFiles('12', 12)).toBe(false)
    expect(listMissesFiles(null, 3)).toBe(false)
    expect(listMissesFiles(undefined, 3)).toBe(false)
  })
})

describe('a file whose diff GitLab left out', () => {
  beforeEach(() => files.clear())

  it('shows the comparison of its two versions, without line comments', async () => {
    files.set('base:src/large.ts', { data: { content: 'one\ntwo\n' } })
    files.set('head:src/large.ts', { data: { content: 'one\nchanged\n' } })
    renderViewer(omitted)
    expect(await screen.findByText('changed')).toBeInTheDocument()
    expect(screen.getByText(/変更前後のファイルを比較して表示/u)).toBeInTheDocument()
    expect(screen.queryByText('この差分は大きすぎるため省略されています。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /コメント/u })).not.toBeInTheDocument()
  })

  it('reads a renamed file from its old path', async () => {
    files.set('base:src/old.ts', { data: { content: 'before\n' } })
    files.set('head:src/large.ts', { data: { content: 'after\n' } })
    renderViewer({ ...omitted, collapsed: true, oldPath: 'src/old.ts', renamedFile: true, tooLarge: false })
    expect(await screen.findByText('after')).toBeInTheDocument()
  })

  it('reads only the version a new or deleted file has', async () => {
    files.set('head:src/large.ts', { data: { content: 'added\n' } })
    const { unmount } = renderViewer({ ...omitted, newFile: true }, { projectId: '42', sessionId: 's', sha: 'head' })
    expect(await screen.findByText('added')).toBeInTheDocument()
    unmount()
    files.clear()
    files.set('base:src/large.ts', { data: { content: 'removed\n' } })
    renderViewer({ ...omitted, deletedFile: true })
    expect(await screen.findByText('removed')).toBeInTheDocument()
  })

  it('says why when a version cannot be read, and keeps the message of the omitted diff', async () => {
    files.set('base:src/large.ts', { error: new Error('1MB超') })
    files.set('head:src/large.ts', { data: { content: 'x\n' } })
    renderViewer(omitted)
    expect(await screen.findByText(/差分を作れませんでした: 1MB超/u)).toBeInTheDocument()
    expect(screen.getByText('この差分は大きすぎるため省略されています。')).toBeInTheDocument()
  })

  it('reads nothing for a diff GitLab gave, or without a source', () => {
    renderViewer({ ...omitted, diff: '@@ -1 +1 @@\n-a\n+b\n', tooLarge: false })
    expect(screen.queryByText(/変更前後のファイル/u)).not.toBeInTheDocument()
    expect(files.size).toBe(0)
  })

  it('keeps only the message without a source to read', () => {
    render(<ThemeProvider theme={createAppTheme('dark')}><DiffViewer diffs={[omitted]} onComment={vi.fn()} onSelectFile={vi.fn()} onViewChange={vi.fn()} selectedFile={omitted.newPath} selectedPosition={undefined} view="diff" /></ThemeProvider>)
    expect(screen.getByText('この差分は大きすぎるため省略されています。')).toBeInTheDocument()
  })
})
