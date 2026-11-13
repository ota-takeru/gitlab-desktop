import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommitDiffQuery, Diff, DiffsQuery, GitLabSnapshot, VersionCompareQuery } from '../../types/gitlab'
import { prefetchGitLabQuery, useGitLabQuery, type GitLabQueryState } from '../shared/useGitLabQuery'

/** Pages read for one diff (30 files each); GitLab stops listing an MR's files well before this. */
const MAX_DIFF_PAGES = 100
/** Pages read at the same time: the one being read and those after it read ahead. */
const PAGES_AT_ONCE = 3

type DiffPageQuery = DiffsQuery | CommitDiffQuery | VersionCompareQuery

interface ReadPages {
  key: string
  /** The page being read, or the last one once every page is read. */
  page: number
  pages: Diff[][]
  truncated: boolean[]
  done: boolean
  /** A refresh: each page waits for GitLab instead of moving on from the saved copy. */
  fresh: boolean
  /** The last read taken in, so each read is taken once. */
  seen: { page: number; fetchedAt: number } | null
  /** GitLab's page count, once a page has reported it. */
  total: number | null
}

const startReading = (key: string): ReadPages => ({ done: false, fresh: false, key, page: 1, pages: [], seen: null, total: null, truncated: [] })

/** Takes in the page being read and moves on to the next one, if there is one. */
function takePage(read: ReadPages, snapshot: GitLabSnapshot<Diff[]>): ReadPages {
  const index = read.page - 1
  const more = snapshot.nextPage !== null && read.page < MAX_DIFF_PAGES
  const pages = [...read.pages.slice(0, index), snapshot.data, ...more ? read.pages.slice(index + 1) : []]
  const truncated = [...read.truncated.slice(0, index), snapshot.completeness === 'truncated' || (snapshot.nextPage !== null && !more), ...more ? read.truncated.slice(index + 1) : []]
  return { ...read, done: read.done || !more, fresh: more && read.fresh, page: more ? read.page + 1 : read.page, pages, seen: { fetchedAt: snapshot.fetchedAt, page: read.page }, total: snapshot.totalPages ?? read.total, truncated }
}

/**
 * Every page of a diff, taken in one after another and shown as one list, so the
 * changes tab lists all of the files rather than the first page of them. Once GitLab
 * has reported the page count, the pages after the one being read are read ahead,
 * `PAGES_AT_ONCE` at a time; a refresh still reads each page in turn.
 * `loading` holds until the last page is read; a refresh reads them all again.
 */
export function useAllDiffPages<Q extends DiffPageQuery>(sessionId: string | null, query: Q | null): GitLabQueryState<Diff[]> {
  const key = query ? JSON.stringify(query) : ''
  const queryClient = useQueryClient()
  const [stored, setStored] = useState(() => startReading(key))
  if (stored.key !== key) setStored(startReading(key))
  const read = stored.key === key ? stored : startReading(key)
  const pageQuery = useMemo(() => (query ? { ...query, page: read.page } : null), [query, read.page])
  const result = useGitLabQuery<Q>(sessionId, pageQuery as Q | null)
  const { data, refresh: refreshPage, refreshing, snapshot } = result

  if (query && data && snapshot && !(read.seen?.page === read.page && read.seen.fetchedAt === snapshot.fetchedAt) && !(read.fresh && refreshing)) {
    let next = takePage(read, snapshot as GitLabSnapshot<Diff[]>)
    // Pages still held from an earlier read are taken at once, not one render each.
    while (!next.done && !next.fresh) {
      const held = queryClient.getQueryData<{ snapshot: GitLabSnapshot<Diff[]> | null }>(['gitlab', sessionId ?? '', JSON.stringify({ ...query, page: next.page })])?.snapshot
      if (!held) break
      next = takePage(next, held)
    }
    setStored(next)
  }

  const { done, fresh, page, total } = read
  useEffect(() => {
    if (!sessionId || !query || done || fresh || total === null) return
    const last = Math.min(page + PAGES_AT_ONCE - 1, total, MAX_DIFF_PAGES)
    // A page still held is not read again, and one already being read is joined.
    for (let ahead = page + 1; ahead <= last; ahead += 1) prefetchGitLabQuery(queryClient, sessionId, { ...query, page: ahead })
  }, [done, fresh, page, query, queryClient, sessionId, total])

  const refresh = useCallback(() => {
    if (read.page === 1) refreshPage()
    setStored((current) => current.key === key ? { ...current, fresh: true, page: 1 } : current)
  }, [key, read.page, refreshPage])

  const all = useMemo(() => (read.pages.length ? read.pages.flat() : null), [read.pages])
  const truncated = read.truncated.some(Boolean)
  const allSnapshot = useMemo<GitLabSnapshot<Diff[]> | null>(() => (snapshot && all ? { ...snapshot, completeness: truncated ? 'truncated' : 'complete', data: all, nextPage: null } : null), [all, snapshot, truncated])
  const failed = Boolean(result.error && !data)
  return {
    ...result,
    data: all,
    loading: !read.done && !failed,
    refresh,
    refreshing: read.done && !failed && (refreshing || read.fresh),
    snapshot: allSnapshot,
  }
}
