import { describe, expect, it } from 'vitest'

import { captureAnchor, positionAtLatest, restoreAnchor } from './discussionScroll'

/**
 * A minimal scroll container: the sticky header is 100px tall, the viewport
 * is 600px tall and every element's document position is fixed, so its
 * viewport position follows `scrollTop` like in a browser.
 */
function setup(threads: Array<{ id: string; top: number; height: number; notes?: string[] }>) {
  const host = document.createElement('main')
  const header = document.createElement('header')
  header.dataset.stickyHeader = 'true'
  host.append(header)
  const rect = (top: number, height: number) => ({ bottom: top + height, height, left: 0, right: 0, top, width: 0, x: 0, y: top, toJSON: () => null }) as DOMRect
  host.getBoundingClientRect = () => rect(0, 600)
  header.getBoundingClientRect = () => rect(0, 100)
  for (const thread of threads) {
    const element = document.createElement('article')
    element.dataset.discussionId = thread.id
    element.getBoundingClientRect = () => rect(thread.top - host.scrollTop, thread.height)
    for (const noteId of thread.notes ?? []) {
      const note = document.createElement('div')
      note.dataset.noteId = noteId
      note.getBoundingClientRect = () => rect(thread.top + 20 - host.scrollTop, 40)
      element.append(note)
    }
    host.append(element)
  }
  let scrollTop = 0
  Object.defineProperty(host, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value } })
  return host
}

describe('discussion scroll positions', () => {
  it('opens at the first unread note just below the sticky header', () => {
    const host = setup([{ id: 'a', notes: ['n1'], top: 100, height: 200 }, { id: 'b', notes: ['n2'], top: 900, height: 200 }])
    positionAtLatest(host, host, 'n2', 'n2')
    expect(host.scrollTop).toBe(900 + 20 - 100 - 12)
  })

  it('otherwise ends the newest thread at the bottom of the view', () => {
    const host = setup([{ id: 'a', notes: ['n1'], top: 100, height: 200 }, { id: 'b', notes: ['n2'], top: 900, height: 200 }])
    positionAtLatest(host, host, null, 'n2')
    expect(host.scrollTop).toBe(1100 - 600 + 24)
  })

  it('keeps the thread at the top of the view still when older threads are inserted above', () => {
    const threads = [{ id: 'a', top: 100, height: 300 }, { id: 'b', top: 400, height: 300 }]
    const host = setup(threads)
    host.scrollTop = 350
    const anchor = captureAnchor(host, host)
    expect(anchor).toEqual({ id: 'b', offset: -50 })

    // An older page adds 800px above both threads.
    threads[0].top += 800
    threads[1].top += 800
    restoreAnchor(host, host, anchor!)
    expect(host.scrollTop).toBe(1150)
  })
})
