import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { GitLabSnapshot, GitLabTodo } from '../../types/gitlab'

interface LoadedTodos {
  snapshot: GitLabSnapshot<GitLabTodo[]> | null
  error: unknown
}

function isTodosKey(key: readonly unknown[], sessionId: string): boolean {
  return key[0] === 'gitlab' && key[1] === sessionId && typeof key[2] === 'string' && key[2].includes('"kind":"todos"')
}

/**
 * The pending To-Dos of one merge request among the To-Do pages already
 * loaded (the To-Do list, the notification monitor). It never asks GitLab.
 */
export function useLoadedMergeRequestTodos(sessionId: string | null, projectId: string, iid: string): GitLabTodo[] {
  const cache = useQueryClient().getQueryCache()
  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache])
  const getSnapshot = useCallback(() => {
    if (!sessionId) return '[]'
    const found = new Map<string, GitLabTodo>()
    for (const query of cache.findAll({ queryKey: ['gitlab', sessionId] })) {
      if (!isTodosKey(query.queryKey, sessionId)) continue
      for (const todo of (query.state.data as LoadedTodos | undefined)?.snapshot?.data ?? []) {
        if (todo.projectId === projectId && todo.iid === iid) found.set(todo.id, todo)
      }
    }
    return JSON.stringify([...found.values()])
  }, [cache, iid, projectId, sessionId])
  const serialized = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => JSON.parse(serialized) as GitLabTodo[], [serialized])
}

/**
 * Drops a To-Do marked done from every loaded To-Do page, then lets them
 * reload. The notification monitor keeps the IDs it has seen, so a done
 * To-Do never comes back as new.
 */
export function forgetDoneTodo(queryClient: QueryClient, sessionId: string, todoId: string): void {
  const predicate = (query: { queryKey: readonly unknown[] }) => isTodosKey(query.queryKey, sessionId)
  queryClient.setQueriesData<LoadedTodos>({ predicate }, (current) => current?.snapshot
    ? { ...current, snapshot: { ...current.snapshot, data: current.snapshot.data.filter((todo) => todo.id !== todoId) } }
    : current)
  void queryClient.invalidateQueries({ predicate })
}
