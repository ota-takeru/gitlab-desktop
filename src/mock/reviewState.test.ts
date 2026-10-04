import { describe, expect, it } from 'vitest'

import { mockMergeRequests } from './fixtures'
import {
  appendImmediateReply,
  getReviewDraftKey,
  publishPendingComments,
  removeDiscussionOrTombstone,
} from './reviewState'
import type { MockCommentPosition, MockPendingComment } from './reviewTypes'

const position = (overrides: Partial<MockCommentPosition> = {}): MockCommentPosition => ({
  path: 'src/lib/review-cache.ts',
  side: 'new',
  line: 4,
  sha: 'b7c2e81',
  scope: 'overall',
  ...overrides,
})

describe('review state helpers', () => {
  it('keeps drafts distinct across version, side and line targets', () => {
    const base = getReviewDraftKey('platform-desktop!42', undefined, position())

    expect(getReviewDraftKey('platform-desktop!42', undefined, position({ side: 'old' }))).not.toBe(base)
    expect(getReviewDraftKey('platform-desktop!42', undefined, position({ line: 5 }))).not.toBe(base)
    expect(getReviewDraftKey('platform-desktop!42', undefined, position({ sha: 'a3f91d2' }))).not.toBe(base)
    expect(getReviewDraftKey('platform-desktop!42', 'cache-d1')).not.toBe(base)
  })

  it('publishes queued roots, replies, resolution and summary in order', () => {
    const discussions = mockMergeRequests[0].discussions
    const pending: MockPendingComment[] = [
      { id: 'pending-root', body: '保留したスレッド', kind: 'thread', position: position(), resolution: 'open' },
      { id: 'pending-reply', body: '返信と解決', kind: 'thread', replyTo: 'cache-d1', resolution: 'resolved' },
    ]

    const next = publishPendingComments(discussions, pending, 'レビュー概要')

    expect(next.at(-2)?.body).toBe('保留したスレッド')
    expect(next.at(-1)?.body).toBe('レビュー概要')
    expect(next.find((discussion) => discussion.id === 'cache-d1')?.state).toBe('resolved')
    expect(next.find((discussion) => discussion.id === 'cache-d1')?.replies.at(-1)?.body).toBe('返信と解決')
    expect(discussions.find((discussion) => discussion.id === 'cache-d1')?.replies).toHaveLength(1)
  })

  it('retains replies as a tombstone and permits a surviving reply', () => {
    const discussions = mockMergeRequests[0].discussions
    const root = discussions.find((discussion) => discussion.id === 'cache-d1')
    if (!root) throw new Error('fixture root missing')

    const next = removeDiscussionOrTombstone(discussions.map((discussion) => ({ ...discussion, replies: [...discussion.replies] })), root.id)
    const tombstone = next.find((discussion) => discussion.id === root.id)
    expect(tombstone?.deleted).toBe(true)
    expect(tombstone?.body).toBe('')
    expect(tombstone?.replies).toHaveLength(1)

    const reply = appendImmediateReply(next, root.id, '削除後も残るスレッド返信')
    expect(reply?.body).toBe('削除後も残るスレッド返信')
    expect(next.find((discussion) => discussion.id === root.id)?.replies).toHaveLength(2)
  })
})
