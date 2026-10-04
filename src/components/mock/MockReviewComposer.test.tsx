import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import type { ComponentProps } from 'react'

import { createAppTheme } from '../../theme'
import type { MockCommentPosition } from '../../mock/reviewTypes'
import { MockReviewComposer } from './MockReviewComposer'

const position: MockCommentPosition = {
  endLine: 16,
  line: 14,
  path: 'src/lib/review-cache.ts',
  scope: 'overall',
  sha: 'b7c2e81f4a',
  side: 'new',
}

function renderComposer(overrides: Partial<ComponentProps<typeof MockReviewComposer>> = {}) {
  const props: ComponentProps<typeof MockReviewComposer> = {
    draft: '',
    onCancelReply: vi.fn(),
    onChange: vi.fn(),
    onSaveDraft: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  }
  return {
    ...render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <MockReviewComposer {...props} />
      </ThemeProvider>,
    ),
    props,
  }
}

describe('MockReviewComposer', () => {
  it('queues a normal comment and publishes immediately with an explicit option', () => {
    const onAddToReview = vi.fn()
    const onSubmit = vi.fn()
    renderComposer({ draft: 'キャッシュの境界を確認してください。', onAddToReview, onSubmit })

    fireEvent.click(screen.getByRole('button', { name: 'レビューを開始' }))
    expect(onAddToReview).toHaveBeenCalledWith({ kind: 'comment' })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '解決可能なスレッド' }))
    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿シミュレーション' }))
    expect(onSubmit).toHaveBeenLastCalledWith({ kind: 'thread' })
  })

  it('uses thread semantics for line replies and only sends resolution when checked', () => {
    const onAddToReview = vi.fn()
    const onSubmit = vi.fn()
    renderComposer({ canResolveReply: true, draft: '修正しました。', onAddToReview, onSubmit, position, replyResolved: false, replyTarget: '佐藤健' })

    expect(screen.getByText('src/lib/review-cache.ts:14–16 · 変更後 · b7c2e81f')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '返信と同時に解決' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: '返信と同時に解決' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'レビューコメント' }), { ctrlKey: true, key: 'Enter' })

    expect(onAddToReview).toHaveBeenCalledWith({ kind: 'thread', resolution: 'resolved' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps Ctrl+Shift+Enter as the immediate path and previews markdown safely', () => {
    const onAddToReview = vi.fn()
    const onSubmit = vi.fn()
    renderComposer({ draft: '**確認**\n\n- 一覧\n- 詳細', onAddToReview, onSubmit })

    fireEvent.click(screen.getByRole('tab', { name: 'プレビュー' }))
    expect(screen.getByText('確認')).toBeInTheDocument()
    expect(screen.getByText('一覧')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '編集' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'レビューコメント' }), { ctrlKey: true, key: 'Enter', shiftKey: true })
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'comment' })
    expect(onAddToReview).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: '編集' })).toHaveAttribute('aria-selected', 'true')
  })
})
