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

/**
 * Bottom edge of the sticky MR header inside the scroll container, in viewport coordinates.
 * The header can be carried out of view: while a tab fades in over the one before it, the header's
 * parent is only as tall as the tab before. Where it sticks is then still where the content starts.
 */
function contentTop(host: HTMLElement): number {
  const hostTop = host.getBoundingClientRect().top
  const header = host.querySelector<HTMLElement>('[data-sticky-header="true"]')
  if (!header) return hostTop
  return Math.max(header.getBoundingClientRect().bottom, hostTop + header.offsetHeight)
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
 * under the header when the thread is taller than the view). Returns what it placed.
 */
export function positionAtLatest(host: HTMLElement, root: ParentNode, unreadNoteId: string | null, latestNoteId: string | null): HTMLElement | null {
  const unread = findNote(root, unreadNoteId)
  if (unread) {
    scrollToTop(host, unread)
    return unread
  }
  const latest = findNote(root, latestNoteId)
  const thread = latest?.closest<HTMLElement>('[data-discussion-id]') ?? Array.from(root.querySelectorAll<HTMLElement>('[data-discussion-id]')).at(-1) ?? null
  if (!thread) return null
  const rect = thread.getBoundingClientRect()
  const top = contentTop(host)
  const bottom = host.getBoundingClientRect().bottom
  host.scrollTop += rect.height + GAP * 2 > bottom - top ? rect.top - top - GAP : rect.bottom - bottom + GAP * 2
  return thread
}

/** A thread or comment with its current offset, to keep it still whatever else is in view. */
export function anchorAt(host: HTMLElement, element: HTMLElement): ScrollAnchor | null {
  const id = element.closest<HTMLElement>('[data-discussion-id]')?.dataset.discussionId
  return id ? { id, noteId: element.dataset.noteId, offset: element.getBoundingClientRect().top - contentTop(host) } : null
}

export interface ScrollAnchor { id: string; offset: number; noteId?: string }

/**
 * The first thread whose bottom is below the header, with its current offset; used to keep it still.
 * Within an open thread the first such comment is kept instead, so growth above it in the same
 * thread (a late image, an expanded comment) does not move what is being read.
 */
export function captureAnchor(host: HTMLElement, root: ParentNode): ScrollAnchor | null {
  const top = contentTop(host)
  for (const element of root.querySelectorAll<HTMLElement>('[data-discussion-id]')) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom <= top) continue
    const id = element.dataset.discussionId ?? ''
    for (const note of element.querySelectorAll<HTMLElement>('[data-note-id]')) {
      const noteRect = note.getBoundingClientRect()
      if (noteRect.bottom > top) return { id, noteId: note.dataset.noteId, offset: noteRect.top - top }
    }
    return { id, offset: rect.top - top }
  }
  return null
}

/** The discussion of the first thread under a diff line that is on screen, below the header. */
export function firstDiffThreadInView(host: HTMLElement, root: ParentNode): string | null {
  const top = contentTop(host)
  const bottom = host.getBoundingClientRect().bottom
  for (const element of root.querySelectorAll<HTMLElement>('[data-diff-thread]')) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom > top && rect.top < bottom) return element.dataset.diffThread ?? null
  }
  return null
}

export function restoreAnchor(host: HTMLElement, root: ParentNode, anchor: ScrollAnchor): void {
  const thread = Array.from(root.querySelectorAll<HTMLElement>('[data-discussion-id]')).find((item) => item.dataset.discussionId === anchor.id)
  if (!thread) return
  // A comment folded away since leaves its thread as the anchor (not exact, but close).
  const element = (anchor.noteId ? findNote(thread, anchor.noteId) : null) ?? thread
  const delta = element.getBoundingClientRect().top - contentTop(host) - anchor.offset
  if (Math.abs(delta) >= 1) host.scrollTop += delta
}
