import { Editor, type Extensions } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

import { isEquivalentMarkdown } from './markdownEquivalence'
import type { MarkdownFormat } from './markdownFormat'

/** Images are shown as labels, like the comment view; GitLab uploads are not loaded. */
const LabelledImage = Image.extend({
  renderHTML({ node }) {
    const alt = typeof node.attrs.alt === 'string' && node.attrs.alt ? node.attrs.alt : '説明なし'
    return ['span', { 'data-markdown-image': '', title: String(node.attrs.src ?? '') }, `[画像: ${alt}]`]
  },
})

/** Markdown nodes that GitLab renders; anything else makes the body unsuitable for rich editing. */
export function createRichMarkdownExtensions(placeholder?: string): Extensions {
  return [
    StarterKit.configure({
      // Clicking must not navigate the desktop window; underline has no GitLab Markdown syntax.
      link: { autolink: true, openOnClick: false },
      underline: false,
    }),
    Markdown,
    TableKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    LabelledImage.configure({ inline: true }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ]
}

/** Markdown produced by the editor, without the blank lines it leaves around blocks. */
export function getEditorMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/^\n+/u, '').trimEnd()
}

let converter: Editor | null = null

/**
 * True when the rich editor can show `body` without changing how GitLab
 * renders it. Raw HTML, for example, is dropped by the editor.
 */
export function canEditAsRichText(body: string): boolean {
  if (!body.trim()) return true
  converter ??= new Editor({ extensions: createRichMarkdownExtensions() })
  converter.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
  return isEquivalentMarkdown(body, getEditorMarkdown(converter))
}

/** Applies a toolbar format to the rich editor selection. */
export function applyRichFormat(editor: Editor, format: MarkdownFormat) {
  const chain = editor.chain().focus()
  switch (format) {
    case 'heading': chain.toggleHeading({ level: 3 }).run(); return
    case 'bold': chain.toggleBold().run(); return
    case 'italic': chain.toggleItalic().run(); return
    case 'strikethrough': chain.toggleStrike().run(); return
    case 'quote': chain.toggleBlockquote().run(); return
    case 'bulletList': chain.toggleBulletList().run(); return
    case 'numberedList': chain.toggleOrderedList().run(); return
    case 'taskList': chain.toggleTaskList().run(); return
    case 'table': chain.insertTable({ cols: 2, rows: 3, withHeaderRow: true }).run(); return
    case 'code': {
      const { $from, $to, empty } = editor.state.selection
      const block = editor.isActive('codeBlock') || !$from.sameParent($to) || (empty && $from.parent.content.size === 0)
      if (block) chain.toggleCodeBlock().run()
      else chain.toggleCode().run()
      return
    }
    case 'link': {
      if (editor.isActive('link')) {
        chain.extendMarkRange('link').unsetLink().run()
        return
      }
      const href = globalThis.prompt('リンク先のURL', 'https://')?.trim()
      if (!href || href === 'https://') return
      if (editor.state.selection.empty) chain.insertContent({ marks: [{ attrs: { href }, type: 'link' }], text: href, type: 'text' }).run()
      else chain.setLink({ href }).run()
    }
  }
}
