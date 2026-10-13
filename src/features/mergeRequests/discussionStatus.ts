import type { Discussion } from '../../types/gitlab'

/** A thread with resolvable comments that are not all resolved; the discussion tab counts these. */
export function isUnresolvedDiscussion(discussion: Discussion): boolean {
  const resolvable = discussion.notes.filter((note) => note.resolvable && !note.system)
  return resolvable.length > 0 && !resolvable.every((note) => note.resolved)
}
