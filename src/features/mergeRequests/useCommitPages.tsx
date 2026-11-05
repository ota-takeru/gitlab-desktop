import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { Commit, ReviewResourceQuery } from '../../types/gitlab'
import { useGitLabQuery, type GitLabQueryState } from '../shared/useGitLabQuery'

type CommitsQuery = ReviewResourceQuery & { kind: 'commits' }

interface LaterPage {
  data: Commit[] | null
  error: GitLabQueryState<Commit[]>['error']
  loading: boolean
  nextPage: number | null
  refresh: () => void
  refreshing: boolean
}

/** Older commits than the ones listed, read as the list comes near its end. */
export interface MoreCommits {
  /** False while a page is read, and after a read failed so it is not tried again on every scroll. */
  auto: boolean
  loading: boolean
  /** Reads the next page, or the failed one again. */
  onLoad: () => void
}

/** One later page of the list. It refreshes with the first page's reload rather than every minute on its own. */
function CommitPageLoader({ iid, onChange, page, projectId, sessionId }: { iid: string; onChange: (page: number, result: LaterPage) => void; page: number; projectId: string; sessionId: string | null }) {
  const query = useMemo<CommitsQuery>(() => ({ iid, kind: 'commits', page, projectId }), [iid, page, projectId])
  const { data, error, loading, refresh, refreshing, snapshot } = useGitLabQuery<CommitsQuery>(sessionId, query, { refreshIntervalMs: false })
  const nextPage = snapshot?.nextPage ?? null
  useEffect(() => onChange(page, { data, error, loading, nextPage, refresh, refreshing }), [data, error, loading, nextPage, onChange, page, refresh, refreshing])
  return null
}

/**
 * The MR's commits, newest first, as one list that grows by a page at a time.
 * `loaders` has to be rendered for the later pages to be read.
 */
export function useCommitPages(sessionId: string | null, projectId: string, iid: string, enabled: boolean) {
  const query = useMemo<CommitsQuery | null>(() => enabled ? { iid, kind: 'commits', page: 1, projectId } : null, [enabled, iid, projectId])
  const first = useGitLabQuery<CommitsQuery>(sessionId, query)
  const [morePages, setMorePages] = useState(0)
  const [read, setRead] = useState<Record<number, LaterPage>>({})
  const report = useCallback((page: number, result: LaterPage) => setRead((current) => ({ ...current, [page]: result })), [])
  const loadNext = useCallback(() => setMorePages((count) => count + 1), [])

  const later = Array.from({ length: morePages }, (_, index): LaterPage | undefined => read[index + 2])
  const last = later.at(-1)
  const firstData = first.data
  // A push moves every commit down the pages, so one may come again on the next page.
  const commits = useMemo(() => {
    const seen = new Set<string>()
    const pages = [firstData, ...Array.from({ length: morePages }, (_, index) => read[index + 2]?.data)]
    return pages.flatMap((page) => page ?? []).filter((commit) => !seen.has(commit.id) && Boolean(seen.add(commit.id)))
  }, [firstData, morePages, read])

  const nextPage = morePages ? last?.nextPage ?? null : first.snapshot?.nextPage ?? null
  const loading = morePages > 0 && (!last || last.loading)
  const failed = last?.error ? last : null
  const more: MoreCommits | null = enabled && (nextPage !== null || loading || failed) ? { auto: nextPage !== null && !loading && !failed, loading, onLoad: failed ? failed.refresh : loadNext } : null

  return {
    commits,
    error: first.error ?? later.find((page) => page?.error)?.error ?? null,
    // Kept while the tab is away, so the list comes back as long as it was and its scroll position holds.
    loaders: enabled ? Array.from({ length: morePages }, (_, index): ReactNode => <CommitPageLoader iid={iid} key={index + 2} onChange={report} page={index + 2} projectId={projectId} sessionId={sessionId} />) : null,
    loading: first.loading,
    more,
    refresh: () => { first.refresh(); for (const page of later) page?.refresh() },
    refreshing: first.refreshing || later.some((page) => page?.refreshing),
  }
}
