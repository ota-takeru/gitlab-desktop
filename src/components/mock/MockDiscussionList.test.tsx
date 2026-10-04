import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'

import type { MockDiscussion } from '../../mock/fixtures'
import { createAppTheme } from '../../theme'
import { MockDiscussionList } from './MockDiscussionList'

const user = { name: '自分', handle: '@otata', initials: 'OT' }
const reviewer = { name: 'レビュー担当', handle: '@reviewer', initials: 'RV' }

function discussion(overrides: Partial<MockDiscussion> = {}): MockDiscussion {
  return {
    id: 'discussion-1',
    author: user,
    body: '元のコメント\n2行目',
    createdAt: '今日 10:00',
    file: 'src/review.ts',
    line: 12,
    state: 'open',
    replies: [],
    ...overrides,
  }
}

function renderList(items: MockDiscussion[], options: { onEditNote?: (discussionId: string, body: string, replyId?: string) => void; onDeleteNote?: (discussionId: string, replyId?: string) => void } = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <MockDiscussionList
        discussions={items}
        onDeleteNote={options.onDeleteNote}
        onEditNote={options.onEditNote}
        onReply={vi.fn()}
        onToggleResolved={vi.fn()}
        resolvedIds={[]}
      />
    </ThemeProvider>,
  )
}

describe('MockDiscussionList note controls', () => {
  it('edits an owned root note, rejects an empty body, and can cancel', () => {
    const onEditNote = vi.fn()
    renderList([discussion()], { onEditNote })

    fireEvent.click(screen.getByRole('button', { name: 'コメントを編集' }))
    const editor = screen.getByRole('textbox', { name: 'コメントを編集' })
    fireEvent.change(editor, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '編集を保存' })).toBeDisabled()
    expect(onEditNote).not.toHaveBeenCalled()

    fireEvent.change(editor, { target: { value: '更新したコメント\n2行目' } })
    fireEvent.click(screen.getByRole('button', { name: '編集を保存' }))
    expect(onEditNote).toHaveBeenCalledWith('discussion-1', '更新したコメント\n2行目', undefined)

    fireEvent.click(screen.getByRole('button', { name: 'コメントを編集' }))
    fireEvent.click(screen.getByRole('button', { name: '編集をキャンセル' }))
    expect(screen.queryByRole('textbox', { name: 'コメントを編集' })).not.toBeInTheDocument()
  })

  it('limits edit/delete controls to the current user and preserves reply ownership controls', () => {
    const onEditNote = vi.fn()
    const onDeleteNote = vi.fn()
    renderList([discussion({
      replies: [
        { id: 'reply-owned', author: user, body: '自分の返信', createdAt: '今日 10:10' },
        { id: 'reply-other', author: reviewer, body: '他の人の返信', createdAt: '今日 10:11' },
      ],
    }), discussion({ id: 'discussion-other', author: reviewer, body: '他の人のコメント' })], { onEditNote, onDeleteNote })

    expect(screen.getAllByRole('button', { name: 'コメントを編集' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'コメントを削除' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: '返信を編集' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返信を削除' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '返信を編集' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '返信を削除' })).toHaveLength(1)
  })

  it('confirms root deletion while explicitly keeping replies', async () => {
    const onDeleteNote = vi.fn()
    renderList([discussion({ replies: [{ id: 'reply-1', author: reviewer, body: '残る返信', createdAt: '今日 10:20' }] })], { onDeleteNote })

    fireEvent.click(screen.getByRole('button', { name: 'コメントを削除' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/既存の返信は残ります/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(onDeleteNote).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'コメントを削除' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除を確定' }))
    expect(onDeleteNote).toHaveBeenCalledWith('discussion-1', undefined)
  })

  it('shows ordinary comments without thread resolution controls while retaining reply', () => {
    const onReply = vi.fn()
    render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <MockDiscussionList
          discussions={[discussion({ kind: 'comment', state: 'resolved' })]}
          onReply={onReply}
          onToggleResolved={vi.fn()}
          resolvedIds={[]}
        />
      </ThemeProvider>,
    )

    expect(screen.queryByText('解決済み')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '議論を解決' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '議論を再開' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '自分の議論に返信' }))
    expect(onReply).toHaveBeenCalledWith('discussion-1')
  })

  it('keeps resolved controls for legacy thread fixtures and labels comment versions', () => {
    renderList([discussion({
      position: { path: 'src/review.ts', side: 'new', line: 12, endLine: 14, sha: 'abc1234', scope: 'commit' },
      state: 'resolved',
    })])

    expect(screen.getByText('解決済み')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '議論を再開' })).toBeInTheDocument()
    expect(screen.getByText('src/review.ts:12-14 · 変更後 · abc1234 · コミット')).toBeInTheDocument()
  })

  it('renders a deleted root as a tombstone and retains its replies', () => {
    renderList([discussion({ deleted: true, replies: [{ id: 'reply-1', author: reviewer, body: '残る返信', createdAt: '今日 10:20' }] })], { onEditNote: vi.fn(), onDeleteNote: vi.fn() })

    expect(screen.getByText('コメントは削除されました')).toBeInTheDocument()
    expect(screen.getByText('残る返信')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'コメントを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'コメントを削除' })).not.toBeInTheDocument()
  })
})
