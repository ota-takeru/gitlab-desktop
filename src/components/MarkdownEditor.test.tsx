import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MARKDOWN_EDITOR_MODE_KEY, MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor'

function richEditor(label: string): Editor {
  const dom = screen.getByRole('textbox', { name: label }) as HTMLElement & { editor?: Editor }
  if (!dom.editor) throw new Error('rich editor is not mounted')
  return dom.editor
}

describe('MarkdownEditor', () => {
  it('reports typed rich text as Markdown and follows outside changes', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const onChange = vi.fn()
    const view = render(<MarkdownEditor label="本文" onChange={onChange} value="" />)

    act(() => { richEditor('本文').chain().insertContent('確認').toggleBold().insertContent('太字').run() })
    expect(onChange).toHaveBeenLastCalledWith('確認**太字**')

    view.rerender(<MarkdownEditor label="本文" onChange={onChange} value="" />)
    await waitFor(() => expect(richEditor('本文').getText()).toBe(''))
    const calls = onChange.mock.calls.length

    view.rerender(<MarkdownEditor label="本文" onChange={onChange} value="> 復元した本文" />)
    await waitFor(() => expect(within(screen.getByRole('textbox', { name: '本文' })).getByText('復元した本文').closest('blockquote')).not.toBeNull())
    expect(onChange).toHaveBeenCalledTimes(calls)
  })

  it('opens bodies the rich editor would change as Markdown and keeps them unchanged', () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const onChange = vi.fn()
    render(<MarkdownEditor label="本文" onChange={onChange} value="<details><summary>詳細</summary>中身</details>" />)

    expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('<details><summary>詳細</summary>中身</details>')
    expect(screen.getByText(/リッチ表示で保持できない記法/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'リッチ' }))
    expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('<details><summary>詳細</summary>中身</details>')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('remembers the chosen input mode', () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const view = render(<MarkdownEditor label="本文" onChange={() => undefined} value="**太字**" />)

    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('**太字**')
    expect(localStorage.getItem(MARKDOWN_EDITOR_MODE_KEY)).toBe('source')

    view.unmount()
    render(<MarkdownEditor label="本文" onChange={() => undefined} value="**太字**" />)
    expect(screen.getByRole('textbox', { name: '本文' })).toHaveValue('**太字**')
  })

  it('lets the caller handle keys and replaces a mention at the caret in rich mode', () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const onKeyDown = vi.fn((event: { ctrlKey: boolean; key: string }) => event.ctrlKey && event.key === 'Enter')
    const onMentionQueryChange = vi.fn()
    let handle: MarkdownEditorHandle | null = null
    function Harness() {
      const [value, setValue] = useState('hello @al tail')
      return <MarkdownEditor label="本文" onChange={setValue} onKeyDown={onKeyDown} onMentionQueryChange={onMentionQueryChange} ref={(current) => { handle = current }} value={value} />
    }
    render(<Harness />)

    const editor = richEditor('本文')
    act(() => { editor.commands.setTextSelection(10) })
    expect(onMentionQueryChange).toHaveBeenLastCalledWith('al')

    act(() => { handle?.insertMention('@alice') })
    expect(editor.getMarkdown()).toBe('hello @alice tail')

    fireEvent.keyDown(editor.view.dom, { ctrlKey: true, key: 'Enter' })
    expect(onKeyDown).toHaveBeenLastCalledWith(expect.objectContaining({ ctrlKey: true, key: 'Enter' }))
  })

  it('hands a pasted image to the caller in rich mode', () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const onPasteImage = vi.fn()
    render(<MarkdownEditor label="本文" onChange={() => undefined} onPasteImage={onPasteImage} value="" />)

    fireEvent.paste(screen.getByRole('textbox', { name: '本文' }), {
      clipboardData: { getData: () => '', items: [{ getAsFile: () => file, kind: 'file', type: 'image/png' }] },
    })
    expect(onPasteImage).toHaveBeenCalledWith(file)
  })
})
