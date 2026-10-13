export type PersonalQueue = 'waiting' | 'assigned' | 'created'

const queueParamKeys = new Set(['orderBy', 'page', 'search', 'sort', 'state'])

/**
 * The personal queue a list location shows: exactly one condition on the
 * connected user, plus text, state and order. Any further condition makes it
 * an MR search, so a queue's tab never applies conditions it does not show.
 */
export function personalQueueFor(params: Record<string, string>, currentUserId: string | undefined): PersonalQueue | null {
  const queue: PersonalQueue | null = params.assignee === 'self' ? 'assigned' : params.reviewer === 'self' ? 'waiting' : currentUserId && params.authorId === currentUserId ? 'created' : null
  if (!queue) return null
  const own = queue === 'assigned' ? 'assignee' : queue === 'waiting' ? 'reviewer' : 'authorId'
  return Object.entries(params).every(([key, value]) => key === own || queueParamKeys.has(key) || value === '') ? queue : null
}
