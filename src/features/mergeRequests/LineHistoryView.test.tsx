import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import { LineHistoryView } from './LineHistoryView'

const { queryGitLabMock } = vi.hoisted(() => ({ queryGitLabMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: () => ({ data: null, error: null, loading: false }) }))
vi.mock('../../lib/gitlab', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/gitlab')>(), queryGitLab: queryGitLabMock }))

const sha = (char: string) => char.repeat(40)
const diff = (text: string, path = 'a.ts', oldPath = path) => ({ collapsed: false, deletedFile: false, diff: text, newFile: false, newPath: path, oldPath, renamedFile: path !== oldPath, tooLarge: false })

beforeEach(() => {
  // h: head, where line 2 came from commit c; c's parent p got it from commit d, which added it.
  queryGitLabMock.mockReset().mockImplementation(async ({ mode, query }: { mode: string; query: { kind: string; sha: string; page?: number } }) => {
    if (mode === 'cache') return null
    if (query.kind === 'blame' && query.sha === sha('h')) return { data: [{ authorName: 'Carol', commitId: sha('c'), committedAt: '2026-05-01T00:00:00Z', lines: ['two v2'], parentIds: [sha('p')], title: 'Rewrite two' }] }
    if (query.kind === 'blame' && query.sha === sha('p')) return { data: [{ authorName: 'Dave', commitId: sha('d'), committedAt: '2026-01-01T00:00:00Z', lines: ['two'], parentIds: [sha('q')], title: 'Add two' }] }
    if (query.kind === 'commitDiff' && query.sha === sha('c')) return { data: query.page === 1 ? [diff('@@ -2 +2 @@\n-two\n+two v2', 'b.ts', 'a.ts')] : [] }
    if (query.kind === 'commitDiff' && query.sha === sha('d')) return { data: query.page === 1 ? [diff('@@ -1,0 +2 @@\n+two', 'a.ts')] : [] }
    throw new Error(`unexpected ${query.kind}`)
  })
})

it('follows the lines back one commit at a time, through a rename, to where they were added', async () => {
  render(<ThemeProvider theme={createAppTheme('light')}><LineHistoryView iid="5" onClose={vi.fn()} onRestart={vi.fn()} projectId="7" sessionId="s1" start={{ path: 'b.ts', range: { start: 2, end: 2 }, sha: sha('h') }} /></ThemeProvider>)
  const steps = screen.getByRole('list', { name: '変更したコミット' })
  expect(await within(steps).findByText('Rewrite two')).toBeInTheDocument()
  expect(screen.getAllByText('two v2').length).toBeGreaterThan(0)
  expect(queryGitLabMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'network', query: { iid: '5', kind: 'commitDiff', page: 1, projectId: '7', sha: sha('c') } }))

  fireEvent.click(screen.getByRole('button', { name: 'さらに前へ' }))
  expect(await within(steps).findByText('Add two')).toBeInTheDocument()
  expect(queryGitLabMock).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ kind: 'blame', path: 'a.ts', sha: sha('p'), startLine: 2, endLine: 2 }) }))
  expect(screen.getByRole('status')).toHaveTextContent('ここで追加された行です。')
  expect(screen.queryByRole('button', { name: 'さらに前へ' })).not.toBeInTheDocument()
  expect(screen.getByText('a.ts の 2〜2行目')).toBeInTheDocument()
})

it('follows other lines when the range is changed', async () => {
  const onRestart = vi.fn()
  render(<ThemeProvider theme={createAppTheme('light')}><LineHistoryView iid="5" onClose={vi.fn()} onRestart={onRestart} projectId="7" sessionId="s1" start={{ path: 'b.ts', range: { start: 2, end: 2 }, sha: sha('h') }} /></ThemeProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: '終了行' }), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'この範囲で辿り直す' }))
  expect(onRestart).toHaveBeenCalledWith({ path: 'b.ts', range: { start: 2, end: 9 }, sha: sha('h') })
  expect(await screen.findAllByText('Rewrite two')).not.toHaveLength(0)
})
