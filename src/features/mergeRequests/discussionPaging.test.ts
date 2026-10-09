import { describe, expect, it } from 'vitest'

import type { Discussion, Note } from '../../types/gitlab'
import { mergeDiscussionPages } from './discussionPaging'

function makeDiscussion(id: string, body: string): Discussion {
  const note: Note = {
    author: { id: '42', name: 'Reviewer', username: 'reviewer' },
    body,
    createdAt: '2026-01-01T00:00:00.000Z',
    id: `${id}-note`,
    position: null,
    resolvable: false,
    resolved: false,
    system: false,
  }
  return { id, individualNote: false, notes: [note] }
}

describe('mergeDiscussionPages', () => {
  it('deduplicates discussion ids across pages and keeps the current page snapshot', () => {
    const pageOne = [makeDiscussion('discussion-1', 'older body'), makeDiscussion('discussion-2', 'second')]
    const currentPage = [makeDiscussion('discussion-1', 'updated on the current page'), makeDiscussion('discussion-3', 'third')]

    const merged = mergeDiscussionPages({ 2: currentPage, 1: pageOne })

    expect(merged.map((discussion) => discussion.id)).toEqual(['discussion-1', 'discussion-2', 'discussion-3'])
    expect(merged[0].notes[0].body).toBe('updated on the current page')
  })

  it('caps the accumulated list at 300 unique discussions', () => {
    const firstPage = Array.from({ length: 250 }, (_, index) => makeDiscussion(`discussion-${index + 1}`, `page one ${index + 1}`))
    const secondPage = [
      makeDiscussion('discussion-1', 'updated duplicate'),
      ...Array.from({ length: 51 }, (_, index) => makeDiscussion(`discussion-${index + 251}`, `page two ${index + 251}`)),
    ]

    const merged = mergeDiscussionPages({ 1: firstPage, 2: secondPage })

    expect(merged).toHaveLength(300)
    expect(merged[0].notes[0].body).toBe('updated duplicate')
    expect(merged.at(-1)?.id).toBe('discussion-300')
    expect(merged.some((discussion) => discussion.id === 'discussion-301')).toBe(false)
  })
})
