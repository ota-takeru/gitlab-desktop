import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { MarkdownFormat } from './markdownFormat'
import { applyRichFormat, createRichMarkdownExtensions, getEditorMarkdown } from './richMarkdown'

let editor: Editor | null = null
afterEach(() => { editor?.destroy(); editor = null })

/** Applies `format` to `body` with the selection between the text offsets `from` and `to` of its only paragraph. */
function format(body: string, from: number, to: number, toolbarFormat: MarkdownFormat): string {
  editor = new Editor({ content: body, contentType: 'markdown', element: document.createElement('div'), extensions: createRichMarkdownExtensions() })
  editor.commands.setTextSelection({ from: from + 1, to: to + 1 })
  applyRichFormat(editor, toolbarFormat)
  return getEditorMarkdown(editor)
}

describe('applyRichFormat', () => {
  // Lines written with single newlines share one paragraph in the rich editor.
  const lines = 'line1\nline2\nline3'

  it('changes only the line with the caret, not the other lines of its paragraph', () => {
    expect(format(lines, 8, 8, 'heading')).toBe('line1\n\n### line2\n\nline3')
    expect(format(lines, 8, 8, 'bulletList')).toBe('line1\n\n- line2\n\nline3')
  })

  it('gives each selected line its own heading or list item, and quotes the selected lines together', () => {
    expect(format(lines, 8, 14, 'numberedList')).toBe('line1\n\n1. line2\n2. line3')
    expect(format(lines, 8, 14, 'quote')).toBe('line1\n\n> line2\n> line3')
  })

  it('leaves inline formats to the selected text', () => {
    expect(format(lines, 7, 10, 'bold')).toBe('line1\nl**ine**2\nline3')
  })

  it('finds the lines after characters outside the Basic Multilingual Plane', () => {
    // 😀 is two positions in ProseMirror; `b` ends at offset 5.
    expect(format('😀a\nb\nc', 5, 5, 'heading')).toBe('😀a\n\n### b\n\nc')
  })

  it('leaves out the next line when the selection ends just after a newline', () => {
    expect(format(lines, 0, 6, 'heading')).toBe('### line1\n\nline2\nline3')
  })

  it('makes selected lines of one paragraph a code block that keeps their newlines', () => {
    expect(format(lines, 6, 17, 'code')).toBe('line1\n\n```\nline2\nline3\n```')
  })

  it('changes the list type of the selected items only', () => {
    // `- a\n- b\n- c`: the text of `b` starts at offset 7 in ProseMirror positions minus one.
    editor = new Editor({ content: '- a\n- b\n- c', contentType: 'markdown', element: document.createElement('div'), extensions: createRichMarkdownExtensions() })
    let at = 0
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'b') at = pos })
    editor.commands.setTextSelection(at)
    applyRichFormat(editor, 'numberedList')
    expect(getEditorMarkdown(editor)).toBe('- a\n\n1. b\n\n- c')
  })
})
