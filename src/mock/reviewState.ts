import type { MockAuthor, MockDiscussion, MockReply } from './fixtures'
import type { MockCommentPosition, MockCommentOptions, MockPendingComment } from './reviewTypes'

export const CURRENT_USER_HANDLE = '@otata'

let reviewIdSequence = 0

export function createReviewId(prefix: string) {
  reviewIdSequence += 1
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : `local${reviewIdSequence}`
  return `${prefix}-${reviewIdSequence}-${randomId}`
}

export function clonePosition(position?: MockCommentPosition) {
  return position ? { ...position } : undefined
}

export function cloneReply(reply: MockReply): MockReply {
  return { ...reply, author: { ...reply.author } }
}

export function cloneDiscussion(discussion: MockDiscussion): MockDiscussion {
  return {
    ...discussion,
    author: { ...discussion.author },
    position: clonePosition(discussion.position),
    replies: discussion.replies.map(cloneReply),
  }
}

export function cloneDiscussions(discussions: MockDiscussion[]) {
  return discussions.map(cloneDiscussion)
}

function positionKey(position: MockCommentPosition) {
  return JSON.stringify([position.scope, position.sha, position.path, position.side, position.line ?? null, position.endLine ?? null])
}

export function getReviewDraftKey(mergeRequestId: string, replyTarget?: string, position?: MockCommentPosition) {
  if (replyTarget) return `${mergeRequestId}:reply:${replyTarget}`
  if (position) return `${mergeRequestId}:position:${positionKey(position)}`
  return `${mergeRequestId}:comment`
}

export function canEditReviewNote(note: { author: MockAuthor }, body: string) {
  return note.author.handle === CURRENT_USER_HANDLE && Boolean(body.trim())
}

function newAuthor(): MockAuthor {
  return { name: '自分', handle: CURRENT_USER_HANDLE, initials: 'OT' }
}

function appendDiscussion(
  discussions: MockDiscussion[],
  pending: Pick<MockPendingComment, 'body' | 'kind' | 'position' | 'resolution'>,
  author: MockAuthor = newAuthor(),
) {
  const discussion: MockDiscussion = {
    id: createReviewId('discussion'),
    author: { ...author },
    body: pending.body.trim(),
    createdAt: 'たった今',
    file: pending.position?.path,
    line: pending.position?.line,
    state: pending.kind === 'thread' && pending.resolution ? pending.resolution : 'open',
    replies: [],
    kind: pending.kind,
    position: clonePosition(pending.position),
  }
  discussions.push(discussion)
  return discussion
}

export function appendImmediateComment(
  discussions: MockDiscussion[],
  body: string,
  options: MockCommentOptions,
  position?: MockCommentPosition,
) {
  if (!body.trim()) return undefined
  const kind = position || options.kind === 'thread' ? 'thread' : 'comment'
  return appendDiscussion(discussions, { body, kind, position, resolution: kind === 'thread' ? options.resolution : undefined })
}

export function appendImmediateReply(discussions: MockDiscussion[], discussionId: string, body: string, resolution?: MockPendingComment['resolution']) {
  if (!body.trim()) return undefined
  const discussion = discussions.find((candidate) => candidate.id === discussionId)
  if (!discussion) return undefined
  const reply: MockReply = {
    id: createReviewId('reply'),
    author: newAuthor(),
    body: body.trim(),
    createdAt: 'たった今',
  }
  discussion.replies = [...discussion.replies, reply]
  discussion.kind = 'thread'
  if (resolution) discussion.state = resolution
  return reply
}

function appendPending(discussions: MockDiscussion[], pending: MockPendingComment) {
  if (!pending.body.trim()) return
  if (pending.replyTo) {
    appendImmediateReply(discussions, pending.replyTo, pending.body, pending.resolution)
    return
  }
  appendDiscussion(discussions, pending, newAuthor())
}

export function publishPendingComments(discussions: MockDiscussion[], pending: MockPendingComment[], summary?: string) {
  const next = cloneDiscussions(discussions)
  for (const item of pending) appendPending(next, item)
  if (summary?.trim()) appendDiscussion(next, { body: summary, kind: 'comment' })
  return next
}

export function removePendingReplies(pending: MockPendingComment[], rootId: string) {
  return pending.filter((item) => item.replyTo !== rootId)
}

export function removeDiscussionOrTombstone(discussions: MockDiscussion[], discussionId: string) {
  const target = discussions.find((discussion) => discussion.id === discussionId)
  if (!target) return discussions
  if (target.replies.length === 0) return discussions.filter((discussion) => discussion.id !== discussionId)
  target.deleted = true
  target.body = ''
  target.edited = undefined
  return discussions
}
