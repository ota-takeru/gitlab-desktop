import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Draft, GitLabUser, Note } from '../../types/gitlab'
import { DiscussionList } from './DiscussionList'
import { DraftList } from './DraftList'
import { clearComposerBufferStore } from './useComposerBuffer'

vi.mock('../connections/connectionContext', () => ({ useConnection: () => ({ session: { id: 'session-1' } }) }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: () => ({ data: [], loading: false }) }))

const currentUser: GitLabUser = { id: 'user-1', name: '自分', username: 'reviewer' }
const participants: GitLabUser[] = [{ id: 'user-2', name: '太田 健', username: 'ota' }]

describe('mentions while editing', () => {
  beforeEach(() => {
    clearComposerBufferStore()
    globalThis.localStorage.setItem('gitlab-desktop.markdownEditorMode', 'source')
  })

  it('offers the MR participants in an own comment being edited', () => {
    const note: Note = { author: currentUser, body: '元の本文', createdAt: '2026-01-01T00:00:00.000Z', id: 'note-1', position: null, resolvable: false, resolved: false, system: false }
    render(<ThemeProvider theme={createAppTheme('dark')}><DiscussionList currentUserId={currentUser.id} discussions={[{ id: 'discussion-1', individualNote: false, notes: [note] }]} mentionParticipants={participants} onDelete={vi.fn()} onEdit={vi.fn()} onReply={vi.fn()} onResolve={vi.fn()} sessionId="session-1" /></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: '自分のコメント「元の本文」を編集' }))
    const textbox = screen.getByRole('textbox', { name: 'コメントを編集' })
    fireEvent.change(textbox, { target: { selectionEnd: 6, selectionStart: 6, value: '元の本文 @' } })
    expect(screen.getByRole('option', { name: /@ota$/u })).toBeInTheDocument()

    // Esc closes the candidates first; the edit stays open.
    fireEvent.keyDown(textbox, { key: 'Escape' })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'コメントを編集' })).toBeInTheDocument()

    fireEvent.change(textbox, { target: { selectionEnd: 7, selectionStart: 7, value: '元の本文 @太' } })
    fireEvent.keyDown(textbox, { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'コメントを編集' })).toHaveValue('元の本文 @ota ')
  })

  it('offers the MR participants in a draft being edited', () => {
    const draft: Draft = { body: '下書き', discussionId: null, id: 'draft-1', position: null }
    render(<DraftList disabled={false} draftEditBufferKey={() => 'draft-edit-1'} draftEditId="draft-1" drafts={[draft]} mentionParticipants={participants} nextPage={null} onDelete={vi.fn()} onEdit={vi.fn()} onNextPage={vi.fn()} onOpenPosition={vi.fn()} onPrevPage={vi.fn()} onPublish={vi.fn()} onPublishAll={vi.fn()} onPublishSelected={vi.fn()} onSelect={vi.fn()} onSetEdit={vi.fn()} page={1} publishingAll={false} selected={[]} sessionId="session-1" statuses={{}} />)

    const textbox = screen.getByRole('textbox', { name: '下書きを編集' })
    fireEvent.change(textbox, { target: { selectionEnd: 5, selectionStart: 5, value: '下書き @o' } })
    fireEvent.click(screen.getByRole('option', { name: /@ota$/u }))
    expect(screen.getByRole('textbox', { name: '下書きを編集' })).toHaveValue('下書き @ota ')
  })
})
