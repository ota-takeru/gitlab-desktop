import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import type { Diff, DiffsQuery, Discussion, GitLabSnapshot, Position } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { DiscussionCode, type CurrentDiffs } from './DiscussionCode'

/** Diff pages read to find commented files; GitLab returns 30 files per page. */
const MAX_DIFF_PAGES = 10

/**
 * The code beside each line comment. Comments on the MR's current head show
 * their lines in the current diff, read from the same diff pages as the
 * changes tab; comments on an older head, or on a file the diff pages do not
 * hold, show the file as it was at the commented commit.
 */
export function useDiscussionCode({ discussions, enabled, headSha, iid, projectId, sessionId }: { discussions: Discussion[]; enabled: boolean; headSha: string | undefined; iid: string; projectId: string; sessionId: string | null }): ((position: Position) => ReactNode) | undefined {
  const paths = useMemo(() => [...new Set(discussions.flatMap((discussion) => discussion.notes)
    .map((note) => note.position)
    .filter((position): position is Position => Boolean(position && hasLine(position) && position.headSha === headSha))
    .map((position) => position.newPath || position.oldPath))].sort(), [discussions, headSha])
  const pages = useLoadedDiffPages(sessionId, projectId, iid, headSha)
  const found = useMemo(() => new Set(Object.values(pages).flatMap((page) => page.data.flatMap((diff) => [diff.newPath, diff.oldPath]))), [pages])
  const missing = enabled && Boolean(headSha) && paths.some((path) => !found.has(path))
  const requestPage = missing ? nextUnreadPage(pages) : null
  const query = useMemo<DiffsQuery | null>(() => requestPage && headSha ? { headSha, iid, kind: 'diffs', page: requestPage, projectId } : null, [headSha, iid, projectId, requestPage])
  const request = useGitLabQuery<DiffsQuery>(sessionId, query)
  const searching = requestPage !== null && !request.error
  const find = useCallback((path: string) => {
    for (const page of Object.values(pages)) {
      const diff = page.data.find((item) => item.newPath === path || item.oldPath === path)
      if (diff) return diff
    }
    return undefined
  }, [pages])
  if (!enabled || !sessionId) return undefined
  const current: CurrentDiffs = { find, searching }
  return (position) => hasLine(position) ? <DiscussionCode current={position.headSha === headSha ? current : null} position={position} projectId={projectId} sessionId={sessionId} /> : null
}

function hasLine(position: Position): boolean {
  return position.positionType === 'text' && (position.newLine !== undefined || position.oldLine !== undefined)
}

function nextUnreadPage(pages: Record<number, { nextPage: number | null }>): number | null {
  let page = 1
  while (pages[page]) {
    const next = pages[page].nextPage
    if (next === null || next <= page) return null
    page = next
  }
  return page <= MAX_DIFF_PAGES ? page : null
}

/** Diff pages of this MR head already in the query cache, by page number. */
function useLoadedDiffPages(sessionId: string | null, projectId: string, iid: string, headSha: string | undefined): Record<number, { data: Diff[]; nextPage: number | null }> {
  const client = useQueryClient()
  const matches = useCallback((queryKey: readonly unknown[]) => {
    if (queryKey[0] !== 'gitlab' || queryKey[1] !== sessionId || typeof queryKey[2] !== 'string') return false
    try {
      const query = JSON.parse(queryKey[2]) as Partial<DiffsQuery>
      return query.kind === 'diffs' && query.projectId === projectId && query.iid === iid && query.headSha === headSha
    } catch {
      return false
    }
  }, [headSha, iid, projectId, sessionId])
  const getVersion = useCallback(() => client.getQueryCache().findAll({ predicate: (query) => matches(query.queryKey) }).map((query) => `${query.queryHash}:${query.state.dataUpdateCount}`).join('|'), [client, matches])
  const version = useSyncExternalStore((listener) => client.getQueryCache().subscribe(listener), getVersion, getVersion)
  return useMemo(() => {
    const pages: Record<number, { data: Diff[]; nextPage: number | null }> = {}
    for (const [queryKey, result] of client.getQueriesData<{ snapshot: GitLabSnapshot<Diff[]> | null }>({ predicate: (query) => matches(query.queryKey) })) {
      if (result?.snapshot) pages[(JSON.parse(queryKey[2] as string) as DiffsQuery).page] = { data: result.snapshot.data, nextPage: result.snapshot.nextPage }
    }
    return pages
  }, [client, matches, version]) // eslint-disable-line react-hooks/exhaustive-deps
}
