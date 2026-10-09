import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useSyncExternalStore } from 'react'
import type { Discussion, GitLabSnapshot } from '../../types/gitlab'
import { mergeDiscussionPages } from './discussionPaging'

export function useDiscussionPages(sessionId: string | null, projectId: string, iid: string, page: number, currentData: Discussion[] | null) {
  const client = useQueryClient()
  const matches = (queryKey: readonly unknown[]) => {
    if (queryKey[0] !== 'gitlab' || queryKey[1] !== sessionId || typeof queryKey[2] !== 'string') return false
    try { const query = JSON.parse(queryKey[2]); return query.kind === 'discussions' && query.projectId === projectId && query.iid === iid && query.page <= 10 } catch { return false }
  }
  const getSnapshot = () => client.getQueryCache().findAll({ predicate: (query) => matches(query.queryKey) }).map((query) => `${query.queryHash}:${query.state.dataUpdateCount}`).join('|')
  const version = useSyncExternalStore((listener) => client.getQueryCache().subscribe(listener), getSnapshot, getSnapshot)
  return useMemo(() => {
    const pages: Record<number, Discussion[]> = {}
    for (const [queryKey, result] of client.getQueriesData<{ snapshot: GitLabSnapshot<Discussion[]> | null }>({ predicate: (query) => matches(query.queryKey) })) {
      if (result?.snapshot) pages[JSON.parse(queryKey[2] as string).page] = result.snapshot.data
    }
    if (currentData) pages[page] = currentData
    return mergeDiscussionPages(pages)
  }, [client, currentData, iid, page, projectId, sessionId, version]) // eslint-disable-line react-hooks/exhaustive-deps
}
