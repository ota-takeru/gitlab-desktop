import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Diff, DiffsQuery, GitLabSnapshot } from '../../types/gitlab'
import { useAllDiffPages } from './useAllDiffPages'

const answers = vi.hoisted(() => new Map<number, GitLabSnapshot<Diff[]>>())
const prefetched = vi.hoisted(() => [] as number[])

vi.mock('../shared/useGitLabQuery', () => ({
  prefetchGitLabQuery: (_client: unknown, _session: string, query: { page: number }) => { prefetched.push(query.page) },
  useGitLabQuery: (_session: string | null, query: { page: number } | null) => {
    const snapshot = query ? answers.get(query.page) ?? null : null
    return { checkingSavedData: false, data: snapshot?.data ?? null, error: null, loading: !snapshot, previous: false, refresh: vi.fn(), refreshing: false, snapshot, stale: false }
  },
}))

const query: DiffsQuery = { headSha: 'head', iid: '1', kind: 'diffs', page: 1, projectId: '42' }

function diff(page: number): Diff {
  return { collapsed: false, deletedFile: false, diff: '', newFile: false, newPath: `file${page}.ts`, oldPath: `file${page}.ts`, renamedFile: false, tooLarge: false }
}

function page(number: number, totalPages: number | null, last = totalPages ?? 0): GitLabSnapshot<Diff[]> {
  return { completeness: 'page', data: [diff(number)], fetchedAt: number, nextPage: number < last ? number + 1 : null, source: 'network', totalPages }
}

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useAllDiffPages('s', query), { wrapper })
  /** What a finished read ahead leaves under the key the page's own read uses. */
  const hold = (number: number, snapshot: GitLabSnapshot<Diff[]>) => client.setQueryData(['gitlab', 's', JSON.stringify({ ...query, page: number })], { error: null, snapshot })
  return { ...hook, hold }
}

describe('useAllDiffPages', () => {
  beforeEach(() => {
    answers.clear()
    prefetched.length = 0
  })

  it('reads the pages after the one being read ahead, a few at a time, and keeps their order', () => {
    answers.set(1, page(1, 5))
    const { hold, rerender, result } = setup()
    expect(result.current.loading).toBe(true)
    // Page 2 is being read, with pages 3 and 4 alongside it.
    expect([...new Set(prefetched)].sort()).toEqual([3, 4])

    hold(3, page(3, 5))
    hold(4, page(4, 5))
    answers.set(2, page(2, 5))
    rerender()
    // Pages 3 and 4 are taken at once; page 5 is the last, so nothing past it is read.
    expect(Math.max(...prefetched)).toBe(4)
    expect(result.current.loading).toBe(true)

    answers.set(5, page(5, 5))
    rerender()
    expect(result.current.loading).toBe(false)
    expect(result.current.data?.map((item) => item.newPath)).toEqual(['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'])
    expect(result.current.snapshot?.completeness).toBe('complete')
  })

  it('reads one page after another when GitLab has not reported the page count', () => {
    answers.set(1, page(1, null, 3))
    const { rerender, result } = setup()
    answers.set(2, page(2, null, 3))
    rerender()
    answers.set(3, page(3, null, 3))
    rerender()
    expect(prefetched).toEqual([])
    expect(result.current.data).toHaveLength(3)
    expect(result.current.loading).toBe(false)
  })
})
