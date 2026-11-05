import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import type { Discussion, GitLabCommandError, GitLabSnapshot } from '../../types/gitlab'
import { DiscussionPageObserver } from './DiscussionPageObserver'
import { PageStore } from './discussionPageStore'

/** GitLab returns discussions oldest first, 30 per page; at most this many pages stay loaded. */
export const MAX_DISCUSSION_PAGES = 10
/** When the newest page is this short, the previous page is loaded too so the first view has context. */
const MIN_INITIAL_DISCUSSIONS = 10
/**
 * Older loaded pages refresh this often (the newest page every minute), so replies and edits in
 * older threads appear without a write of one's own; GitLab files a reply under its thread's page.
 */
export const OLDER_PAGE_REFRESH_MS = 5 * 60_000
/** The longest a write waits for the newest page to be read again. */
const REFRESH_WAIT_MS = 5_000

export interface DiscussionWindow {
  /** Loaded discussions in GitLab order (oldest first) within the loaded page range. */
  discussions: Discussion[]
  /** True until the newest page is available for the first view; its context page follows as an older page. */
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
  /** Refreshes the newest page; resolves once its new threads arrive (or after REFRESH_WAIT_MS), so a posted comment shows before its text leaves the composer. */
  refreshLatest: () => Promise<void>
  /** Refreshes every loaded page, while the window is active; resolves as refreshLatest does. */
  refreshAll: () => Promise<void>
  /** A loaded page is being read, so a comment not found yet may still arrive. */
  reading: boolean
  /** Refreshes the page holding the discussion (and the newest page for new threads); resolves as refreshLatest does. */
  refreshDiscussion: (discussionId: string | null) => Promise<void>
  /** Renders the page observers; keep it mounted while discussions should stay live. */
  observers: React.ReactNode
}

/**
 * Finds the last page without X-Total-Pages (very large collections, old cache entries).
 *
 * The page number doubles while pages have a next page, then halves the gap up to a page past the
 * end, which GitLab answers with an empty list and no next page. `read` is the page to read next.
 * Once the first view is fixed the list stays on screen, so a last page that gains a next page
 * keeps `last` and reads the following page, whose threads then extend the list.
 */
function searchLastPage(store: PageStore, firstViewFixed: boolean): { last: number | null; read: number } {
  const known = store.entries().flatMap(([page, state]) => state.snapshot ? [{ empty: !state.data?.length, hasNext: Boolean(state.snapshot.nextPage), page }] : [])
  const before = Math.max(0, ...known.filter(({ hasNext }) => hasNext).map(({ page }) => page))
  const end = known.filter(({ hasNext, page }) => !hasNext && page > before).sort((left, right) => left.page - right.page)[0]
  if (end && !end.empty) return { last: end.page, read: end.page }
  if (firstViewFixed || end?.page === before + 1) return { last: Math.max(before, 1), read: before + 1 }
  if (!end) return { last: null, read: before ? before * 2 : 1 }
  return { last: null, read: Math.floor((before + end.page) / 2) }
}

/**
 * Loads discussions newest-first while presenting them oldest-first.
 *
 * GitLab's discussions API has no sort parameter, so the newest discussions
 * are on the last page. Page 1 reveals the page count, or the last page is
 * searched for when none is reported; the window then covers the last page
 * (plus the previous one when the last page is short) and grows towards
 * older pages on request.
 */
export function useDiscussionWindow(sessionId: string | null, projectId: string, iid: string, active: boolean): DiscussionWindow {
  const [store] = useState(() => new PageStore())
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
  const [fixedLow, setFixedLow] = useState<number | null>(null)

  const state = useMemo(() => {
    void version
    const pages = store.entries()
    // The most recently fetched page that reports a total defines the range.
    const reporting = pages.filter(([, page]) => page.snapshot?.totalPages).sort(([, left], [, right]) => (right.snapshot?.fetchedAt ?? 0) - (left.snapshot?.fetchedAt ?? 0))[0]
    const search = reporting ? null : searchLastPage(store, fixedLow !== null)
    const total = reporting ? Math.max(1, reporting[1].snapshot!.totalPages!) : search?.last ?? null
    const floor = total === null ? 1 : Math.max(1, total - MAX_DISCUSSION_PAGES + 1)
    let defaultLow = total ?? 1
    if (total !== null && total > 1) {
      const newest = store.get(total)?.data
      if (newest && newest.length < MIN_INITIAL_DISCUSSIONS) defaultLow = total - 1
    }
    const low = total === null ? 1 : Math.max(floor, Math.min(fixedLow ?? defaultLow, total))
    // The page before the newest is read beside it, not after it: it is the context page
    // when the newest is short, and the first older page otherwise. Once the first view is
    // fixed it stays observed only until its read ends.
    const context = total !== null && total > 1 && low === total && (fixedLow === null || store.get(total - 1)?.loading) ? [total - 1] : []
    const searched = search && (total === null || search.read > total) ? [search.read] : []
    const observed = total === null ? searched : [...context, ...Array.from({ length: total - low + 1 }, (_, index) => low + index), ...searched]
    const newestPage = total ?? search?.read ?? 1
    const newestState = store.get(newestPage)
    const newestKnown = Boolean(total !== null && newestState?.data)
    // The newest threads show as soon as they are read; a context page still loading (or failed)
    // shows as an older page being loaded, with its retry, instead of holding the whole list back.
    const ready = total !== null && newestKnown
    const merged = new Map<string, Discussion>()
    if (total !== null) {
      for (let page = low; page <= total; page += 1) {
        for (const discussion of store.get(page)?.data ?? []) merged.set(discussion.id, discussion)
      }
    }
    const lowState = store.get(low)
    return {
      defaultLow: total === null ? null : defaultLow,
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
      reading: observed.some((page) => store.get(page)?.loading || store.get(page)?.refreshing),
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
  const refreshPage = useCallback((page: number) => {
    const before = store.get(page)
    if (!before) return Promise.resolve()
    before.refresh()
    return new Promise<void>((resolve) => {
      const done = () => { unsubscribe(); globalThis.clearTimeout(timer); resolve() }
      const unsubscribe = store.subscribe(() => {
        const current = store.get(page)
        // New threads can show before the network read ends, so their arrival is what ends the wait.
        if (current && (current.data !== before.data || current.snapshot?.fetchedAt !== before.snapshot?.fetchedAt || current.error !== before.error)) done()
      })
      const timer = globalThis.setTimeout(done, REFRESH_WAIT_MS)
    })
  }, [store])
  const refreshLatest = useCallback(() => refreshPage(state.latestPage), [refreshPage, state.latestPage])
  const refreshAll = useCallback(async () => { if (active) await Promise.all(state.observed.map(refreshPage)) }, [active, refreshPage, state.observed])
  const refreshDiscussion = useCallback(async (discussionId: string | null) => {
    const holder = discussionId ? store.entries().find(([page, value]) => page >= state.low && value.data?.some((discussion) => discussion.id === discussionId)) : undefined
    await Promise.all([holder && holder[0] !== state.latestPage ? refreshPage(holder[0]) : undefined, refreshPage(state.latestPage)])
  }, [refreshPage, state.latestPage, state.low, store])

  const observers = active
    // Older pages refresh less often than the newest one, and at once after a write that touches them.
    ? state.observed.map((page) => <DiscussionPageObserver iid={iid} key={page} page={page} projectId={projectId} refreshIntervalMs={page >= state.latestPage ? undefined : OLDER_PAGE_REFRESH_MS} sessionId={sessionId} store={store} />)
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
    reading: state.reading,
    ready: state.ready,
    refreshAll,
    refreshDiscussion,
    refreshLatest,
    retryOlder,
  }
}
