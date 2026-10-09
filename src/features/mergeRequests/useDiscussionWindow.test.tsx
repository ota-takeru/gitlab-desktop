import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Discussion } from '../../types/gitlab'
import { useQueryRefreshAllowed } from '../shared/QueryRefreshPolicy'
import { useDiscussionWindow, type DiscussionWindow } from './useDiscussionWindow'

const mocks = vi.hoisted(() => ({
  pages: {} as Record<number, { data: unknown[]; nextPage: number | null; totalPages?: number }>,
  requested: [] as number[],
  autoRefresh: {} as Record<number, boolean>,
  refreshes: [] as number[],
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: { kind: string; page: number } | null) => {
    const autoRefresh = useQueryRefreshAllowed()
    const page = query?.page ?? 0
    mocks.autoRefresh[page] = autoRefresh
    if (!mocks.requested.includes(page)) mocks.requested.push(page)
    const entry = mocks.pages[page]
    return {
      data: entry?.data ?? null,
      error: null,
      loading: !entry,
      refreshing: false,
      refresh: () => mocks.refreshes.push(page),
      snapshot: entry ? { completeness: 'complete', data: entry.data, fetchedAt: page, nextPage: entry.nextPage, source: 'network', totalPages: entry.totalPages } : null,
      stale: false,
    }
  },
}))

function threads(prefix: string, count: number): Discussion[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}`, individualNote: false, notes: [] }))
}

function Harness({ onWindow }: { onWindow: (window: DiscussionWindow) => void }) {
  const window = useDiscussionWindow('session', '42', '7', true)
  onWindow(window)
  return <>{window.observers}</>
}

function renderWindow() {
  const current: { value: DiscussionWindow | null } = { value: null }
  const view = render(<Harness onWindow={(window) => { current.value = window }} />)
  return { current, view }
}

describe('useDiscussionWindow', () => {
  beforeEach(() => {
    mocks.pages = {}
    mocks.requested = []
    mocks.autoRefresh = {}
    mocks.refreshes = []
  })

  it('shows the newest page first and prepends older pages on request', async () => {
    mocks.pages = {
      1: { data: threads('p1', 30), nextPage: 2, totalPages: 3 },
      2: { data: threads('p2', 30), nextPage: 3, totalPages: 3 },
      3: { data: threads('p3', 12), nextPage: null, totalPages: 3 },
    }
    const { current } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.discussions.map((discussion) => discussion.id)).toEqual(threads('p3', 12).map((discussion) => discussion.id))
    expect(current.value?.latestPage).toBe(3)
    expect(current.value?.hasOlder).toBe(true)
    expect(mocks.requested).not.toContain(2)
    expect(mocks.autoRefresh[3]).toBe(true)

    act(() => current.value?.loadOlder())
    await waitFor(() => expect(current.value?.discussions).toHaveLength(42))
    expect(current.value?.discussions[0].id).toBe('p2-1')
    expect(current.value?.discussions.at(-1)?.id).toBe('p3-12')
    // Only the newest page polls; older pages refresh after related writes.
    expect(mocks.autoRefresh[2]).toBe(false)

    act(() => current.value?.refreshDiscussion('p2-5'))
    expect(mocks.refreshes).toEqual([2, 3])
  })

  it('adds the previous page when the newest page is short so the first view has context', async () => {
    mocks.pages = {
      1: { data: threads('p1', 30), nextPage: 2, totalPages: 2 },
      2: { data: threads('p2', 3), nextPage: null, totalPages: 2 },
    }
    const { current } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.discussions).toHaveLength(33)
    expect(current.value?.hasOlder).toBe(false)
  })

  it('walks forward when GitLab does not report the page count', async () => {
    mocks.pages = {
      1: { data: threads('p1', 30), nextPage: 2 },
      2: { data: threads('p2', 4), nextPage: null },
    }
    const { current } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.discussions).toHaveLength(34)
    expect(current.value?.latestPage).toBe(2)
  })

  it('keeps shown threads when a refresh reveals a new newest page', async () => {
    mocks.pages = { 1: { data: threads('p1', 30), nextPage: null, totalPages: 1 } }
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.ready).toBe(true))

    mocks.pages = {
      1: { data: threads('p1', 30), nextPage: 2, totalPages: 2 },
      2: { data: threads('p2', 1), nextPage: null, totalPages: 2 },
    }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(current.value?.discussions).toHaveLength(31))
    expect(current.value?.discussions[0].id).toBe('p1-1')
  })
})
