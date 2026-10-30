import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Draft, GitLabUser, Note } from '../../types/gitlab'
import { DiscussionList } from './DiscussionList'
import { DraftList } from './DraftList'
import { clearComposerBufferStore } from './useComposerBuffer'
import { clearMentionLookups } from './useMentionStatuses'

const { queryGitLab } = vi.hoisted(() => ({ queryGitLab: vi.fn() }))

vi.mock('../connections/connectionContext', async () => {
  const { createContext } = await import('react')
  const connection = { session: { id: 'session-1' } }
  return { ConnectionContext: createContext(connection), useConnection: () => connection }
})
vi.mock('../../lib/gitlab', () => ({ queryGitLab }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: () => ({ data: [], loading: false }) }))

const currentUser: GitLabUser = { id: 'user-1', name: '自分', username: 'reviewer' }
const participants: GitLabUser[] = [{ id: 'user-2', name: '太田 健', username: 'ota' }]

describe('mentions while editing', () => {
  beforeEach(() => {
    clearComposerBufferStore()
    clearMentionLookups()
    queryGitLab.mockReset()
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

  it('shows which mentions in an own comment being edited name a user', async () => {
    queryGitLab.mockImplementation(async ({ query }: { query: { username: string } }) => ({ data: query.username === 'sato' ? { id: 'user-3', name: '佐藤', username: 'sato' } : null }))
    const note: Note = { author: currentUser, body: '@ota @sato @nobody', createdAt: '2026-01-01T00:00:00.000Z', id: 'note-1', position: null, resolvable: false, resolved: false, system: false }
    const view = render(<ThemeProvider theme={createAppTheme('dark')}><DiscussionList currentUserId={currentUser.id} discussions={[{ id: 'discussion-1', individualNote: false, notes: [note] }]} mentionParticipants={participants} onDelete={vi.fn()} onEdit={vi.fn()} onReply={vi.fn()} onResolve={vi.fn()} sessionId="session-1" /></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: '自分のコメント「@ota @sato @nobody」を編集' }))
    // A participant counts at once; the others once GitLab has answered.
    await waitFor(() => expect(view.container.querySelectorAll('.mention-resolved')).toHaveLength(2))
    expect([...view.container.querySelectorAll('.mention-resolved')].map((mark) => mark.textContent)).toEqual(['@ota', '@sato'])
    expect(view.container.querySelector('.mention-unresolved')).toHaveTextContent('@nobody')
    expect(queryGitLab.mock.calls.map(([input]) => input.query.username)).toEqual(['sato', 'nobody'])
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
