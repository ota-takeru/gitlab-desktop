import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitLabCommandError, type Discussion } from '../../types/gitlab'
import { OLDER_PAGE_REFRESH_MS, useDiscussionWindow, type DiscussionWindow } from './useDiscussionWindow'

const mocks = vi.hoisted(() => ({
  pages: {} as Record<number, { data: unknown[]; nextPage: number | null; totalPages?: number }>,
  errors: {} as Record<number, unknown>,
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
      error: mocks.errors[page] ?? null,
      loading: !entry && !mocks.errors[page],
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

/** A list of full pages without X-Total-Pages; as on GitLab, a page past the end is empty and has no next page. */
function pagesWithoutCount(last: number): typeof mocks.pages {
  const pages: typeof mocks.pages = {}
  for (let page = 1; page <= last; page += 1) pages[page] = { data: threads(`p${page}`, 30), nextPage: page < last ? page + 1 : null }
  for (let page = last + 1; page <= last * 2 + 1; page += 1) pages[page] = { data: [], nextPage: null }
  return pages
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
    mocks.errors = {}
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

  it('finds the newest page of a long list when GitLab does not report the page count', async () => {
    mocks.pages = pagesWithoutCount(15)
    const { current, view } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.latestPage).toBe(15)
    expect(current.value?.latest?.data[0].id).toBe('p15-1')
    expect(current.value?.discussions.map((discussion) => discussion.id)).toEqual(threads('p15', 30).map((discussion) => discussion.id))
    expect(current.value?.hasOlder).toBe(true)
    expect(current.value?.limitReached).toBe(false)

    // Older pages stop at the same limit as a list with a reported count, and say so.
    for (let page = 14; page >= 6; page -= 1) {
      act(() => current.value?.loadOlder())
      view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
      await waitFor(() => expect(current.value?.discussions[0].id).toBe(`p${page}-1`))
    }
    expect(current.value?.hasOlder).toBe(false)
    expect(current.value?.limitReached).toBe(true)
  })

  it('needs few reads to find the newest page of a very long list', async () => {
    mocks.pages = pagesWithoutCount(400)
    const { current } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.latestPage).toBe(400)
    expect(mocks.requested.length).toBeLessThanOrEqual(20)
  })

  it('shows an empty list when GitLab reports no count and no threads', async () => {
    mocks.pages = { 1: { data: [], nextPage: null } }
    const { current } = renderWindow()

    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.discussions).toEqual([])
    expect(current.value?.latestPage).toBe(1)
  })

  it('moves to a new newest page after it was found without a reported count', async () => {
    // Page 6 was read as empty during the search, so that answer is out of date once page 5 has a next page.
    mocks.pages = pagesWithoutCount(5)
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.ready).toBe(true))
    expect(current.value?.latestPage).toBe(5)

    mocks.pages[5] = { data: threads('p5', 30), nextPage: 6 }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    // The empty page is read again as often as the newest page, because the next thread appears there.
    await waitFor(() => expect(mocks.refreshIntervals[6]).toBeUndefined())
    expect(current.value?.latestPage).toBe(5)

    mocks.pages[6] = { data: threads('p6', 1), nextPage: null }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(current.value?.latestPage).toBe(6))
    expect(current.value?.discussions[0].id).toBe('p5-1')
    expect(current.value?.discussions.at(-1)?.id).toBe('p6-1')
  })

  it('keeps the shown threads while a new page after a found last page is read', async () => {
    // The search reads 1, 2, 4, 8, 16, 12, 14: page 15 is unread and page 16 is empty from then on.
    mocks.pages = pagesWithoutCount(14)
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.latestPage).toBe(14))
    expect(mocks.requested).not.toContain(15)

    const states: boolean[] = []
    const track = (window: DiscussionWindow) => { current.value = window; states.push(window.ready) }
    mocks.pages[14] = { data: threads('p14', 30), nextPage: 15 }
    view.rerender(<Harness onWindow={track} />)
    await waitFor(() => expect(mocks.requested).toContain(15))
    delete mocks.pages[15]
    view.rerender(<Harness onWindow={track} />)

    mocks.pages[15] = { data: threads('p15', 1), nextPage: null }
    view.rerender(<Harness onWindow={track} />)
    await waitFor(() => expect(current.value?.latestPage).toBe(15))
    expect(states).not.toContain(false)
    expect(current.value?.discussions[0].id).toBe('p14-1')
    expect(current.value?.discussions.at(-1)?.id).toBe('p15-1')
  })

  it('shows the failure when the search for the newest page cannot read a page', async () => {
    mocks.pages = pagesWithoutCount(15)
    delete mocks.pages[4]
    mocks.errors[4] = new GitLabCommandError({ code: 'NETWORK', message: 'offline' })
    const { current, view } = renderWindow()

    await waitFor(() => expect(current.value?.error?.code).toBe('NETWORK'))
    expect(current.value?.ready).toBe(false)
    expect(current.value?.loading).toBe(false)

    mocks.pages = pagesWithoutCount(15)
    mocks.errors = {}
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(current.value?.latestPage).toBe(15))
    expect(current.value?.error).toBeNull()
  })

  it('uses the reported count once an old cache entry without one is read again', async () => {
    mocks.pages = { 1: { data: threads('p1', 30), nextPage: 2 }, 2: { data: threads('p2', 30), nextPage: null } }
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.latestPage).toBe(2))

    mocks.pages = {
      1: { data: threads('p1', 30), nextPage: 2, totalPages: 12 },
      2: { data: threads('p2', 30), nextPage: 3, totalPages: 12 },
      12: { data: threads('p12', 30), nextPage: null, totalPages: 12 },
    }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(current.value?.latestPage).toBe(12))
    expect(current.value?.discussions.at(-1)?.id).toBe('p12-30')
  })

  it('keeps the shown threads until a page revealed by a new page count has been read', async () => {
    mocks.pages = { 1: { data: threads('p1', 30), nextPage: null, totalPages: 1 } }
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.ready).toBe(true))

    const states: boolean[] = []
    const track = (window: DiscussionWindow) => { current.value = window; states.push(window.ready) }
    mocks.pages[1] = { data: threads('p1', 30), nextPage: 2, totalPages: 2 }
    view.rerender(<Harness onWindow={track} />)
    await waitFor(() => expect(mocks.requested).toContain(2))
    expect(current.value?.discussions).toHaveLength(30)
    expect(current.value?.latestPage).toBe(1)
    expect(current.value?.latest?.data).toHaveLength(30)
    expect(current.value?.newestPages).toEqual([1, 2])
    // The new page is read as often as the newest one.
    expect(mocks.refreshIntervals[2]).toBeUndefined()

    // A comment posted now may be on the new page, so reading the newest again covers both.
    act(() => { void current.value?.refreshLatest() })
    expect(mocks.refreshes).toEqual([1, 2])

    mocks.pages[2] = { data: threads('p2', 1), nextPage: null, totalPages: 2 }
    view.rerender(<Harness onWindow={track} />)
    await waitFor(() => expect(current.value?.latestPage).toBe(2))
    expect(current.value?.latest?.data[0].id).toBe('p2-1')
    expect(current.value?.discussions).toHaveLength(31)
    expect(states).not.toContain(false)
  })

  it('keeps the shown threads and no error when a page revealed by a new page count cannot be read', async () => {
    mocks.pages = { 1: { data: threads('p1', 30), nextPage: null, totalPages: 1 } }
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.ready).toBe(true))

    mocks.pages[1] = { data: threads('p1', 30), nextPage: 2, totalPages: 2 }
    mocks.errors[2] = new GitLabCommandError({ code: 'NETWORK', message: 'offline' })
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(mocks.requested).toContain(2))
    await waitFor(() => expect(current.value?.reading).toBe(false))
    expect(current.value?.ready).toBe(true)
    expect(current.value?.discussions).toHaveLength(30)
    expect(current.value?.error).toBeNull()
  })

  it('shows the loading state when a new page count leaves no read page in the range', async () => {
    mocks.pages = { 1: { data: threads('p1', 30), nextPage: null, totalPages: 1 } }
    const { current, view } = renderWindow()
    await waitFor(() => expect(current.value?.ready).toBe(true))

    mocks.pages[1] = { data: threads('p1', 30), nextPage: 2, totalPages: 20 }
    view.rerender(<Harness onWindow={(window) => { current.value = window }} />)
    await waitFor(() => expect(mocks.requested).toContain(20))
    expect(current.value?.ready).toBe(false)
    expect(current.value?.latestPage).toBe(20)
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
