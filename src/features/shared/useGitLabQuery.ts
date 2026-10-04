import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'

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
  error: GitLabCommandError | null
  stale: boolean
  refresh: () => void
}

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
): GitLabQueryState<GitLabQueryData<Q>> {
  const queryClient = useQueryClient()
  const queryJson = useMemo(() => (query ? JSON.stringify(query) : ''), [query])
  const queryKey = useMemo(() => ['gitlab', sessionId ?? '', queryJson] as const, [queryJson, sessionId])
  const loaded = useQuery<LoadedQuery<GitLabQueryData<Q>>, GitLabCommandError>({
    enabled: Boolean(sessionId && query),
    queryFn: ({ signal }) => {
      // React Query only calls queryFn while enabled, but keep this guard for
      // type safety and for future callers that manually refetch a disabled key.
      if (!sessionId || !query) {
        return Promise.reject(new GitLabCommandError({ code: 'AUTH_REQUIRED', message: 'GitLabに接続してください。' }))
      }
      return fetchGitLabQuery(sessionId, query, signal, (snapshot) => {
        // Publish the cache hit while the network request is still in flight;
        // observers can render it immediately with `refreshing=true`.
        queryClient.setQueryData<LoadedQuery<GitLabQueryData<Q>>>(queryKey, { error: null, snapshot })
      })
    },
    queryKey,
  })

  const queryError = loaded.error ?? loaded.data?.error ?? null
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

  const snapshot = accessDenied ? null : loaded.data?.snapshot ?? null
  const refetch = loaded.refetch
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    data: snapshot?.data ?? null,
    error: queryError,
    loading: loaded.isPending && !snapshot,
    refreshing: loaded.isFetching && Boolean(snapshot),
    refresh,
    snapshot,
    stale: Boolean(snapshot && (snapshot.source === 'cache' || queryError)),
  }
}

async function fetchGitLabQuery<Q extends GitLabQuery>(
  sessionId: string,
  query: Q,
  signal: AbortSignal,
  onCached: (snapshot: GitLabSnapshot<GitLabQueryData<Q>>) => void,
): Promise<LoadedQuery<GitLabQueryData<Q>>> {
  const requestId = createRequestId('query')
  const cancel = () => { void cancelGitLabRequest(sessionId, requestId) }
  signal.addEventListener('abort', cancel, { once: true })

  let cached: GitLabSnapshot<GitLabQueryData<Q>> | null = null
  try {
    throwIfAborted(signal)
    try {
      cached = await queryGitLab({ mode: 'cache', query, requestId, sessionId })
      throwIfAborted(signal)
      if (cached) onCached(cached)
    } catch (caught) {
      const error = normalizeGitLabError(caught)
      if (error.code !== 'NOT_FOUND' && isAccessDenied(error)) return { error, snapshot: null }
    }

    throwIfAborted(signal)
    try {
      const fresh = await queryGitLab({ mode: 'network', query, requestId, sessionId })
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
    throw new GitLabCommandError({ code: 'CANCELLED', message: 'GitLabリクエストをキャンセルしました。' })
  }
}

function isAccessDenied(error: GitLabCommandError | null | undefined): boolean {
  return error?.code === 'AUTH_REQUIRED' || error?.code === 'FORBIDDEN' || error?.code === 'NOT_FOUND'
}
