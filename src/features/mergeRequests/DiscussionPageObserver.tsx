import { useEffect, useMemo } from 'react'

import type { ReviewResourceQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import type { PageStore } from './discussionPageStore'

type DiscussionsQuery = ReviewResourceQuery & { kind: 'discussions' }

/** Keeps one discussions page live and publishes its state to the window's store; `refreshIntervalMs` as for useGitLabQuery. */
export function DiscussionPageObserver({ iid, page, projectId, refreshIntervalMs, sessionId, store }: { iid: string; page: number; projectId: string; refreshIntervalMs?: number; sessionId: string | null; store: PageStore }) {
  const query = useMemo<DiscussionsQuery>(() => ({ iid, kind: 'discussions', page, projectId }), [iid, page, projectId])
  const result = useGitLabQuery<DiscussionsQuery>(sessionId, query, { refreshIntervalMs })
  useEffect(() => {
    store.set(page, { data: result.data, error: result.error, loading: result.loading, refresh: result.refresh, refreshing: result.refreshing, snapshot: result.snapshot })
  })
  return null
}
