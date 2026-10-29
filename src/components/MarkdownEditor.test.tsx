import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { Activity, useState } from 'react'
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

  it('keeps the selection of a rich editor created again when a hidden screen shows', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const screenWith = (mode: 'hidden' | 'visible') => <Activity mode={mode}><MarkdownEditor autoFocus label="本文" onChange={() => undefined} value="abcdefghij" /></Activity>
    const view = render(screenWith('visible'))
    const first = richEditor('本文')
    await waitFor(() => expect(first.state.selection.head).toBe(11))
    act(() => { first.commands.setTextSelection(4) })

    view.rerender(screenWith('hidden'))
    await waitFor(() => expect(first.isDestroyed).toBe(true))
    view.rerender(screenWith('visible'))
    await waitFor(() => expect(richEditor('本文')).not.toBe(first))
    await act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    expect(richEditor('本文').state.selection.head).toBe(4)
  })

  it('leaves the editor options alone while typing, and a rich editor created again keeps the text typed since', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    function Controlled({ mode }: { mode: 'hidden' | 'visible' }) {
      const [value, setValue] = useState('最初')
      return <Activity mode={mode}><MarkdownEditor label="本文" onChange={setValue} value={value} /></Activity>
    }
    const view = render(<Controlled mode="visible" />)
    const first = richEditor('本文')
    // Applying options redraws the editor and ends an IME conversion in progress.
    const setOptions = vi.spyOn(first, 'setOptions')
    act(() => { first.commands.insertContentAt(first.state.doc.content.size - 1, 'の続き') })
    act(() => { first.commands.insertContentAt(first.state.doc.content.size - 1, '、さらに') })
    expect(setOptions).not.toHaveBeenCalled()

    view.rerender(<Controlled mode="hidden" />)
    await waitFor(() => expect(first.isDestroyed).toBe(true))
    view.rerender(<Controlled mode="visible" />)
    await waitFor(() => expect(richEditor('本文')).not.toBe(first))
    expect(richEditor('本文').getText()).toBe('最初の続き、さらに')
    // Taking the text back is not an edit Ctrl+Z undoes.
    act(() => { richEditor('本文').commands.undo() })
    expect(richEditor('本文').getText()).toBe('最初の続き、さらに')
  })

  it('reads pasted plain text as Markdown in rich mode', () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    const onChange = vi.fn()
    render(<MarkdownEditor label="本文" onChange={onChange} value="" />)
    const clipboardData = { getData: (type: string) => (type === 'text/plain' ? '# 見出し\n- 項目' : ''), items: [] }
    fireEvent.paste(screen.getByRole('textbox', { name: '本文' }), { clipboardData })

    expect(onChange).toHaveBeenLastCalledWith('# 見出し\n\n- 項目')
  })

  it('applies a toolbar format once the IME has confirmed its text', () => {
    vi.useFakeTimers()
    try {
      localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
      const onChange = vi.fn()
      render(<MarkdownEditor label="本文" onChange={onChange} value="日本" />)
      const textarea = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
      textarea.setSelectionRange(0, 2)
      fireEvent.compositionStart(textarea)
      fireEvent.click(screen.getByRole('button', { name: '太字を挿入' }))
      expect(onChange).not.toHaveBeenCalled()

      fireEvent.compositionEnd(textarea)
      act(() => { vi.runAllTimers() })
      expect(onChange).toHaveBeenLastCalledWith('**日本**')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the place after a link and a selected range across a mode switch', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
    const value = '[A](https://example.com/long/path)BCDEFGHIJ'
    render(<MarkdownEditor label="本文" onChange={() => undefined} value={value} />)
    const textarea = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    textarea.setSelectionRange(value.indexOf('B'), value.indexOf('D'))

    fireEvent.click(screen.getByRole('button', { name: 'リッチ' }))
    // Shown text `ABCDEFGHIJ` starts at position 1: B to D is 2 to 4.
    await waitFor(() => expect(richEditor('本文').state.selection).toMatchObject({ from: 2, to: 4 }))

    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
    const source = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    expect([source.selectionStart, source.selectionEnd]).toEqual([value.indexOf('B'), value.indexOf('D')])
  })

  it('carries the caret across a mode switch and closes mention candidates', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
    const onMentionQueryChange = vi.fn()
    render(<MarkdownEditor label="本文" onChange={() => undefined} onMentionQueryChange={onMentionQueryChange} value="abcdefghij" />)
    const textarea = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    textarea.setSelectionRange(5, 5)

    fireEvent.click(screen.getByRole('button', { name: 'リッチ' }))
    expect(onMentionQueryChange).toHaveBeenLastCalledWith(null)
    await waitFor(() => expect(richEditor('本文').state.selection.head).toBe(6))

    act(() => { richEditor('本文').commands.setTextSelection(3) })
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
    const source = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    expect(source).toHaveFocus()
    expect(source.selectionStart).toBe(2)
  })

  it('hands caret and focus to the editor mounted again with the same restore key', async () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
    const editorWith = (layout: string, autoFocus = false) => <MarkdownEditor autoFocus={autoFocus} key={layout} label="本文" onChange={() => undefined} restoreKey="line-1" value="abcdefghij" />
    const view = render(editorWith('split'))
    const first = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(3, 5)

    view.rerender(editorWith('unified'))
    const second = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    expect(second).not.toBe(first)
    expect(second).toHaveFocus()
    expect([second.selectionStart, second.selectionEnd]).toEqual([3, 5])

    // Unfocused at unmount: the caret comes back, autoFocus does not take the focus to the end.
    act(() => { second.blur() })
    view.rerender(editorWith('split', true))
    const third = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    expect(third).not.toHaveFocus()
    expect(third.selectionStart).toBe(3)

    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'rich')
    view.unmount()
    const richView = render(editorWith('split'))
    act(() => { richEditor('本文').chain().setTextSelection(4).focus().run() })
    await waitFor(() => expect(richEditor('本文').view.hasFocus()).toBe(true))
    richView.rerender(editorWith('unified'))
    await waitFor(() => expect(richEditor('本文').state.selection.head).toBe(4))
    await waitFor(() => expect(richEditor('本文').view.hasFocus()).toBe(true))
  })

  it('closes mention candidates when the focus leaves the input', () => {
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
    const onMentionQueryChange = vi.fn()
    render(<MarkdownEditor label="本文" onChange={() => undefined} onMentionQueryChange={onMentionQueryChange} value="hi @al" />)
    const textarea = screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(6, 6)
    fireEvent.keyUp(textarea, { key: 'l' })
    expect(onMentionQueryChange).toHaveBeenLastCalledWith('al')

    fireEvent.blur(textarea)
    expect(onMentionQueryChange).toHaveBeenLastCalledWith(null)
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
