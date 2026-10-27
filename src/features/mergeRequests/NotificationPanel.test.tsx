import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createTheme } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { GitLabSession, GitLabTodo } from '../../types/gitlab'
import { NotificationNavItem } from './NotificationPanel'

const { gitlabQueryMock, mutationKeys, queryMock, runDetailedMock } = vi.hoisted(() => ({ gitlabQueryMock: vi.fn(), mutationKeys: [] as string[], queryMock: vi.fn(), runDetailedMock: vi.fn() }))

vi.mock('../connections/connectionContext', () => ({ useConnection: () => ({ session: sessionFixture }) }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))
vi.mock('../../lib/gitlab', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/gitlab')>(), queryGitLab: gitlabQueryMock }))
vi.mock('../shared/useGitLabMutation', () => ({
  runGitLabMutation: (_sessionId: string, resourceKey: string, action: unknown) => {
    mutationKeys.push(resourceKey)
    return runDetailedMock(action)
  },
  useGitLabMutation: () => ({ isLocked: false, isPending: false }),
}))

const sessionFixture: GitLabSession = { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: null, user: { id: '42', name: 'Reviewer', username: 'reviewer' } }

function todo(overrides: Partial<GitLabTodo>): GitLabTodo {
  return { actionName: 'mentioned', author: { id: '9', name: '作者', username: 'author' }, body: '', createdAt: '2026-10-09T00:00:00.000Z', id: '1', iid: '3', projectId: '77', projectName: 'Desktop', title: 'Review me', webUrl: '', ...overrides }
}

function result(data: GitLabTodo[], overrides: object = {}) {
  return { data, error: null, loading: false, previous: false, refresh: vi.fn(), refreshing: false, snapshot: { completeness: 'complete', data, fetchedAt: 1, nextPage: null, source: 'network' }, stale: false, ...overrides }
}

function renderWithClient(node: ReactNode, client = new QueryClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) }
}

afterEach(() => { vi.unstubAllGlobals() })

beforeEach(() => {
  queryMock.mockReset()
  gitlabQueryMock.mockReset()
  runDetailedMock.mockReset()
  mutationKeys.length = 0
})

it('counts only event notifications in the bell and opens them as a stack', () => {
  queryMock.mockReturnValue(result([
    todo({ body: '@reviewer ここを見てください' }),
    todo({ actionName: 'build_failed', id: '2', iid: '4', title: 'Broken' }),
    todo({ actionName: 'assigned', id: '3', iid: '5', title: 'Assigned' }),
    todo({ actionName: 'review_requested', id: '4', iid: '6', title: 'Requested' }),
  ]))
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={vi.fn()} />)

  // The count is inside the bell; the button's name says it.
  const button = screen.getByRole('button', { name: '通知 2件' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')

  const stack = within(screen.getByRole('dialog', { name: '通知' })).getByRole('list', { name: '通知' })
  const cards = within(stack).getAllByRole('listitem')
  expect(cards.map((card) => within(card).getAllByRole('button')[0].textContent)).toEqual([
    expect.stringContaining('Review me'),
    expect.stringContaining('Broken'),
  ])
  // A mention quotes its comment; a blocking event stands out by colour as well as shape.
  expect(within(cards[0]).getByText('作者: @reviewer ここを見てください')).toBeInTheDocument()
  expect(within(cards[1]).getByRole('img', { name: 'CI失敗' })).toHaveStyle({ color: createTheme().palette.error.main })
  expect(screen.queryByText('Assigned')).not.toBeInTheDocument()
  expect(screen.queryByText('Requested')).not.toBeInTheDocument()
})

it('says when more notifications exist than the first page holds', () => {
  queryMock.mockReturnValue(result([todo({})], { snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: 2, source: 'network' } }))
  renderWithClient(<NotificationNavItem collapsed navigationWidth={52} onOpen={vi.fn()} />)

  expect(screen.getByRole('button', { name: '通知 1件以上' })).toBeInTheDocument()
})

it('opens the MR of a notification, marks it read against that MR, and closes the stack', async () => {
  const todos = [todo({}), todo({ id: '2', iid: '4', title: 'Other' })]
  const snapshot = { completeness: 'complete', data: todos, fetchedAt: 1, nextPage: null, source: 'network' }
  queryMock.mockReturnValue(result(todos, { snapshot }))
  runDetailedMock.mockResolvedValue({ error: null, ok: true, status: 'success' })
  const client = new QueryClient()
  const key = ['gitlab', 'session-1', JSON.stringify({ kind: 'todos', page: 1 })]
  client.setQueryData(key, { error: null, snapshot })
  const onOpen = vi.fn()
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={onOpen} />, client)

  fireEvent.click(screen.getByRole('button', { name: '通知 2件' }))
  // There is no separate read button: opening reads it.
  expect(screen.queryByRole('button', { name: /既読にする$/u })).not.toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('list', { name: '通知' })).getAllByRole('button')[0])

  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ iid: '3', projectId: '77' }))
  expect(runDetailedMock).toHaveBeenCalledWith({ iid: '3', kind: 'markTodoDone', projectId: '77', todoId: '1' })
  // The write is recorded against the notification's MR, like the MR view's own writes.
  expect(mutationKeys).toEqual([JSON.stringify({ iid: '3', projectId: '77' })])
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '通知' })).not.toBeInTheDocument())
  await waitFor(() => expect((client.getQueryData(key) as { snapshot: { data: GitLabTodo[] } }).snapshot.data.map((item) => item.id)).toEqual(['2']))
})

it('reads every page of notifications, at most four at a time, leaving out what is not a notification', async () => {
  queryMock.mockReturnValue(result([todo({})], { snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: 2, source: 'network' } }))
  const pages: Record<number, GitLabTodo[]> = {
    1: [todo({}), todo({ actionName: 'assigned', id: '2', iid: '4' }), todo({ actionName: 'build_failed', id: '3', iid: '5' })],
    2: [4, 5, 6, 7].map((id) => todo({ id: String(id), iid: String(id + 10) })),
  }
  gitlabQueryMock.mockImplementation(async ({ query }: { query: { page: number } }) => ({ completeness: 'complete', data: pages[query.page], fetchedAt: 1, nextPage: query.page === 1 ? 2 : null, source: 'network' }))
  const finish: Array<() => void> = []
  runDetailedMock.mockImplementation(() => new Promise((resolve) => { finish.push(() => resolve({ error: null, ok: true, status: 'success' })) }))
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '通知 1件以上' }))
  fireEvent.click(screen.getByRole('button', { name: 'すべて既読' }))

  expect(await screen.findByRole('button', { name: '既読にしています… 0/6' })).toBeDisabled()
  expect(gitlabQueryMock.mock.calls.map(([input]) => (input as { mode: string; query: { page: number } }).query.page)).toEqual([1, 2])
  expect(gitlabQueryMock.mock.calls.every(([input]) => (input as { mode: string }).mode === 'network')).toBe(true)
  expect(runDetailedMock).toHaveBeenCalledTimes(4)
  while (finish.length) finish.shift()!()
  await waitFor(() => expect(runDetailedMock).toHaveBeenCalledTimes(6))
  while (finish.length) finish.shift()!()
  await waitFor(() => expect(screen.getByRole('button', { name: 'すべて既読' })).toBeEnabled())
  expect(runDetailedMock.mock.calls.map(([action]) => (action as { todoId: string }).todoId).sort()).toEqual(['1', '3', '4', '5', '6', '7'])
})

it('loads the next page as the stack is scrolled to its end, showing a notification once when pages shift', async () => {
  const pages: Record<number, { data: GitLabTodo[]; nextPage: number | null }> = {
    1: { data: [todo({})], nextPage: 2 },
    // The first one again (pages moved after a read elsewhere) and a new one.
    2: { data: [todo({}), todo({ actionName: 'build_failed', id: '2', iid: '4', title: 'Second page' })], nextPage: null },
  }
  // One object per page, as the cached hook gives the same result until the page changes.
  const results = Object.fromEntries(Object.entries(pages).map(([page, { data, nextPage }]) => [page, result(data, { snapshot: { completeness: 'complete', data, fetchedAt: 1, nextPage, source: 'network' } })]))
  queryMock.mockImplementation((_sessionId: string, query: { page: number } | null) => results[query?.page ?? 1])
  // The end of the stack comes into view as soon as it is watched.
  const observed: Element[] = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) { observed.push(target); this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
    disconnect() {}
  })
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '通知 1件以上' }))

  expect(await screen.findByText('Second page')).toBeInTheDocument()
  expect(queryMock.mock.calls.some(([, query]) => (query as { page: number } | null)?.page === 2)).toBe(true)
  expect(within(screen.getByRole('list', { name: '通知' })).getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('すべて表示しました')).toBeInTheDocument()
  expect(observed.length).toBeGreaterThan(0)
})

it('offers the next page from a button where scrolling cannot be watched', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const first = result([todo({})], { snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: 2, source: 'network' } })
  const second = result([todo({ id: '2', iid: '4', title: 'Second page' })])
  queryMock.mockImplementation((_sessionId: string, query: { page: number } | null) => query?.page === 2 ? second : first)
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '通知 1件以上' }))
  expect(screen.queryByText('Second page')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
  expect(await screen.findByText('Second page')).toBeInTheDocument()
})

it('stacks the notifications of one MR into one card that reads them all', async () => {
  const todos = [todo({ body: '最新のコメント', id: '9' }), todo({ actionName: 'build_failed', id: '2', iid: '4', title: 'Other' }), todo({ actionName: 'directly_addressed', id: '1' })]
  queryMock.mockReturnValue(result(todos))
  runDetailedMock.mockResolvedValue({ error: null, ok: true, status: 'success' })
  const onOpen = vi.fn()
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={onOpen} />)

  fireEvent.click(screen.getByRole('button', { name: '通知 3件' }))
  const cards = within(screen.getByRole('list', { name: '通知' })).getAllByRole('listitem')
  expect(cards).toHaveLength(2)
  // The newest says what happened; the others are counted.
  expect(within(cards[0]).getByText('作者: 最新のコメント')).toBeInTheDocument()
  expect(within(cards[0]).getByText('ほか1件')).toBeInTheDocument()
  expect(within(cards[1]).queryByText(/^ほか/u)).not.toBeInTheDocument()

  fireEvent.click(within(cards[0]).getByRole('button'))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '9', iid: '3' }))
  await waitFor(() => expect(runDetailedMock.mock.calls.map(([action]) => (action as { todoId: string }).todoId)).toEqual(['9', '1']))
})

it('offers a retry when saved notifications could not be refreshed', () => {
  const refresh = vi.fn()
  queryMock.mockReturnValue(result([todo({})], { error: { code: 'NETWORK', message: '接続できません' }, refresh, snapshot: { completeness: 'complete', data: [], fetchedAt: 1, nextPage: null, source: 'cache' }, stale: true }))
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '通知 1件' }))
  expect(screen.getByText('保存済みの通知を表示中です。更新に失敗しました: 接続できません')).toBeInTheDocument()
  expect(screen.getByText(/1件 · 保存済み · /u)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  expect(refresh).toHaveBeenCalled()
})

it('shows an empty stack truthfully', () => {
  queryMock.mockReturnValue(result([todo({ actionName: 'assigned' })]))
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '通知' }))
  expect(screen.getByText('通知はありません')).toBeInTheDocument()
})

it('shows read notifications on request and opens them without another read', () => {
  const read = todo({ id: '8', iid: '9', title: 'Already read' })
  queryMock.mockImplementation((_sessionId: string, query: { done?: true } | null) => result(query?.done ? [read] : []))
  const onOpen = vi.fn()
  renderWithClient(<NotificationNavItem collapsed={false} navigationWidth={52} onOpen={onOpen} />)
  fireEvent.click(screen.getByRole('button', { name: '通知' }))
  expect(screen.getByText('通知はありません')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '既読' }))
  expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'todos', page: 1, done: true })
  expect(screen.queryByRole('button', { name: 'すべて既読' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Already read'))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '8', iid: '9' }))
  expect(runDetailedMock).not.toHaveBeenCalled()
})
