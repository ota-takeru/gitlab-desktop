import { findScrollContainer } from './discussionScroll'

/** A waiting thread this far outside the view is mounted before the reader scrolls to it. */
const NEAR_VIEW = '1000px 0px'

export interface ThreadRevealQueue {
  /** Starts waiting; returns what ends it, which also lets the next thread go. */
  add: (element: HTMLElement, reveal: () => void) => () => void
  /**
   * Nothing is mounted before this: the opening position is set while only the threads it needs are there.
   * `onEmpty` runs each time no thread is left waiting.
   */
  start: (onEmpty: () => void) => void
}

/**
 * Mounts waiting threads one at a time, each after the last has committed, so that the
 * rest of a long discussion arrives between frames. Threads near the view go first, then
 * from the end of the list, where the newest threads are.
 */
export function createThreadRevealQueue(): ThreadRevealQueue {
  const waiting = new Map<HTMLElement, () => void>()
  const near = new Set<Element>()
  let observer: IntersectionObserver | null = null
  let started = false
  let whenEmpty: (() => void) | null = null
  let revealing: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const step = () => {
    timer = null
    const elements = [...waiting.keys()]
    const next = elements.find((element) => near.has(element)) ?? elements.at(-1)
    if (!next) return
    revealing = next
    waiting.get(next)?.()
  }
  const schedule = () => {
    if (!started || revealing || timer !== null) return
    if (waiting.size) timer = setTimeout(step)
    else whenEmpty?.()
  }
  return {
    add(element, reveal) {
      observer ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) near.add(entry.target)
          else near.delete(entry.target)
        }
      }, { root: findScrollContainer(element), rootMargin: NEAR_VIEW })
      observer.observe(element)
      waiting.set(element, reveal)
      schedule()
      return () => {
        observer?.unobserve(element)
        near.delete(element)
        waiting.delete(element)
        if (revealing === element) revealing = null
        schedule()
      }
    },
    start(onEmpty) {
      started = true
      whenEmpty = onEmpty
      schedule()
    },
  }
}
