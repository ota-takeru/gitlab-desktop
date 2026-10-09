/**
 * Scroll helpers for the discussion view. Every position is set directly
 * (no smooth scrolling) and before paint by the callers' layout effects, so
 * the reader never sees an intermediate position.
 */

const GAP = 12

export function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null
  while (current) {
    const overflowY = globalThis.getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

/** Bottom edge of the sticky MR header inside the scroll container, in viewport coordinates. */
function contentTop(host: HTMLElement): number {
  const header = host.querySelector<HTMLElement>('[data-sticky-header="true"]')
  return header ? header.getBoundingClientRect().bottom : host.getBoundingClientRect().top
}

export function findNote(root: ParentNode, noteId: string | null | undefined): HTMLElement | null {
  if (!noteId) return null
  return Array.from(root.querySelectorAll<HTMLElement>('[data-note-id]')).find((element) => element.dataset.noteId === noteId) ?? null
}

/** Places the element's top just below the sticky header. */
export function scrollToTop(host: HTMLElement, element: HTMLElement): void {
  host.scrollTop += element.getBoundingClientRect().top - contentTop(host) - GAP
}

/** Scrolls only as far as needed to show the element below the sticky header. */
export function scrollToNearest(host: HTMLElement, element: HTMLElement): void {
  const rect = element.getBoundingClientRect()
  const top = contentTop(host)
  const bottom = host.getBoundingClientRect().bottom
  if (rect.top < top + GAP) host.scrollTop += rect.top - top - GAP
  else if (rect.bottom > bottom - GAP) host.scrollTop += Math.min(rect.bottom - bottom + GAP, rect.top - top - GAP)
}

/**
 * Opening position: the first unread comment when there is one, otherwise the
 * newest comment's thread with its end at the bottom of the view (or its top
 * under the header when the thread is taller than the view).
 */
export function positionAtLatest(host: HTMLElement, root: ParentNode, unreadNoteId: string | null, latestNoteId: string | null): void {
  const unread = findNote(root, unreadNoteId)
  if (unread) {
    scrollToTop(host, unread)
    return
  }
  const latest = findNote(root, latestNoteId)
  const thread = latest?.closest<HTMLElement>('[data-discussion-id]') ?? Array.from(root.querySelectorAll<HTMLElement>('[data-discussion-id]')).at(-1) ?? null
  if (!thread) return
  const rect = thread.getBoundingClientRect()
  const top = contentTop(host)
  const bottom = host.getBoundingClientRect().bottom
  host.scrollTop += rect.height + GAP * 2 > bottom - top ? rect.top - top - GAP : rect.bottom - bottom + GAP * 2
}

/** The first thread whose bottom is below the header, with its current offset; used to keep it still. */
export function captureAnchor(host: HTMLElement, root: ParentNode): { id: string; offset: number } | null {
  const top = contentTop(host)
  for (const element of root.querySelectorAll<HTMLElement>('[data-discussion-id]')) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom > top) return { id: element.dataset.discussionId ?? '', offset: rect.top - top }
  }
  return null
}

export function restoreAnchor(host: HTMLElement, root: ParentNode, anchor: { id: string; offset: number }): void {
  const element = Array.from(root.querySelectorAll<HTMLElement>('[data-discussion-id]')).find((item) => item.dataset.discussionId === anchor.id)
  if (!element) return
  const delta = element.getBoundingClientRect().top - contentTop(host) - anchor.offset
  if (Math.abs(delta) >= 1) host.scrollTop += delta
}
