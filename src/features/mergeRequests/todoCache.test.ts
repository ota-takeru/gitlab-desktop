import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import type { GitLabTodo } from '../../types/gitlab'
import { forgetDoneTodos } from './todoCache'

const todo = { id: '1' } as GitLabTodo
const loaded = (data: GitLabTodo[]) => ({ error: null, snapshot: { completeness: 'complete', data, fetchedAt: 1, nextPage: null, source: 'network' } })

it('drops a read notification from the unread pages but keeps it among the read', () => {
  const client = new QueryClient()
  const unreadKey = ['gitlab', 'session-1', JSON.stringify({ kind: 'todos', page: 1 })]
  const readKey = ['gitlab', 'session-1', JSON.stringify({ kind: 'todos', page: 1, done: true })]
  client.setQueryData(unreadKey, loaded([todo]))
  client.setQueryData(readKey, loaded([todo]))

  forgetDoneTodos(client, 'session-1', ['1'])

  expect(client.getQueryData<ReturnType<typeof loaded>>(unreadKey)?.snapshot.data).toEqual([])
  expect(client.getQueryData<ReturnType<typeof loaded>>(readKey)?.snapshot.data).toEqual([todo])
})
