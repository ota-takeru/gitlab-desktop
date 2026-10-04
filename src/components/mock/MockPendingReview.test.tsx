import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { useState, type ComponentProps } from 'react'

import { createAppTheme } from '../../theme'
import type { MockPendingComment } from '../../mock/reviewTypes'
import { MockPendingReview } from './MockPendingReview'

const pending: MockPendingComment[] = [
  {
    body: 'この行の意図を補足してください。',
    id: 'pending-1',
    kind: 'thread',
    position: { endLine: 16, line: 14, path: 'src/lib/review-cache.ts', scope: 'overall', sha: 'b7c2e81f4a', side: 'new' },
    resolution: 'resolved',
  },
  {
    body: '全体のコメントです。',
    id: 'pending-2',
    kind: 'comment',
    replyAuthor: '中村涼',
    replyTo: 'discussion-3',
  },
]

function renderReview(overrides: Partial<ComponentProps<typeof MockPendingReview>> = {}) {
  const props: ComponentProps<typeof MockPendingReview> = {
    onDelete: vi.fn(),
    onDiscard: vi.fn(),
    onEdit: vi.fn(),
    onPublish: vi.fn(),
    pending,
    ...overrides,
  }
  return {
    ...render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <MockPendingReview {...props} />
      </ThemeProvider>,
    ),
    props,
  }
}

describe('MockPendingReview', () => {
  it('reviews each queued target before publishing with summary and approval', async () => {
    const onPublish = vi.fn()
    renderReview({ onPublish })

    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (2)' }))
    expect(screen.getByText('src/lib/review-cache.ts:14–16 · 変更後 · b7c2e81f')).toBeInTheDocument()
    expect(screen.getByText('返信: 中村涼')).toBeInTheDocument()
    expect(screen.getByText('投稿時に解決')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'レビュー概要（任意）' }), { target: { value: 'キャッシュのレビュー結果です。' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'このレビューを承認として送信' }))
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信シミュレーション' }))

    expect(onPublish).toHaveBeenCalledWith('キャッシュのレビュー結果です。', true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('edits and deletes queued comments from the review dialog', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    renderReview({ onDelete, onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (2)' }))

    fireEvent.click(screen.getByRole('button', { name: /未公開コメント1.*編集/ }))
    const editBox = screen.getByRole('textbox', { name: 'コメントを編集' })
    fireEvent.change(editBox, { target: { value: '更新したコメントです。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onEdit).toHaveBeenCalledWith('pending-1', '更新したコメントです。')

    fireEvent.click(screen.getByRole('button', { name: /未公開コメント2.*削除/ }))
    expect(onDelete).toHaveBeenCalledWith('pending-2')
  })

  it('clears an edited item before deleting it so remaining review items can be sent', () => {
    const onPublish = vi.fn()
    function ReviewWithRemoval() {
      const [items, setItems] = useState(pending)
      return (
        <MockPendingReview
          onDelete={(id) => setItems((current) => current.filter((item) => item.id !== id))}
          onDiscard={vi.fn()}
          onEdit={vi.fn()}
          onPublish={onPublish}
          pending={items}
        />
      )
    }

    render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <ReviewWithRemoval />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (2)' }))
    fireEvent.click(screen.getByRole('button', { name: /未公開コメント1.*編集/ }))
    fireEvent.click(screen.getByRole('button', { name: /未公開コメント1.*削除/ }))

    const publishButton = screen.getByRole('button', { name: 'レビューを送信シミュレーション' })
    expect(publishButton).toBeEnabled()
    fireEvent.click(publishButton)
    expect(onPublish).toHaveBeenCalledWith('', false)
  })

  it('requires a concrete confirmation before discarding the review', () => {
    const onDiscard = vi.fn()
    renderReview({ onDiscard })
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信 (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'レビューを破棄' }))

    const confirmation = screen.getByRole('dialog', { name: 'レビューを破棄しますか？' })
    expect(confirmation).toBeInTheDocument()
    fireEvent.click(within(confirmation).getByRole('button', { name: '破棄する' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})
