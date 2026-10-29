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

  it('keeps the first visible comment still when its thread grows above it', () => {
    const host = setup([{ id: 'a', top: 100, height: 1000 }])
    const thread = host.querySelector<HTMLElement>('[data-discussion-id="a"]')!
    const notes = [{ id: 'n1', top: 100, height: 400 }, { id: 'n2', top: 500, height: 400 }]
    for (const item of notes) {
      const note = document.createElement('li')
      note.dataset.noteId = item.id
      note.getBoundingClientRect = () => ({ bottom: item.top + item.height - host.scrollTop, height: item.height, left: 0, right: 0, top: item.top - host.scrollTop, width: 0, x: 0, y: item.top - host.scrollTop, toJSON: () => null }) as DOMRect
      thread.append(note)
    }
    host.scrollTop = 450
    const anchor = captureAnchor(host, host)
    expect(anchor).toEqual({ id: 'a', noteId: 'n2', offset: -50 })

    // An image in the first comment loads and pushes the second one down by 300px.
    notes[0].height += 300
    notes[1].top += 300
    restoreAnchor(host, host, anchor!)
    expect(host.scrollTop).toBe(750)
  })
})
