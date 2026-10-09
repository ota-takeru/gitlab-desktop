import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { ReviewComposer } from './ReviewComposer'

const mentionFixtures = vi.hoisted(() => ({
  empty: [] as { id: string; name: string; username: string }[],
  users: [
    { id: 'user-alice', name: 'Alice Example', username: 'alice' },
    { id: 'user-alicia', name: 'Alicia Example', username: 'alicia' },
  ],
}))

vi.mock('../connections/ConnectionProvider', () => ({ useConnection: () => ({ session: { id: 'session-1' } }) }))
vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: { search: string } | null) => ({
    data: query?.search === 'al' ? mentionFixtures.users : mentionFixtures.empty,
    loading: false,
  }),
}))

describe('ReviewComposer', () => {
  it('keeps thread selection available alongside the comment mode and submits it', async () => {
    const onSubmitComment = vi.fn(async () => true)
    render(<ReviewComposer onCancelReply={() => undefined} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={onSubmitComment} value="本文" />)

    fireEvent.click(screen.getByRole('checkbox', { name: '解決可能なスレッドとして投稿' }))
    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿' }))

    await act(async () => undefined)
    expect(onSubmitComment).toHaveBeenCalledWith('本文', true, undefined)
  })

  it('ignores a second Ctrl+Enter while the first submission is flushing', async () => {
    let resolveSubmit!: (success: boolean) => void
    const onSaveDraft = vi.fn(() => new Promise<boolean>((resolve) => { resolveSubmit = resolve }))
    const onChange = vi.fn()
    render(<ReviewComposer onCancelReply={() => undefined} onChange={onChange} onClearPosition={() => undefined} onSaveDraft={onSaveDraft} onSubmitComment={async () => true} value="本文" />)

    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    fireEvent.keyDown(textbox, { ctrlKey: true, key: 'Enter' })
    fireEvent.keyDown(textbox, { ctrlKey: true, key: 'Enter' })

    expect(onSaveDraft).toHaveBeenCalledTimes(1)
    expect(textbox).toBeDisabled()

    await act(async () => resolveSubmit(true))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('keeps the Markdown text while switching between edit and preview', () => {
    function StatefulComposer() {
      const [value, setValue] = useState('**太字の本文**')
      return <ReviewComposer onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} value={value} />
    }

    render(<StatefulComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'コメントをプレビュー' }))
    expect(screen.getByText('太字の本文').tagName).toBe('STRONG')
    expect(screen.queryByRole('textbox', { name: 'コメント本文' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'コメントを編集' }))
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('**太字の本文**')
  })

  it('returns to the editor and focuses it when a reply target changes during preview', async () => {
    const props = { onCancelReply: () => undefined, onChange: () => undefined, onClearPosition: () => undefined, onSaveDraft: async () => true, onSubmitComment: async () => true, value: '本文' }
    const view = render(<ReviewComposer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'コメントをプレビュー' }))

    view.rerender(<ReviewComposer {...props} replyAuthor="Colleague" replyDiscussionId="discussion-1" />)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveFocus())
  })

  it('searches mentions after two characters and inserts at the caret without losing the tail', async () => {
    function StatefulComposer() {
      const [value, setValue] = useState('hello @al tail')
      return <ReviewComposer enableMentions onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} value={value} />
    }

    render(<StatefulComposer />)
    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    textbox.setSelectionRange(9, 9)
    fireEvent.click(textbox)
    await act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 400)) })

    fireEvent.click(screen.getByRole('button', { name: '@aliceを挿入' }))

    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('hello @alice tail')
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveFocus()
    expect((screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement).selectionStart).toBe(12)
  })

  it('supports keyboard navigation through mention suggestions', async () => {
    function StatefulComposer() {
      const [value, setValue] = useState('@al')
      return <ReviewComposer enableMentions onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} value={value} />
    }

    render(<StatefulComposer />)
    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    textbox.setSelectionRange(3, 3)
    fireEvent.click(textbox)
    await act(async () => { await new Promise((resolve) => globalThis.setTimeout(resolve, 400)) })
    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('@alicia ')
  })
})
