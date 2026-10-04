import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { flushComposerBuffersMock, useComposerBufferMock } = vi.hoisted(() => ({
  flushComposerBuffersMock: vi.fn(),
  useComposerBufferMock: vi.fn(),
}))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: null }),
}))

vi.mock('./useComposerBuffer', async () => {
  const actual = await vi.importActual<typeof import('./useComposerBuffer')>('./useComposerBuffer')
  return { ...actual, flushComposerBuffers: flushComposerBuffersMock, useComposerBuffer: useComposerBufferMock }
})

import { BufferedReviewComposer } from './MergeRequestDetail'

describe('BufferedReviewComposer', () => {
  beforeEach(() => {
    flushComposerBuffersMock.mockReset()
    useComposerBufferMock.mockReset().mockReturnValue({
      body: '保持する本文',
      change: vi.fn(),
      discard: vi.fn(),
      error: null,
      persistenceStatus: 'saved',
    })
  })

  it('keeps the body and avoids a mutation when flushing the buffer fails', async () => {
    flushComposerBuffersMock.mockResolvedValue(false)
    const onSubmitComment = vi.fn(async () => true)
    render(<BufferedReviewComposer bufferKey="composer-key" onCancelReply={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={onSubmitComment} />)

    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿' }))
    await waitFor(() => expect(flushComposerBuffersMock).toHaveBeenCalledTimes(1))

    expect(onSubmitComment).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('保持する本文')
    expect(screen.getByRole('alert')).toHaveTextContent('入力の保存を確認できないため、投稿を停止しました。')
  })
})
