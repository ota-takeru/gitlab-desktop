import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Discussion } from '../../types/gitlab'
import { OLDER_PAGE_REFRESH_MS, useDiscussionWindow, type DiscussionWindow } from './useDiscussionWindow'

const mocks = vi.hoisted(() => ({
  pages: {} as Record<number, { data: unknown[]; nextPage: number | null; totalPages?: number }>,
  requested: [] as number[],
  refreshIntervals: {} as Record<number, number | false | undefined>,
  refreshes: [] as number[],
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: { kind: string; page: number } | null, options?: { refreshIntervalMs?: number | false }) => {
    const page = query?.page ?? 0
    mocks.refreshIntervals[page] = options?.refreshIntervalMs
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
    mocks.refreshIntervals = {}
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
    // The page before the newest is read beside it but stays hidden until asked for.
    expect(mocks.requested).toContain(2)
    expect(mocks.requested).not.toContain(4)
    // The newest page polls at the default interval.
    expect(mocks.refreshIntervals[3]).toBeUndefined()

    act(() => current.value?.loadOlder())
    await waitFor(() => expect(current.value?.discussions).toHaveLength(42))
    expect(current.value?.discussions[0].id).toBe('p2-1')
    expect(current.value?.discussions.at(-1)?.id).toBe('p3-12')
    // Older pages poll less often, and at once after related writes.
    expect(mocks.refreshIntervals[2]).toBe(OLDER_PAGE_REFRESH_MS)

    act(() => { void current.value?.refreshDiscussion('p2-5') })
    expect(mocks.refreshes).toEqual([2, 3])
  })

  it('resolves a refresh of the newest page once its new threads have arrived', async () => {
    mocks.pages = { 1: { data: threads('p1', 12), nextPage: null, totalPages: 1 } }
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.ready).toBe(true))

    let resolved = false
    act(() => { void current.value?.refreshLatest().then(() => { resolved = true }) })
    expect(mocks.refreshes).toEqual([1])
    await Promise.resolve()
    expect(resolved).toBe(false)

    // The posted comment's thread arrives with the page read again.
    mocks.pages = { 1: { data: threads('p1', 13), nextPage: null, totalPages: 1 } }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(resolved).toBe(true))
    expect(current.value?.discussions).toHaveLength(13)
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

  it('reads the page before the newest together with the newest, not after it', async () => {
    mocks.pages = { 1: { data: threads('p1', 30), nextPage: 2, totalPages: 3 } }
    const { current, view } = renderWindow()

    await waitFor(() => expect(mocks.requested).toContain(3))
    expect(mocks.requested).toContain(2)
    expect(current.value?.ready).toBe(false)

    // A full newest page leaves the read page hidden, and stops observing it once read.
    mocks.pages[3] = { data: threads('p3', 30), nextPage: null, totalPages: 3 }
    mocks.pages[2] = { data: threads('p2', 30), nextPage: 3, totalPages: 3 }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.discussions).toHaveLength(30)
    expect(current.value?.hasOlder).toBe(true)
  })

  it('shows the newest threads while their context page is still loading', async () => {
    mocks.pages = {
      1: { data: threads('p1', 30), nextPage: 2, totalPages: 3 },
      3: { data: threads('p3', 3), nextPage: null, totalPages: 3 },
    }
    const { current, view } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.discussions.map((discussion) => discussion.id)).toEqual(threads('p3', 3).map((discussion) => discussion.id))
    expect(current.value?.loadingOlder).toBe(true)

    mocks.pages[2] = { data: threads('p2', 30), nextPage: 3, totalPages: 3 }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(current.value?.discussions).toHaveLength(33))
    expect(current.value?.discussions[0].id).toBe('p2-1')
    expect(current.value?.loadingOlder).toBe(false)
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
