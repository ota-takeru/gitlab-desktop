import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import type { Discussion, GitLabCommandError, GitLabSnapshot } from '../../types/gitlab'
import { QueryRefreshPolicy, useQueryRefreshAllowed } from '../shared/QueryRefreshPolicy'
import { DiscussionPageObserver } from './DiscussionPageObserver'
import { PageStore } from './discussionPageStore'

/** GitLab returns discussions oldest first, 30 per page; at most this many pages stay loaded. */
export const MAX_DISCUSSION_PAGES = 10
/** When the newest page is this short, the previous page is loaded too so the first view has context. */
const MIN_INITIAL_DISCUSSIONS = 10

export interface DiscussionWindow {
  /** Loaded discussions in GitLab order (oldest first) within the loaded page range. */
  discussions: Discussion[]
  /** True until the newest page (and its context page) are available for the first view. */
  loading: boolean
  ready: boolean
  error: GitLabCommandError | null
  /** Snapshot of the newest page; used for freshness and notifications. */
  latest: GitLabSnapshot<Discussion[]> | null
  latestPage: number
  loadedPages: number[]
  hasOlder: boolean
  loadingOlder: boolean
  olderError: GitLabCommandError | null
  /** Older discussions exist but are beyond the loaded-page limit. */
  limitReached: boolean
  loadOlder: () => void
  /** Retries the older page that failed to load. */
  retryOlder: () => void
  refreshLatest: () => void
  /** Refreshes the page holding the discussion (and the newest page for new threads). */
  refreshDiscussion: (discussionId: string | null) => void
  /** Renders the page observers; keep it mounted while discussions should stay live. */
  observers: React.ReactNode
}

/**
 * Loads discussions newest-first while presenting them oldest-first.
 *
 * GitLab's discussions API has no sort parameter, so the newest discussions
 * are on the last page. Page 1 reveals the page count; the window then
 * covers the last page (plus the previous one when the last page is short)
 * and grows towards older pages on request.
 */
export function useDiscussionWindow(sessionId: string | null, projectId: string, iid: string, active: boolean): DiscussionWindow {
  const [store] = useState(() => new PageStore())
  const refreshAllowed = useQueryRefreshAllowed()
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
  const [fixedLow, setFixedLow] = useState<number | null>(null)

  const state = useMemo(() => {
    void version
    const pages = store.entries()
    // The most recently fetched page that reports a total defines the range.
    const reporting = pages.filter(([, page]) => page.snapshot?.totalPages).sort(([, left], [, right]) => (right.snapshot?.fetchedAt ?? 0) - (left.snapshot?.fetchedAt ?? 0))[0]
    let total: number | null = reporting ? Math.max(1, reporting[1].snapshot!.totalPages!) : null
    let probeTo = 1
    if (total === null) {
      // Without X-Total-Pages (old cache entries, very large collections),
      // walk forward page by page as before.
      while (probeTo < MAX_DISCUSSION_PAGES && store.get(probeTo)?.snapshot?.nextPage) probeTo += 1
      const last = store.get(probeTo)
      if (last?.snapshot && (!last.snapshot.nextPage || probeTo === MAX_DISCUSSION_PAGES)) total = probeTo
    }
    const walkedForward = total !== null && !reporting
    const floor = total === null ? 1 : walkedForward ? 1 : Math.max(1, total - MAX_DISCUSSION_PAGES + 1)
    let defaultLow = total ?? 1
    if (total !== null && !walkedForward && total > 1) {
      const newest = store.get(total)?.data
      if (newest && newest.length < MIN_INITIAL_DISCUSSIONS) defaultLow = total - 1
    }
    const low = total === null ? 1 : Math.max(floor, Math.min(fixedLow ?? (walkedForward ? 1 : defaultLow), total))
    const observed = total === null ? Array.from({ length: probeTo }, (_, index) => index + 1) : Array.from({ length: total - low + 1 }, (_, index) => low + index)
    const newestPage = total ?? probeTo
    const newestState = store.get(newestPage)
    const newestKnown = Boolean(total !== null && newestState?.data)
    const ready = total !== null && newestKnown && (fixedLow !== null || observed.every((page) => store.get(page)?.data))
    const merged = new Map<string, Discussion>()
    if (total !== null) {
      for (let page = low; page <= total; page += 1) {
        for (const discussion of store.get(page)?.data ?? []) merged.set(discussion.id, discussion)
      }
    }
    const lowState = store.get(low)
    return {
      defaultLow: total === null ? null : (walkedForward ? 1 : defaultLow),
      discussions: ready ? [...merged.values()] : [],
      error: newestState?.error ?? store.get(1)?.error ?? null,
      floor,
      hasOlder: total !== null && low > floor,
      latest: newestState?.snapshot ?? null,
      latestPage: newestPage,
      limitReached: total !== null && low === floor && floor > 1,
      loadingOlder: Boolean(fixedLow !== null && !lowState?.data && !lowState?.error),
      low,
      observed,
      olderError: fixedLow !== null && low < newestPage ? lowState?.error ?? null : null,
      ready,
      total,
    }
  }, [fixedLow, store, version])

  // Fix the lower bound once the first view is complete so later refreshes
  // (for example a new page appearing) never remove threads already shown.
  if (state.ready && fixedLow === null && state.defaultLow !== null) setFixedLow(state.low)

  const loadOlder = useCallback(() => {
    if (!state.hasOlder || state.loadingOlder) return
    setFixedLow((current) => Math.max(state.floor, (current ?? state.low) - 1))
  }, [state.floor, state.hasOlder, state.loadingOlder, state.low])

  const retryOlder = useCallback(() => { store.get(state.low)?.refresh() }, [state.low, store])
  const refreshLatest = useCallback(() => { store.get(state.latestPage)?.refresh() }, [state.latestPage, store])
  const refreshDiscussion = useCallback((discussionId: string | null) => {
    const holder = discussionId ? store.entries().find(([page, value]) => page >= state.low && value.data?.some((discussion) => discussion.id === discussionId)) : undefined
    if (holder && holder[0] !== state.latestPage) holder[1].refresh()
    store.get(state.latestPage)?.refresh()
  }, [state.latestPage, state.low, store])

  const observers = active
    // Only the newest page polls; older pages refresh after a write that touches them.
    ? state.observed.map((page) => <QueryRefreshPolicy key={page} value={refreshAllowed && page === state.latestPage}>
      <DiscussionPageObserver iid={iid} page={page} projectId={projectId} sessionId={sessionId} store={store} />
    </QueryRefreshPolicy>)
    : null

  return {
    discussions: state.discussions,
    error: state.error,
    hasOlder: state.hasOlder,
    latest: state.latest,
    latestPage: state.latestPage,
    limitReached: state.limitReached,
    loadOlder,
    loadedPages: state.observed,
    loading: !state.ready && !state.error,
    loadingOlder: state.loadingOlder,
    observers,
    olderError: state.olderError,
    ready: state.ready,
    refreshDiscussion,
    refreshLatest,
    retryOlder,
  }
}
