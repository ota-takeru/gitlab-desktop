import { useEffect, useMemo } from 'react'

import { useScreenReadiness } from '../../components/screenReadinessContext'
import type { ReviewResourceQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import type { PageStore } from './discussionPageStore'

type DiscussionsQuery = ReviewResourceQuery & { kind: 'discussions' }

/**
 * Keeps one discussions page live and publishes its state to the window's store; `refreshIntervalMs` as for useGitLabQuery.
 * The threads render a commit after this has the page, so a screen waiting to show keeps waiting until `shown`.
 */
export function DiscussionPageObserver({ iid, page, projectId, refreshIntervalMs, sessionId, shown, store }: { iid: string; page: number; projectId: string; refreshIntervalMs?: number; sessionId: string | null; shown: boolean; store: PageStore }) {
  const query = useMemo<DiscussionsQuery>(() => ({ iid, kind: 'discussions', page, projectId }), [iid, page, projectId])
  const result = useGitLabQuery<DiscussionsQuery>(sessionId, query, { refreshIntervalMs })
  useEffect(() => {
    store.set(page, { checkingSavedData: result.checkingSavedData, data: result.data, error: result.error, loading: result.loading, refresh: result.refresh, refreshing: result.refreshing, snapshot: result.snapshot })
  })
  const holdScreen = useScreenReadiness()
  const waitingToShow = Boolean(result.data) && !shown
  useEffect(() => {
    if (waitingToShow && holdScreen) return holdScreen()
  }, [holdScreen, waitingToShow])
  return null
}
