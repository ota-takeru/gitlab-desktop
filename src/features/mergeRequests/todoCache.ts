import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { GitLabSnapshot, GitLabTodo } from '../../types/gitlab'

interface LoadedTodos {
  snapshot: GitLabSnapshot<GitLabTodo[]> | null
  error: unknown
}

/**
 * GitLab's To-Dos about one event (a mention, a failed pipeline...) are the notifications.
 * Being assigned or asked to review is a standing state that the MR list's tabs already show,
 * and that To-Do stays until the MR closes, so it is left out.
 */
export function isNotificationTodo(todo: GitLabTodo): boolean {
  return todo.actionName !== 'assigned' && todo.actionName !== 'review_requested'
}

function isTodosKey(key: readonly unknown[], sessionId: string): boolean {
  return key[0] === 'gitlab' && key[1] === sessionId && typeof key[2] === 'string' && key[2].includes('"kind":"todos"')
}

/** The pages of read notifications, which keep what was read. */
function isDoneTodosKey(key: readonly unknown[]): boolean {
  return typeof key[2] === 'string' && key[2].includes('"done":true')
}

/**
 * The pending notifications of one merge request among the To-Do pages already
 * loaded (the notification panel and its count). It never asks GitLab.
 */
export function useLoadedMergeRequestNotifications(sessionId: string | null, projectId: string, iid: string): GitLabTodo[] {
  const cache = useQueryClient().getQueryCache()
  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache])
  const getSnapshot = useCallback(() => {
    if (!sessionId) return '[]'
    const found = new Map<string, GitLabTodo>()
    for (const query of cache.findAll({ queryKey: ['gitlab', sessionId] })) {
      if (!isTodosKey(query.queryKey, sessionId) || isDoneTodosKey(query.queryKey)) continue
      for (const todo of (query.state.data as LoadedTodos | undefined)?.snapshot?.data ?? []) {
        if (todo.projectId === projectId && todo.iid === iid && isNotificationTodo(todo)) found.set(todo.id, todo)
      }
    }
    return JSON.stringify([...found.values()])
  }, [cache, iid, projectId, sessionId])
  const serialized = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => JSON.parse(serialized) as GitLabTodo[], [serialized])
}

/**
 * Drops To-Dos marked done from every loaded page of unread notifications, then
 * lets every To-Do page reload once, so the read ones appear among the read. The notification monitor keeps the IDs it has seen, so a done
 * To-Do never comes back as new.
 */
export function forgetDoneTodos(queryClient: QueryClient, sessionId: string, todoIds: string[]): void {
  if (!todoIds.length) return
  const done = new Set(todoIds)
  const predicate = (query: { queryKey: readonly unknown[] }) => isTodosKey(query.queryKey, sessionId)
  queryClient.setQueriesData<LoadedTodos>({ predicate: (query) => predicate(query) && !isDoneTodosKey(query.queryKey) }, (current) => current?.snapshot
    ? { ...current, snapshot: { ...current.snapshot, data: current.snapshot.data.filter((todo) => !done.has(todo.id)) } }
    : current)
  void queryClient.invalidateQueries({ predicate })
}
