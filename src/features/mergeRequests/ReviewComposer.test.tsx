import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { MARKDOWN_EDITOR_MODE_KEY } from '../../components/MarkdownEditor'
import { MAX_GITLAB_ATTACHMENT_BYTES } from '../../lib/attachments'
import { ReviewComposer } from './ReviewComposer'

const mentionFixtures = vi.hoisted(() => ({
  empty: [] as { id: string; name: string; username: string }[],
  users: [
    { id: 'user-alice', name: 'Alice Example', username: 'alice' },
    { id: 'user-alicia', name: 'Alicia Example', username: 'alicia' },
  ],
}))

vi.mock('../connections/connectionContext', () => ({ useConnection: () => ({ session: { id: 'session-1' } }) }))
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

  it('formats Markdown in place in the rich editor', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const onChange = vi.fn()
    render(<ReviewComposer onCancelReply={() => undefined} onChange={onChange} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} value="**太字の本文**" />)

    const editor = screen.getByRole('textbox', { name: 'コメント本文' })
    expect(within(editor).getByText('太字の本文').tagName).toBe('STRONG')
    expect(screen.queryByLabelText('コメントプレビュー')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '箇条書きを挿入' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('- **太字の本文**'))
  })

  it('formats the selection from the toolbar and the keyboard', () => {
    function StatefulComposer() {
      const [value, setValue] = useState('確認 item')
      return <ReviewComposer onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} value={value} />
    }

    render(<StatefulComposer />)
    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    textbox.setSelectionRange(0, 2)
    fireEvent.click(screen.getByRole('button', { name: '太字を挿入' }))
    expect(textbox).toHaveValue('**確認** item')
    expect([textbox.selectionStart, textbox.selectionEnd]).toEqual([2, 4])

    fireEvent.keyDown(textbox, { ctrlKey: true, key: 'b' })
    expect(textbox).toHaveValue('確認 item')

    fireEvent.click(screen.getByRole('button', { name: '箇条書きを挿入' }))
    expect(textbox).toHaveValue('- 確認 item')
  })

  it('focuses the editor when a reply target is chosen', async () => {
    const props = { onCancelReply: () => undefined, onChange: () => undefined, onClearPosition: () => undefined, onSaveDraft: async () => true, onSubmitComment: async () => true, value: '本文' }
    const view = render(<ReviewComposer {...props} />)

    view.rerender(<ReviewComposer {...props} replyAuthor="Colleague" replyDiscussionId="discussion-1" />)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveFocus())
  })

  it('names the submit button of a reply 「返信」', () => {
    render(<ReviewComposer onCancelReply={() => undefined} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} replyDiscussionId="discussion-1" value="返信本文" />)

    expect(screen.getByRole('button', { name: '返信' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'コメントを投稿' })).not.toBeInTheDocument()
  })

  it('closes the reply with Esc', () => {
    const onCancelReply = vi.fn()
    render(<ReviewComposer onCancelReply={onCancelReply} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} replyAuthor="Colleague" replyDiscussionId="discussion-1" value="途中の返信" />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'コメント本文' }), { key: 'Escape' })
    expect(onCancelReply).toHaveBeenCalledTimes(1)
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

    fireEvent.click(screen.getByRole('option', { name: /@alice$/u }))

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
    // The editor keeps the focus and points at the highlighted candidate.
    const highlighted = screen.getByRole('option', { name: /@alicia$/u })
    expect(highlighted).toHaveAttribute('aria-selected', 'true')
    expect(textbox).toHaveAttribute('aria-activedescendant', highlighted.id)
    expect(textbox).toHaveAttribute('aria-controls', screen.getByRole('listbox', { name: 'メンション候補' }).id)
    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('@alicia ')
  })

  it('preserves text typed during upload and selected text at the current caret', async () => {
    let resolveUpload!: (markdown: string) => void
    const onUploadAttachment = vi.fn<(file: File) => Promise<string>>(() => new Promise<string>((resolve) => { resolveUpload = resolve }))
    function StatefulComposer() {
      const [value, setValue] = useState('元の本文')
      const [pending, setPending] = useState(false)
      const upload = (file: File) => {
        setPending(true)
        return onUploadAttachment(file)
      }
      return <ReviewComposer attachmentTargetKey="project-1:42" pending={pending} onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} onUploadAttachment={upload} value={value} />
    }

    render(<StatefulComposer />)
    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    const file = new File(['image'], 'screen.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('添付ファイルを選択'), { target: { files: [file] } })

    expect(screen.getAllByRole('button', { name: '添付ファイルをアップロード中…' }).at(-1)).toBeDisabled()
    expect(textbox).toBeEnabled()
    fireEvent.change(textbox, { target: { value: 'アップロード中に追記' } })
    textbox.setSelectionRange(4, 6)

    await act(async () => resolveUpload('![screen.png](/uploads/screen.png)'))

    const markdown = '![screen.png](/uploads/screen.png)'
    expect(textbox).toHaveValue(`アップロ\n${markdown}\nード中に追記`)
    expect(textbox.selectionStart).toBe(4 + 1 + markdown.length)
  })

  it('uploads a pasted image and appends its Markdown', async () => {
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const onUploadAttachment = vi.fn(async () => '![clipboard.png](/uploads/clipboard.png)')
    function StatefulComposer() {
      const [value, setValue] = useState('')
      return <ReviewComposer onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} onUploadAttachment={onUploadAttachment} value={value} />
    }

    render(<StatefulComposer />)
    fireEvent.paste(screen.getByRole('textbox', { name: 'コメント本文' }), {
      clipboardData: { getData: () => '', items: [{ getAsFile: () => file, kind: 'file', type: 'image/png' }] },
    })

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith(file))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('![clipboard.png](/uploads/clipboard.png)'))
  })

  it('pastes text instead of uploading the image that Office apps copy alongside it', () => {
    const file = new File(['image'], 'cells.png', { type: 'image/png' })
    const onUploadAttachment = vi.fn(async () => '![cells.png](/uploads/cells.png)')
    render(<ReviewComposer onCancelReply={() => undefined} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} onUploadAttachment={onUploadAttachment} value="" />)

    const notCancelled = fireEvent.paste(screen.getByRole('textbox', { name: 'コメント本文' }), {
      clipboardData: { getData: (type: string) => type === 'text/plain' ? 'A1 B1' : '', items: [{ getAsFile: () => file, kind: 'file', type: 'image/png' }] },
    })

    expect(notCancelled).toBe(true)
    expect(onUploadAttachment).not.toHaveBeenCalled()
  })

  it('rejects an oversized file locally and reports upload errors without paths', async () => {
    const onUploadAttachment = vi.fn(async () => { throw new Error('C:\\private\\token.txt') })
    const oversized = new File(['x'], 'large.bin')
    Object.defineProperty(oversized, 'size', { value: MAX_GITLAB_ATTACHMENT_BYTES + 1 })
    const view = render(<ReviewComposer onCancelReply={() => undefined} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} onUploadAttachment={onUploadAttachment} value="本文" />)

    fireEvent.change(screen.getByLabelText('添付ファイルを選択'), { target: { files: [oversized] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('10 MiB以下')
    expect(onUploadAttachment).not.toHaveBeenCalled()

    const validFile = new File(['x'], 'screen.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('添付ファイルを選択'), { target: { files: [validFile] } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('アップロードできませんでした')
    expect(alert).not.toHaveTextContent('private')
    expect(view.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('本文')
  })

  it('hands an upload result to the original input after the attachment target changes', async () => {
    let resolveUpload!: (markdown: string) => void
    const onUploadAttachment = vi.fn(() => new Promise<string>((resolve) => { resolveUpload = resolve }))
    const onChange = vi.fn()
    const keepFirst = vi.fn()
    const keepSecond = vi.fn()
    const props = { onCancelReply: () => undefined, onChange, onClearPosition: () => undefined, onSaveDraft: async () => true, onSubmitComment: async () => true, onUploadAttachment, value: '本文' }
    const view = render(<ReviewComposer {...props} attachmentTargetKey="project-1:42" onDetachedAttachment={keepFirst} />)

    fireEvent.change(screen.getByLabelText('添付ファイルを選択'), { target: { files: [new File(['image'], 'screen.png')] } })
    view.rerender(<ReviewComposer {...props} attachmentTargetKey="project-1:43" onDetachedAttachment={keepSecond} />)
    await act(async () => resolveUpload('![screen.png](/uploads/screen.png)'))

    expect(onChange).not.toHaveBeenCalled()
    expect(keepFirst).toHaveBeenCalledWith('![screen.png](/uploads/screen.png)')
    expect(keepSecond).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('本文')
  })

  it('does not update an unmounted composer after an upload completes', async () => {
    let resolveUpload!: (markdown: string) => void
    const onUploadAttachment = vi.fn(() => new Promise<string>((resolve) => { resolveUpload = resolve }))
    const onChange = vi.fn()
    const onDetachedAttachment = vi.fn()
    const view = render(<ReviewComposer attachmentTargetKey="project-1:42" onCancelReply={() => undefined} onChange={onChange} onClearPosition={() => undefined} onDetachedAttachment={onDetachedAttachment} onSaveDraft={async () => true} onSubmitComment={async () => true} onUploadAttachment={onUploadAttachment} value="本文" />)

    fireEvent.change(screen.getByLabelText('添付ファイルを選択'), { target: { files: [new File(['image'], 'screen.png')] } })
    view.unmount()
    await act(async () => resolveUpload('![screen.png](/uploads/screen.png)'))

    expect(onChange).not.toHaveBeenCalled()
    expect(onDetachedAttachment).toHaveBeenCalledWith('![screen.png](/uploads/screen.png)')
  })

  it.each(['source', 'rich'])('inserts a suggestion of the commented lines in the %s editor', async (mode) => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, mode)
    const onChange = vi.fn()
    const position = { baseSha: 'a', headSha: 'b', newLine: 13, newPath: 'src/a.ts', oldPath: 'src/a.ts', positionType: 'text' as const, startSha: 'c' }
    render(<ReviewComposer inlineTarget onCancelReply={() => undefined} onChange={onChange} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} suggestionLines={() => ['  if (cached) {', '    return cached.value']} targetPosition={position} value="" />)

    fireEvent.click(screen.getByRole('button', { name: '提案を挿入' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('```suggestion:-1+0\n  if (cached) {\n    return cached.value\n```'))
  })

  it('offers no suggestion on a comment that ends on a removed line', () => {
    render(<ReviewComposer inlineTarget onCancelReply={() => undefined} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} suggestionLines={null} value="" />)
    expect(screen.getByRole('button', { name: '提案を挿入' })).toBeDisabled()
  })
})
