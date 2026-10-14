import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Diff, DiffsQuery, Discussion, GitLabSnapshot, Position } from '../../types/gitlab'
import { diffExcerpt } from './diffExcerpt'
import { useDiscussionCode } from './useDiscussionCode'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

const head = 'h'.repeat(40)
const diff: Diff = {
  collapsed: false,
  deletedFile: false,
  diff: ['@@ -1,4 +1,5 @@', ' one', ' two', '-three', '+THREE', '+inserted', ' four', '@@ -20,2 +21,2 @@', ' twenty', '-old', '+new'].join('\n'),
  newFile: false,
  newPath: 'src/a.ts',
  oldPath: 'src/a.ts',
  renamedFile: false,
  tooLarge: false,
}

function position(overrides: Partial<Position>): Position {
  return { baseSha: 'b'.repeat(40), headSha: head, newPath: 'src/a.ts', oldPath: 'src/a.ts', positionType: 'text', startSha: 'b'.repeat(40), ...overrides }
}

function result(data: unknown) {
  return { data, error: null, loading: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false }
}

beforeEach(() => queryMock.mockReset().mockReturnValue(result(null)))

it('takes the commented line and its neighbours from the same hunk only', () => {
  const added = diffExcerpt(diff, position({ newLine: 4 }))!
  expect(added.lines.map((line) => line.text)).toEqual(['one', 'two', 'three', 'THREE', 'inserted', 'four'])
  expect(added.lines[added.target].text).toBe('inserted')

  const removed = diffExcerpt(diff, position({ oldLine: 3 }))!
  expect(removed.lines[removed.target]).toMatchObject({ kind: 'remove', text: 'three' })

  // The second hunk does not borrow lines from the first.
  const later = diffExcerpt(diff, position({ newLine: 22 }))!
  expect(later.lines.map((line) => line.text)).toEqual(['twenty', 'old', 'new'])
  expect(diffExcerpt(diff, position({ newLine: 99 }))).toBeNull()
})

function Harness({ discussions, headSha }: { discussions: Discussion[]; headSha: string }) {
  const render = useDiscussionCode({ discussions, enabled: true, headSha, iid: '3', projectId: '7', sessionId: 's1' })
  return <>{discussions.map((discussion) => <div key={discussion.id}>{render?.(discussion.notes[0].position!)}</div>)}</>
}

function discussionAt(where: Position): Discussion {
  return { id: 'd1', individualNote: false, notes: [{ author: { id: '1', name: 'A', username: 'a' }, body: 'Why?', createdAt: '2026-10-09T00:00:00Z', id: 'n1', position: where, resolvable: true, resolved: false, system: false }] }
}

function renderWith(client: QueryClient, discussions: Discussion[], headSha = head) {
  return render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}><Harness discussions={discussions} headSha={headSha} /></ThemeProvider></QueryClientProvider>)
}

it('shows a current comment in the diff already read for the changes tab', () => {
  const client = new QueryClient()
  const page: DiffsQuery = { headSha: head, iid: '3', kind: 'diffs', page: 1, projectId: '7' }
  const snapshot: GitLabSnapshot<Diff[]> = { completeness: 'complete', data: [diff], fetchedAt: 1, nextPage: null, source: 'network' }
  client.setQueryData(['gitlab', 's1', JSON.stringify(page)], { error: null, snapshot })
  renderWith(client, [discussionAt(position({ newLine: 4 }))])

  expect(screen.getByRole('group', { name: 'コメント対象の差分' })).toHaveTextContent('inserted')
  // Every commented file is found, so no further diff page is requested.
  expect(queryMock).toHaveBeenCalledWith('s1', null)
})

it('reads the first diff page when the commented file is not loaded yet', () => {
  renderWith(new QueryClient(), [discussionAt(position({ newLine: 4 }))])

  expect(queryMock).toHaveBeenCalledWith('s1', { headSha: head, iid: '3', kind: 'diffs', page: 1, projectId: '7' })
  expect(screen.getByRole('status')).toHaveTextContent('コードを読み込み中…')
})

it('shows an outdated comment in the file as it was at the commented commit', () => {
  const oldHead = 'o'.repeat(40)
  queryMock.mockImplementation((_session: string, query: { kind?: string } | null) => query?.kind === 'file' ? result({ content: 'a\nb\nc\nd\ne\nf\ng\nh\n' }) : result(null))
  renderWith(new QueryClient(), [discussionAt(position({ headSha: oldHead, newLine: 6 }))])

  expect(queryMock).toHaveBeenCalledWith('s1', { kind: 'file', path: 'src/a.ts', projectId: '7', sha: oldHead })
  expect(queryMock).not.toHaveBeenCalledWith('s1', expect.objectContaining({ kind: 'diffs' }))
  const code = screen.getByRole('group', { name: 'コメント対象のコード' })
  // Four lines before and two after the commented line 6, with line numbers.
  expect(code).toHaveTextContent('2b3c4d5e6f7g8h')
  expect(code.querySelector('[data-target="true"]')).toHaveTextContent('6f')
  expect(screen.getByText(/コメント時点のコード（oooooooo）/u)).toBeInTheDocument()
})

it('shows nothing for a comment on a whole file', () => {
  const { container } = renderWith(new QueryClient(), [discussionAt(position({ positionType: 'file' }))])
  expect(container.firstElementChild).toBeEmptyDOMElement()
})

it('follows diff pages added later without updating itself while another component renders', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const client = new QueryClient()
    const discussions = [discussionAt(position({ newLine: 4 }))]
    // A component that adds a diff page query while rendering, as the changes tab does.
    function AddsQuery({ name }: { name: string }) {
      const query: DiffsQuery = { headSha: head, iid: '3', kind: 'diffs', page: Number(name), projectId: '7' }
      useQuery({ queryFn: () => new Promise<never>(() => undefined), queryKey: ['gitlab', 's1', JSON.stringify(query)] })
      return null
    }
    const tree = (extra: string[]) => <QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}><Harness discussions={discussions} headSha={head} /><Harness discussions={discussions} headSha={head} />{extra.map((name) => <AddsQuery key={name} name={name} />)}</ThemeProvider></QueryClientProvider>
    const view = render(tree([]))
    view.rerender(tree(['2', '3']))
    await act(async () => { await Promise.resolve() })
    expect(errors.mock.calls.filter(([message]) => String(message).includes('Cannot update a component'))).toEqual([])

    // A diff page read later still reaches both consumers.
    const page: DiffsQuery = { headSha: head, iid: '3', kind: 'diffs', page: 1, projectId: '7' }
    const snapshot: GitLabSnapshot<Diff[]> = { completeness: 'complete', data: [diff], fetchedAt: 1, nextPage: null, source: 'network' }
    await act(async () => { client.setQueryData(['gitlab', 's1', JSON.stringify(page)], { error: null, snapshot }) })
    expect(screen.getAllByRole('group', { name: 'コメント対象の差分' })).toHaveLength(2)
  } finally {
    errors.mockRestore()
  }
})
