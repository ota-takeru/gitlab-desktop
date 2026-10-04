/** UI-only review contracts. No GitLab request or persisted credential data. */
export interface MockCommentPosition {
  path: string
  side: 'old' | 'new'
  line?: number
  endLine?: number
  sha: string
  scope: 'overall' | 'commit'
}

export interface MockCommentOptions {
  kind: 'comment' | 'thread'
  resolution?: 'open' | 'resolved'
}

export interface MockPendingComment {
  id: string
  body: string
  kind: 'comment' | 'thread'
  position?: MockCommentPosition
  replyTo?: string
  replyAuthor?: string
  resolution?: 'open' | 'resolved'
}

export interface MockReviewActions {
  pending: MockPendingComment[]
  position?: MockCommentPosition
  onStartLineComment: (position: MockCommentPosition) => void
  onCancelPosition: () => void
  onAddToReview: (options?: MockCommentOptions) => void
  onEditNote: (discussionId: string, body: string, replyId?: string) => void
  onDeleteNote: (discussionId: string, replyId?: string) => void
  onEditPending: (id: string, body: string) => void
  onDeletePending: (id: string) => void
  onDiscardReview: () => void
  onPublishReview: (summary: string, approve: boolean) => void
}
