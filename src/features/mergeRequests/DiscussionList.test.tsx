import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from '../../theme'
import type { Discussion, GitLabUser, Note } from '../../types/gitlab'
import { DiscussionList } from './DiscussionList'

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
    onReply?: (discussion: Discussion) => void
    onResolve?: (discussion: Discussion, resolved: boolean) => Promise<boolean>
  } = {},
) {
  return render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <DiscussionList
        currentUserId={currentUser.id}
        discussions={discussions}
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

    fireEvent.click(screen.getByRole('button', { name: '解決' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(discussion, true))
    expect(screen.queryByRole('button', { name: '再開' })).not.toBeInTheDocument()

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

    expect(screen.getByRole('button', { name: '再開' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '解決' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再開' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(allResolved, false))
  })

  it('limits discussion rows to twenty and makes the final page reachable', () => {
    const discussions = Array.from({ length: 101 }, (_, index) => {
      const discussionNumber = index + 1
      return createDiscussion([createNote(`discussion-${discussionNumber}-note`, otherUser)], `discussion-${discussionNumber}`)
    })

    renderList(discussions)

    expect(screen.getByText('discussion-1-note の本文')).toBeInTheDocument()
    expect(screen.queryByText('discussion-21-note の本文')).not.toBeInTheDocument()
    expect(screen.getByText('議論 1–20 / 101')).toBeInTheDocument()

    const nextPage = screen.getByRole('button', { name: '次の議論ページ' })
    for (let page = 2; page <= 6; page += 1) {
      fireEvent.click(nextPage)
    }

    expect(screen.queryByText('discussion-1-note の本文')).not.toBeInTheDocument()
    expect(screen.getByText('discussion-101-note の本文')).toBeInTheDocument()
    expect(screen.getByText('議論 101–101 / 101')).toBeInTheDocument()
    expect(nextPage).toBeDisabled()
  })

  it('limits notes to fifty rows and makes the final note page reachable', () => {
    const notes = Array.from({ length: 200 }, (_, index) => createNote(`note-${index + 1}`, otherUser))
    const discussion = createDiscussion(notes)

    renderList([discussion])

    expect(screen.getByText('note-1 の本文')).toBeInTheDocument()
    expect(screen.queryByText('note-51 の本文')).not.toBeInTheDocument()
    expect(screen.getByText('ノート 1–50 / 200')).toBeInTheDocument()

    const nextPage = screen.getByRole('button', { name: 'discussion-1の次のノートページ' })
    fireEvent.click(nextPage)
    fireEvent.click(nextPage)
    fireEvent.click(nextPage)

    expect(screen.queryByText('note-1 の本文')).not.toBeInTheDocument()
    expect(screen.getByText('note-151 の本文')).toBeInTheDocument()
    expect(screen.getByText('note-200 の本文')).toBeInTheDocument()
    expect(screen.getByText('ノート 151–200 / 200')).toBeInTheDocument()
    expect(nextPage).toBeDisabled()
  })

  it('disables pagination while editing and preserves text when save fails', async () => {
    const ownedNote = createNote('owned-note', currentUser, { body: '編集前の本文' })
    const discussions = [
      createDiscussion([ownedNote], 'discussion-1'),
      ...Array.from({ length: 20 }, (_, index) => createDiscussion([createNote(`other-${index + 1}`, otherUser)], `discussion-${index + 2}`)),
    ]
    const onEdit = vi.fn().mockRejectedValue(new Error('private save failure'))

    renderList(discussions, { onEdit })

    fireEvent.click(screen.getByRole('button', { name: 'owned-noteを編集' }))
    const nextPage = screen.getByRole('button', { name: '次の議論ページ' })
    expect(nextPage).toBeDisabled()

    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: '編集後も残る本文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(ownedNote, '編集後も残る本文'))
    expect(screen.getByRole('textbox')).toHaveValue('編集後も残る本文')
    expect(nextPage).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(nextPage).toBeEnabled()
  })

  it('clamps the visible page when discussions or notes shrink', () => {
    const discussions = Array.from({ length: 41 }, (_, index) => {
      const discussionNumber = index + 1
      return createDiscussion([createNote(`discussion-${discussionNumber}-note`, otherUser)], `discussion-${discussionNumber}`)
    })
    const view = renderList(discussions)
    const discussionNextPage = screen.getByRole('button', { name: '次の議論ページ' })
    fireEvent.click(discussionNextPage)
    fireEvent.click(discussionNextPage)

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
    expect(screen.getByText('議論 1–3 / 3')).toBeInTheDocument()

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
