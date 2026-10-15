import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTheme } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabSession, GitLabTodo } from '../../types/gitlab'
import { TodoView } from './TodoView'

const { mutationKeys, queryMock, runDetailedMock } = vi.hoisted(() => ({ mutationKeys: [] as string[], queryMock: vi.fn(), runDetailedMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({ useConnection: () => ({ session: sessionFixture }) }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../shared/useGitLabMutation', () => ({
  useGitLabMutation: (_sessionId: string, resourceKey: string) => {
    mutationKeys.push(resourceKey)
    return { isLocked: false, isPending: false, runDetailed: runDetailedMock }
  },
}))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: null, user: { id: '42', name: 'Reviewer', username: 'reviewer' } }

function todo(overrides: Partial<GitLabTodo>): GitLabTodo {
  return { actionName: 'review_requested', author: { id: '9', name: '作者', username: 'author' }, body: '', createdAt: '2026-10-09T00:00:00.000Z', id: '1', iid: '3', projectId: '77', projectName: 'Desktop', title: 'Review me', webUrl: '', ...overrides }
}

function renderWithClient(node: ReactNode, client = new QueryClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) }
}

beforeEach(() => {
  queryMock.mockReset()
  runDetailedMock.mockReset()
  mutationKeys.length = 0
})

it('marks blocking To-Dos apart from requests, names the time it arrived, and moves between rows by keyboard', () => {
  queryMock.mockReturnValue({ data: [todo({}), todo({ actionName: 'build_failed', id: '2', iid: '4', title: 'Broken' })], error: null, loading: false, refresh: vi.fn(), refreshing: false, snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: null, source: 'network' }, stale: false })
  renderWithClient(<TodoView onOpen={vi.fn()} />)

  expect(screen.getByText('2件取得')).toBeInTheDocument()
  const { palette } = createTheme()
  expect(screen.getByRole('img', { name: 'CI失敗' })).toHaveStyle({ color: palette.error.main })
  expect(screen.getByRole('img', { name: 'レビュー依頼' })).toHaveStyle({ color: palette.info.main })
  expect(screen.getAllByText(/^受信 /u)).toHaveLength(2)

  const rows = screen.getByRole('list', { name: 'To-Do' }).querySelectorAll<HTMLElement>('[data-list-row="true"]')
  expect([...rows].map((row) => row.dataset.mrId)).toEqual(['77-3', '77-4'])
  rows[0].focus()
  fireEvent.keyDown(rows[0], { key: 'End' })
  expect(document.activeElement).toBe(rows[1])
})

it('offers a retry when saved To-Dos could not be refreshed', () => {
  const refresh = vi.fn()
  queryMock.mockReturnValue({ data: [todo({})], error: { code: 'NETWORK', message: '接続できません' }, loading: false, refresh, refreshing: false, snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: null, source: 'cache' }, stale: true })
  renderWithClient(<TodoView onOpen={vi.fn()} />)

  expect(screen.getByText('保存済みのTo-Doを表示中です。更新に失敗しました: 接続できません')).toBeInTheDocument()
  expect(screen.getByText(/1件取得 · 保存済み · /u)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  expect(refresh).toHaveBeenCalled()
})

it('marks a To-Do done against its MR without opening it, and drops it from the loaded pages', async () => {
  const todos = [todo({}), todo({ id: '2', iid: '4', title: 'Other' })]
  const snapshot = { completeness: 'complete', data: todos, fetchedAt: 1, nextPage: null, source: 'network' }
  queryMock.mockReturnValue({ data: todos, error: null, loading: false, refresh: vi.fn(), refreshing: false, snapshot, stale: false })
  runDetailedMock.mockResolvedValue({ error: null, ok: true, status: 'success' })
  const client = new QueryClient()
  const key = ['gitlab', 'session-1', JSON.stringify({ kind: 'todos', page: 1 })]
  client.setQueryData(key, { error: null, snapshot })
  const onOpen = vi.fn()
  renderWithClient(<TodoView onOpen={onOpen} />, client)

  fireEvent.click(screen.getByRole('button', { name: '「Review me」のTo-Doを完了' }))

  await waitFor(() => expect(runDetailedMock).toHaveBeenCalledWith({ iid: '3', kind: 'markTodoDone', projectId: '77', todoId: '1' }))
  // The write is recorded against the To-Do's MR, like the MR view's own writes.
  expect(mutationKeys).toContain(JSON.stringify({ iid: '3', projectId: '77' }))
  expect(onOpen).not.toHaveBeenCalled()
  await waitFor(() => expect((client.getQueryData(key) as { snapshot: { data: GitLabTodo[] } }).snapshot.data.map((item) => item.id)).toEqual(['2']))
})
