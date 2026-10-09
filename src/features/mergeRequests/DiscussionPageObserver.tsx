import { useEffect, useMemo } from 'react'

import type { ReviewResourceQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import type { PageStore } from './discussionPageStore'

type DiscussionsQuery = ReviewResourceQuery & { kind: 'discussions' }

/** Keeps one discussions page live and publishes its state to the window's store. */
export function DiscussionPageObserver({ iid, page, projectId, sessionId, store }: { iid: string; page: number; projectId: string; sessionId: string | null; store: PageStore }) {
  const query = useMemo<DiscussionsQuery>(() => ({ iid, kind: 'discussions', page, projectId }), [iid, page, projectId])
  const result = useGitLabQuery<DiscussionsQuery>(sessionId, query)
  useEffect(() => {
    store.set(page, { data: result.data, error: result.error, loading: result.loading, refresh: result.refresh, refreshing: result.refreshing, snapshot: result.snapshot })
  })
  return null
}
