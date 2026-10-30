import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { useQueryRefreshAllowed, useQueryRetention } from './QueryRefreshPolicy'
import { translate } from '../../i18n/i18n'

import { cancelGitLabRequest, createRequestId, normalizeGitLabError, queryGitLab } from '../../lib/gitlab'
import {
  GitLabCommandError,
  type GitLabQuery,
  type GitLabQueryData,
  type GitLabSnapshot,
} from '../../types/gitlab'

export interface GitLabQueryState<T> {
  data: T | null
  snapshot: GitLabSnapshot<T> | null
  loading: boolean
  refreshing: boolean
  /** The data belongs to the previous query of a `keepPrevious` caller while the current one loads. */
  previous: boolean
  error: GitLabCommandError | null
  stale: boolean
  refresh: () => void
}

/** How often a read that last failed is tried again by itself. */
const FAILED_REFRESH_INTERVAL_MS = 5 * 60_000

interface LoadedQuery<T> {
  snapshot: GitLabSnapshot<T> | null
  error: GitLabCommandError | null
}

/**
 * Cache-first query adapter backed by TanStack Query.
 *
 * Rust owns the durable, account-scoped cache. The query function hydrates the
 * current key from that cache before asking Rust for a network refresh. A
 * refresh failure keeps the hydrated snapshot visible and is surfaced through
 * the returned error field instead of replacing the page with a spinner.
 */
export function useGitLabQuery<Q extends GitLabQuery>(
  sessionId: string | null,
  query: Q | null,
  options: {
    keepPrevious?: boolean
    /**
     * Replaces the default 60-second refresh of open reviews, e.g. 15 seconds
     * for a running pipeline; false turns it off. It still runs only while the
     * window is visible, auto refresh is allowed and the last read succeeded.
     */
    refreshIntervalMs?: number | false
    /** Nothing on screen waits for it (the workspace monitor), so it yields to the screen's reads. */
    background?: boolean
  } = {},
): GitLabQueryState<GitLabQueryData<Q>> {
  const { background = false, refreshIntervalMs } = options
  const queryClient = useQueryClient()
  const autoRefresh = useQueryRefreshAllowed()
  const gcTime = useQueryRetention()
  const queryJson = useMemo(() => (query ? JSON.stringify(query) : ''), [query])
  const queryKey = useMemo(() => ['gitlab', sessionId ?? '', queryJson] as const, [queryJson, sessionId])
  const loaded = useQuery<LoadedQuery<GitLabQueryData<Q>>, GitLabCommandError>({
    enabled: Boolean(sessionId && query),
    // An explicit undefined would replace the client's default rather than keep it.
    ...(gcTime === undefined ? {} : { gcTime }),
    // After a failed read polling goes on more slowly instead of stopping, so a passing network
    // error does not freeze the screen; a lost permission or a missing resource is not asked again.
    refetchInterval: (current) => {
      if (!autoRefresh || document.visibilityState !== 'visible' || !query) return false
      if (refreshIntervalMs === undefined ? !['mrs', 'mr', 'notes', 'discussions', 'drafts', 'todos', 'approvals', 'mrApprovals', 'mrAwards', 'noteAwards'].includes(query.kind) : refreshIntervalMs === false) return false
      const failure = current.state.error ?? current.state.data?.error
      if (isAccessDenied(failure)) return false
      const interval = refreshIntervalMs || 60_000
      return failure ? Math.max(interval, FAILED_REFRESH_INTERVAL_MS, failure.retryAfterMs ?? 0) : interval
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (current) => {
      const failure = current.state.error ?? current.state.data?.error
      const interval = failure ? FAILED_REFRESH_INTERVAL_MS : refreshIntervalMs || 60_000
      return autoRefresh && !isAccessDenied(failure) && Date.now() - Math.max(current.state.dataUpdatedAt, current.state.errorUpdatedAt) > interval
    },
    queryFn: ({ signal }) => {
      // React Query only calls queryFn while enabled, but keep this guard for
      // type safety and for future callers that manually refetch a disabled key.
      if (!sessionId || !query) {
        return Promise.reject(new GitLabCommandError({ code: 'AUTH_REQUIRED', message: translate('common.gitlab.connectRequired') }))
      }
      // A refresh of data already on screen goes straight to the network: publishing
      // the older disk copy first would flip the view to 「保存済み」 and back.
      const shown = queryClient.getQueryData<LoadedQuery<GitLabQueryData<Q>>>(queryKey)?.snapshot ?? null
      return fetchGitLabQuery(sessionId, query, background, signal, shown, (snapshot) => {
        // Publish the cache hit while the network request is still in flight;
        // observers can render it immediately with `refreshing=true`.
        queryClient.setQueryData<LoadedQuery<GitLabQueryData<Q>>>(queryKey, { error: null, snapshot })
      })
    },
    queryKey,
    // Another page or filter of the same list keeps the rows on screen, marked as
    // updating, instead of blanking them; only within one session.
    placeholderData: options.keepPrevious ? (previous, previousQuery) => previousQuery?.queryKey[1] === (sessionId ?? '') ? keepPreviousData(previous) : undefined : undefined,
  })

  // Every hook without a query shares one disabled key, so nothing stored there belongs to the caller.
  const queryError = query ? loaded.error ?? loaded.data?.error ?? null : null
  const accessDenied = isAccessDenied(queryError)

  useEffect(() => {
    if (!queryError || !sessionId || !query || !accessDenied) return
    // The query remains in an errored, empty state so React Query does not
    // recreate an active observer and immediately retry a denied resource.
    // Rust also removes the durable snapshot for these responses.
    if (queryError.code === 'AUTH_REQUIRED') {
      globalThis.dispatchEvent(new CustomEvent('gitlab-auth-required', { detail: { sessionId } }))
    }
  }, [accessDenied, query, queryError, sessionId])

  const snapshot = accessDenied || !query ? null : loaded.data?.snapshot ?? null
  const refetch = loaded.refetch
  const hasQuery = Boolean(sessionId && query)
  const refresh = useCallback(() => {
    // Refetching a disabled key would run the query function and store its error under that shared key.
    if (hasQuery) void refetch()
  }, [hasQuery, refetch])

  return {
    data: snapshot?.data ?? null,
    error: queryError,
    loading: loaded.isPending && !snapshot,
    previous: loaded.isPlaceholderData && Boolean(snapshot),
    refreshing: loaded.isFetching && Boolean(snapshot),
    refresh,
    snapshot,
    stale: Boolean(snapshot && (snapshot.source === 'cache' || queryError)),
  }
}

/**
 * Applies a change GitLab has just confirmed (a successful write) to the data
 * shown for `query`, so the screen follows at once; the caller still refreshes
 * it from GitLab. `query` must be the object the screen reads with.
 */
export function applyConfirmedGitLabChange<Q extends GitLabQuery>(
  queryClient: QueryClient,
  sessionId: string,
  query: Q,
  update: (data: GitLabQueryData<Q>) => GitLabQueryData<Q>,
): void {
  queryClient.setQueryData<LoadedQuery<GitLabQueryData<Q>>>(['gitlab', sessionId, JSON.stringify(query)], (current) => current?.snapshot
    ? { ...current, snapshot: { ...current.snapshot, data: update(current.snapshot.data) } }
    : current)
}

/**
 * Reads `query` ahead of the screen that will show it, under the key that screen's
 * `useGitLabQuery` uses (`query` must have the same fields in the same order), so the
 * screen opens on it or joins the read in flight. It yields to the screen's reads, and
 * data still fresh is not read again.
 */
export function prefetchGitLabQuery<Q extends GitLabQuery>(queryClient: QueryClient, sessionId: string, query: Q): void {
  const queryKey = ['gitlab', sessionId, JSON.stringify(query)] as const
  void queryClient.prefetchQuery<LoadedQuery<GitLabQueryData<Q>>, GitLabCommandError>({
    queryFn: ({ signal }) => fetchGitLabQuery(sessionId, query, true, signal, queryClient.getQueryData<LoadedQuery<GitLabQueryData<Q>>>(queryKey)?.snapshot ?? null, (snapshot) => {
      queryClient.setQueryData<LoadedQuery<GitLabQueryData<Q>>>(queryKey, { error: null, snapshot })
    }),
    queryKey,
  })
}

async function fetchGitLabQuery<Q extends GitLabQuery>(
  sessionId: string,
  query: Q,
  background: boolean,
  signal: AbortSignal,
  shown: GitLabSnapshot<GitLabQueryData<Q>> | null,
  onCached: (snapshot: GitLabSnapshot<GitLabQueryData<Q>>) => void,
): Promise<LoadedQuery<GitLabQueryData<Q>>> {
  const requestId = createRequestId('query')
  const cancel = () => { void cancelGitLabRequest(sessionId, requestId) }
  signal.addEventListener('abort', cancel, { once: true })

  let cached: GitLabSnapshot<GitLabQueryData<Q>> | null = shown
  try {
    throwIfAborted(signal)
    if (!shown) try {
      cached = await queryGitLab({ mode: 'cache', query, requestId, sessionId })
      throwIfAborted(signal)
      if (cached) onCached(cached)
    } catch (caught) {
      const error = normalizeGitLabError(caught)
      if (error.code !== 'NOT_FOUND' && isAccessDenied(error)) return { error, snapshot: null }
    }

    throwIfAborted(signal)
    try {
      const fresh = await queryGitLab({ background, mode: 'network', query, requestId, sessionId })
      throwIfAborted(signal)
      return { error: null, snapshot: fresh ?? cached }
    } catch (caught) {
      const error = normalizeGitLabError(caught)
      if (isAccessDenied(error)) return { error, snapshot: null }
      if (cached) return { error, snapshot: cached }
      throw error
    }
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GitLabCommandError({ code: 'CANCELLED', message: translate('common.gitlab.requestCancelled') })
  }
}

function isAccessDenied(error: GitLabCommandError | null | undefined): boolean {
  return error?.code === 'AUTH_REQUIRED' || error?.code === 'FORBIDDEN' || error?.code === 'NOT_FOUND'
}
