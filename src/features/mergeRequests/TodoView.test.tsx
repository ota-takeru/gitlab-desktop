import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { GitLabSession, GitLabTodo } from '../../types/gitlab'
import { TodoView } from './TodoView'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({ useConnection: () => ({ session: sessionFixture }) }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: null, user: { id: '42', name: 'Reviewer', username: 'reviewer' } }

function todo(overrides: Partial<GitLabTodo>): GitLabTodo {
  return { actionName: 'review_requested', author: { id: '9', name: '作者', username: 'author' }, body: '', createdAt: '2026-10-09T00:00:00.000Z', id: '1', iid: '3', projectId: '77', projectName: 'Desktop', title: 'Review me', webUrl: '', ...overrides }
}

beforeEach(() => {
  queryMock.mockReset()
})

it('marks blocking To-Dos apart from requests, names the time it arrived, and moves between rows by keyboard', () => {
  queryMock.mockReturnValue({ data: [todo({}), todo({ actionName: 'build_failed', id: '2', iid: '4', title: 'Broken' })], error: null, loading: false, refresh: vi.fn(), refreshing: false, snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: null, source: 'network' }, stale: false })
  render(<TodoView onOpen={vi.fn()} />)

  expect(screen.getByText('2件取得')).toBeInTheDocument()
  expect(screen.getByLabelText('CI失敗')).toHaveClass('MuiChip-colorError')
  expect(screen.getByLabelText('レビュー依頼')).toHaveClass('MuiChip-colorInfo')
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
  render(<TodoView onOpen={vi.fn()} />)

  expect(screen.getByText('保存済みのTo-Doを表示中です。更新に失敗しました: 接続できません')).toBeInTheDocument()
  expect(screen.getByText(/1件取得 · 保存済み · /u)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  expect(refresh).toHaveBeenCalled()
})
