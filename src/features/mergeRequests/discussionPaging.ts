import type { Discussion } from '../../types/gitlab'

export function mergeDiscussionPages(pages: Record<number, Discussion[]>): Discussion[] {
  const merged = new Map<string, Discussion>()
  for (const page of Object.keys(pages).map(Number).sort((left, right) => left - right)) {
    for (const discussion of pages[page]) merged.set(discussion.id, discussion)
  }
  return [...merged.values()].slice(0, 300)
}
