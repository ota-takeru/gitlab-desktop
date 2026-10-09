import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from '../../theme'
import type { Discussion, GitLabUser, Note } from '../../types/gitlab'
import type { Position } from '../../types/gitlab'
import { DiscussionList, type OlderDiscussions } from './DiscussionList'

const currentUser: GitLabUser = { id: 'user-1', name: '自分', username: 'reviewer' }
const otherUser: GitLabUser = { id: 'user-2', name: '他の人', username: 'colleague' }

function createNote(id: string, author: GitLabUser, overrides: Partial<Note> = {}): Note {
  return {
    author,
    body: `${id} の本文`,
    createdAt: '2026-01-01T00:00:00.000Z',
    id,
    position: null,
    resolvable: false,
    resolved: false,
    system: false,
    ...overrides,
  }
}

function createDiscussion(notes: Note[], id = 'discussion-1'): Discussion {
  return { id, individualNote: false, notes }
}

function renderList(
  discussions: Discussion[],
  callbacks: {
    onDelete?: (note: Note) => Promise<boolean>
    onEdit?: (note: Note, body: string) => Promise<boolean>
    onMarkRead?: (notes: Note[]) => void
    onOpenPosition?: (position: Position) => void
    onReply?: (discussion: Discussion) => void
    onResolve?: (discussion: Discussion, resolved: boolean) => Promise<boolean>
    replyDiscussionId?: string
    unreadNoteIds?: string[]
  } = {},
) {
  return render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <DiscussionList
        currentUserId={currentUser.id}
        discussions={discussions}
        onMarkRead={callbacks.onMarkRead}
        onOpenPosition={callbacks.onOpenPosition}
        replyDiscussionId={callbacks.replyDiscussionId}
        unreadNoteIds={callbacks.unreadNoteIds}
        onDelete={callbacks.onDelete ?? vi.fn().mockResolvedValue(true)}
        onEdit={callbacks.onEdit ?? vi.fn().mockResolvedValue(true)}
        onReply={callbacks.onReply ?? vi.fn()}
        onResolve={callbacks.onResolve ?? vi.fn().mockResolvedValue(true)}
      />
    </ThemeProvider>,
  )
}

describe('DiscussionList note ownership and resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.confirm = vi.fn(() => true)
  })

  it('shows edit/delete controls for an owned reply, but hides them for other authors', () => {
    const ownedReply = createNote('reply-owned', currentUser)
    const otherRoot = createNote('root-other', otherUser)
    const otherReply = createNote('reply-other', otherUser)

    renderList([createDiscussion([otherRoot, ownedReply, otherReply])])

    expect(screen.getByRole('button', { name: 'reply-ownedを編集' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reply-ownedを削除' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'root-otherを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'root-otherを削除' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'reply-otherを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'reply-otherを削除' })).not.toBeInTheDocument()
  })

  it('passes the edited reply body and note to onEdit', async () => {
    const ownedReply = createNote('reply-owned', currentUser, { body: '元の返信' })
    const onEdit = vi.fn().mockResolvedValue(true)
    renderList([createDiscussion([createNote('root-other', otherUser), ownedReply])], { onEdit })

    fireEvent.click(screen.getByRole('button', { name: 'reply-ownedを編集' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '更新した返信' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(ownedReply, '更新した返信'))
  })

  it('shows resolve for partially unresolved notes and reopen when all are resolved', async () => {
    const resolvedRoot = createNote('root', otherUser, { resolvable: true, resolved: true })
    const unresolvedReply = createNote('reply', currentUser, { resolvable: true, resolved: false })
    const systemNote = createNote('system', otherUser, { resolvable: false, resolved: false, system: true })
    const discussion = createDiscussion([resolvedRoot, unresolvedReply, systemNote])
    const onResolve = vi.fn().mockResolvedValue(true)
    const view = renderList([discussion], { onResolve })

    fireEvent.click(screen.getByRole('button', { name: '未解決（解決済みにする）' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(discussion, true))
    expect(screen.queryByRole('button', { name: '解決済み（未解決に戻す）' })).not.toBeInTheDocument()

    onResolve.mockClear()
    const allResolved = createDiscussion([
      { ...resolvedRoot, resolved: true },
      { ...unresolvedReply, resolved: true },
      systemNote,
    ])
    view.rerender(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <DiscussionList
          currentUserId={currentUser.id}
          discussions={[allResolved]}
          onDelete={vi.fn().mockResolvedValue(true)}
          onEdit={vi.fn().mockResolvedValue(true)}
          onReply={vi.fn()}
          onResolve={onResolve}
        />
      </ThemeProvider>,
    )

    expect(screen.getByRole('button', { name: '解決済み（未解決に戻す）' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未解決（解決済みにする）' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '解決済み（未解決に戻す）' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(allResolved, false))
  })

  it('hides system-only discussions and shows the comment-specific empty state', () => {
    const historyOnly = createDiscussion([
      createNote('history-only', otherUser, { body: '表示してはいけない履歴', system: true }),
    ])

    renderList([historyOnly])

    expect(screen.getByText('表示できるコメントはありません。')).toBeInTheDocument()
    expect(screen.queryByText('表示してはいけない履歴')).not.toBeInTheDocument()
    expect(screen.queryByText(/議論 \d/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ノート \d/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '次の議論ページ' })).not.toBeInTheDocument()
  })

  it('hides history in mixed discussions and sends the original discussion to actions', async () => {
    const history = createNote('history-first', otherUser, { body: '表示してはいけない履歴', system: true })
    const comment = createNote('visible-comment', otherUser, { resolvable: true })
    const discussion = createDiscussion([history, comment])
    const onReply = vi.fn()
    const onResolve = vi.fn().mockResolvedValue(true)

    renderList([discussion], { onReply, onResolve })

    expect(screen.getByText('visible-comment の本文')).toBeInTheDocument()
    expect(screen.queryByText('表示してはいけない履歴')).not.toBeInTheDocument()
    expect(screen.queryByText('システム')).not.toBeInTheDocument()
    expect(screen.queryByText(/1–1 \/ 1/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'discussion-1の次のノートページ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '次の議論ページ' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返信' }))
    await waitFor(() => expect(onReply).toHaveBeenCalledWith(discussion))
    fireEvent.click(screen.getByRole('button', { name: '未解決（解決済みにする）' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(discussion, true))
  })

  it('shows every loaded discussion with comments and hides history-only threads', () => {
    const comments = Array.from({ length: 21 }, (_, index) => createDiscussion([
      createNote(`comment-${index + 1}`, otherUser),
    ], `comment-discussion-${index + 1}`))
    const history = Array.from({ length: 25 }, (_, index) => createDiscussion([
      createNote(`history-${index + 1}`, otherUser, { body: `隠す履歴 ${index + 1}`, system: true }),
    ], `history-discussion-${index + 1}`))

    renderList([...history, ...comments])

    expect(screen.getByText('comment-1 の本文')).toBeInTheDocument()
    expect(screen.getByText('comment-21 の本文')).toBeInTheDocument()
    expect(screen.queryByText('隠す履歴 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '次の議論ページ' })).not.toBeInTheDocument()
  })

  it('does not count hidden history notes toward note pagination', () => {
    const visibleNotes = [createNote('comment-root', otherUser), createNote('comment-reply', currentUser)]
    const historyNotes = Array.from({ length: 60 }, (_, index) => createNote(`history-note-${index + 1}`, otherUser, {
      body: `隠すノート ${index + 1}`,
      system: true,
    }))

    renderList([createDiscussion([...historyNotes, ...visibleNotes])])

    expect(screen.getByText('comment-root の本文')).toBeInTheDocument()
    expect(screen.getByText('comment-reply の本文')).toBeInTheDocument()
    expect(screen.queryByText('隠すノート 1')).not.toBeInTheDocument()
    expect(screen.queryByText(/1–2 \/ 2/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'discussion-1の次のノートページ' })).not.toBeInTheDocument()
  })

  it('filters resolved discussions and keeps their collapsed comments expandable', () => {
    const resolved = createDiscussion([createNote('resolved-note', otherUser, { resolvable: true, resolved: true })], 'resolved')
    const unresolved = createDiscussion([createNote('unresolved-note', otherUser, { resolvable: true })], 'unresolved')

    renderList([resolved, unresolved])

    expect(screen.queryByText('resolved-note の本文')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '内容を表示' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '未解決' }))
    expect(screen.queryByText('resolved-note の本文')).not.toBeInTheDocument()
    expect(screen.getByText('unresolved-note の本文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }))
    fireEvent.click(screen.getByRole('button', { name: '内容を表示' }))
    expect(screen.getByText('resolved-note の本文')).toBeInTheDocument()
  })

  it('jumps to the chronologically earliest unread and latest notes across loaded pages', () => {
    const discussions = Array.from({ length: 21 }, (_, index) => createDiscussion([
      createNote(`dated-${index + 1}`, otherUser, {
        createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        resolvable: true,
      }),
    ], `dated-discussion-${index + 1}`))
    discussions[0] = createDiscussion([
      createNote('chronologically-latest', otherUser, { createdAt: '2026-04-01T00:00:00.000Z', resolvable: true }),
    ], 'dated-discussion-1')
    const onMarkRead = vi.fn()

    renderList(discussions, { onMarkRead, unreadNoteIds: ['dated-21', 'chronologically-latest'] })

    fireEvent.click(screen.getByRole('button', { name: /未読へ/ }))
    expect(screen.getByText('dated-21 の本文')).toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute('data-note-id', 'dated-21')

    fireEvent.click(screen.getByRole('button', { name: '最新へ' }))
    expect(screen.getByText('chronologically-latest の本文')).toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute('data-note-id', 'chronologically-latest')
  })

  it('marks only visible, uncollapsed page notes through the explicit read action', () => {
    const notes = Array.from({ length: 61 }, (_, index) => createNote(`read-${index + 1}`, otherUser))
    const onMarkRead = vi.fn()
    renderList([createDiscussion(notes)], { onMarkRead, unreadNoteIds: notes.map((note) => note.id) })

    fireEvent.click(screen.getByRole('button', { name: '表示中を既読' }))

    expect(onMarkRead).toHaveBeenCalledTimes(1)
    expect(onMarkRead.mock.calls[0][0]).toHaveLength(50)
    expect(onMarkRead.mock.calls[0][0].map((note: Note) => note.id)).toEqual(notes.slice(0, 50).map((note) => note.id))
  })

  it('sends a positioned comment location to the diff navigation callback', () => {
    const position: Position = { baseSha: 'base', headSha: 'head', newLine: 7, newPath: 'src/file.ts', oldPath: 'src/file.ts', positionType: 'text', startSha: 'start' }
    const note = createNote('positioned', otherUser, { position })
    const onOpenPosition = vi.fn()
    renderList([createDiscussion([note])], { onOpenPosition })

    fireEvent.click(screen.getByRole('button', { name: '差分へ移動: src/file.ts:7' }))

    expect(onOpenPosition).toHaveBeenCalledWith(position)
  })

  it('keeps the filter fixed while editing or replying to a discussion', () => {
    const discussion = createDiscussion([createNote('reply-target', otherUser)], 'target')
    const view = renderList([discussion], { replyDiscussionId: discussion.id })

    expect(screen.getByRole('button', { name: 'すべて' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '未解決' })).toBeDisabled()
    view.unmount()

    renderList([createDiscussion([createNote('owned-note', currentUser)], 'owned')])
    fireEvent.click(screen.getByRole('button', { name: 'owned-noteを編集' }))
    expect(screen.getByRole('button', { name: 'すべて' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '未解決' })).toBeDisabled()
  })

  it('offers older discussions above the loaded ones and reports loading, errors and the limit', () => {
    const discussions = [createDiscussion([createNote('newest-page-note', otherUser)], 'newest')]
    const onLoad = vi.fn()
    const onRetry = vi.fn()
    const older: OlderDiscussions = { error: null, hasOlder: true, limitReached: false, loading: false, onLoad, onRetry }
    const view = render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <DiscussionList currentUserId={currentUser.id} discussions={discussions} older={older} onDelete={vi.fn()} onEdit={vi.fn()} onReply={vi.fn()} onResolve={vi.fn()} />
      </ThemeProvider>,
    )
    const rerender = (next: typeof older) => view.rerender(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <DiscussionList currentUserId={currentUser.id} discussions={discussions} older={next} onDelete={vi.fn()} onEdit={vi.fn()} onReply={vi.fn()} onResolve={vi.fn()} />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '以前の議論を読み込む' }))
    expect(onLoad).toHaveBeenCalledTimes(1)

    rerender({ ...older, loading: true })
    expect(screen.getByRole('status')).toHaveTextContent('以前の議論を読み込み中…')

    rerender({ ...older, error: 'network down' })
    expect(screen.getByText('以前の議論を読み込めませんでした: network down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender({ ...older, hasOlder: false, limitReached: true })
    expect(screen.getByText('読み込み上限に達しました。これより前の議論はGitLabで確認してください。')).toBeInTheDocument()
    expect(screen.getByText('newest-page-note の本文')).toBeInTheDocument()
  })

  it('limits notes to fifty rows and makes the final note page reachable', () => {
    const notes = Array.from({ length: 200 }, (_, index) => createNote(`note-${index + 1}`, otherUser))
    const discussion = createDiscussion(notes)

    renderList([discussion])

    expect(screen.getByText('note-1 の本文')).toBeInTheDocument()
    expect(screen.queryByText('note-51 の本文')).not.toBeInTheDocument()
    expect(screen.getByText('コメント 1–50 / 200')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返信' })).toBeInTheDocument()

    const nextPage = screen.getByRole('button', { name: 'discussion-1の次のノートページ' })
    fireEvent.click(nextPage)
    fireEvent.click(nextPage)
    fireEvent.click(nextPage)

    expect(screen.queryByText('note-1 の本文')).not.toBeInTheDocument()
    expect(screen.getByText('note-151 の本文')).toBeInTheDocument()
    expect(screen.getByText('note-200 の本文')).toBeInTheDocument()
    expect(screen.getByText('コメント 151–200 / 200')).toBeInTheDocument()
    expect(nextPage).toBeDisabled()
  })

  it('preserves edited text when save fails', async () => {
    const ownedNote = createNote('owned-note', currentUser, { body: '編集前の本文' })
    const discussions = [
      createDiscussion([ownedNote], 'discussion-1'),
      ...Array.from({ length: 20 }, (_, index) => createDiscussion([createNote(`other-${index + 1}`, otherUser)], `discussion-${index + 2}`)),
    ]
    const onEdit = vi.fn().mockRejectedValue(new Error('private save failure'))

    renderList(discussions, { onEdit })

    fireEvent.click(screen.getByRole('button', { name: 'owned-noteを編集' }))

    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: '編集後も残る本文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(ownedNote, '編集後も残る本文'))
    expect(screen.getByRole('textbox')).toHaveValue('編集後も残る本文')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('follows shrinking discussions and clamps the note page when notes shrink', () => {
    const discussions = Array.from({ length: 41 }, (_, index) => {
      const discussionNumber = index + 1
      return createDiscussion([createNote(`discussion-${discussionNumber}-note`, otherUser)], `discussion-${discussionNumber}`)
    })
    const view = renderList(discussions)
    expect(screen.getByText('discussion-41-note の本文')).toBeInTheDocument()

    const shrunkDiscussions = discussions.slice(0, 3)
    view.rerender(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <DiscussionList
          currentUserId={currentUser.id}
          discussions={shrunkDiscussions}
          onDelete={vi.fn().mockResolvedValue(true)}
          onEdit={vi.fn().mockResolvedValue(true)}
          onReply={vi.fn()}
          onResolve={vi.fn().mockResolvedValue(true)}
        />
      </ThemeProvider>,
    )

    expect(screen.getByText('discussion-1-note の本文')).toBeInTheDocument()
    expect(screen.getByText('discussion-3-note の本文')).toBeInTheDocument()
    expect(screen.queryByText('discussion-41-note の本文')).not.toBeInTheDocument()
    expect(screen.queryByText('議論 1–3 / 3')).not.toBeInTheDocument()

    const manyNotes = Array.from({ length: 101 }, (_, index) => createNote(`shrinking-note-${index + 1}`, otherUser))
    const notesView = renderList([createDiscussion(manyNotes)])
    const noteNextPage = screen.getByRole('button', { name: 'discussion-1の次のノートページ' })
    fireEvent.click(noteNextPage)
    fireEvent.click(noteNextPage)

    notesView.rerender(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <DiscussionList
          currentUserId={currentUser.id}
          discussions={[createDiscussion([manyNotes[0]])]}
          onDelete={vi.fn().mockResolvedValue(true)}
          onEdit={vi.fn().mockResolvedValue(true)}
          onReply={vi.fn()}
          onResolve={vi.fn().mockResolvedValue(true)}
        />
      </ThemeProvider>,
    )

    expect(screen.getByText('shrinking-note-1 の本文')).toBeInTheDocument()
    expect(screen.queryByText('shrinking-note-101 の本文')).not.toBeInTheDocument()
  })
})
