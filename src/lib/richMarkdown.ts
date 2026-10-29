import { Editor, type Extensions } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'

import { translate } from '../i18n/i18n'
import { isEquivalentMarkdown } from './markdownEquivalence'
import type { MarkdownFormat } from './markdownFormat'

/** Images are shown as labels, like the comment view; GitLab uploads are not loaded. */
const LabelledImage = Image.extend({
  renderHTML({ node }) {
    const alt = typeof node.attrs.alt === 'string' && node.attrs.alt ? node.attrs.alt : translate('common.richMarkdown.noAlt')
    return ['span', { 'data-markdown-image': '', title: String(node.attrs.src ?? '') }, translate('common.richMarkdown.image', { alt })]
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

/**
 * Lines written with single newlines, as Markdown from the source input or GitLab is, share one paragraph.
 * Gives the selected lines paragraphs of their own, so a block format changes only them; with `eachLine`,
 * one per line, as the Markdown input puts a heading or list marker on each line.
 */
function isolateSelectedLines(editor: Editor, eachLine: boolean) {
  const { empty, from, to } = editor.state.selection
  const splits: number[] = []
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    const breaks = lineBreaks(node, pos)
    // A selection ending just after a line's newline leaves the next line out.
    const end = !empty && breaks.includes(to - 1) ? to - 1 : to
    const before = breaks.filter((at) => at < from).at(-1)
    const after = breaks.find((at) => at >= end)
    if (before !== undefined) splits.push(before)
    if (eachLine) splits.push(...breaks.filter((at) => at >= from && at < end))
    if (after !== undefined) splits.push(after)
    return false
  })
  if (splits.length) {
    const tr = editor.state.tr
    // From the end, so earlier positions stay where they were.
    for (const at of [...new Set(splits)].sort((a, b) => b - a)) tr.delete(at, at + 1).split(at)
    // A caret at the end of a line sits on its newline; it stays on that line, as does the end of a selection.
    const head = tr.mapping.map(from, empty ? -1 : 1)
    tr.setSelection(TextSelection.create(tr.doc, head, empty ? head : tr.mapping.map(to, -1)))
    editor.view.dispatch(tr)
  }
  excludeNextBlock(editor)
}

/** Positions of the newline characters and hard breaks in a textblock at `pos`; ProseMirror counts text in UTF-16 units. */
function lineBreaks(node: ProseMirrorNode, pos: number): number[] {
  const breaks: number[] = []
  node.forEach((child, offset) => {
    const at = pos + 1 + offset
    if (child.type.name === 'hardBreak') breaks.push(at)
    else if (child.isText) {
      const text = child.text ?? ''
      for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) breaks.push(at + index)
    }
  })
  return breaks
}

/** A selection ending at the very start of a block, as after selecting a whole line, ends with the block before. */
function excludeNextBlock(editor: Editor) {
  const { $from, $to, empty } = editor.state.selection
  if (empty || $to.parentOffset > 0 || !$to.parent.isTextblock || $to.pos <= $from.pos + 1) return
  const end = Selection.findFrom(editor.state.doc.resolve($to.before()), -1, true)
  if (!end || end.to <= $from.pos) return
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, $from.pos, end.to)))
}

const LISTS = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' } as const

/**
 * TipTap changes the type of the whole list around the caret; as the Markdown input does, only the selected
 * items of a top-level list change. They leave the list first, and the format makes them a list of their own.
 */
function liftFromOtherList(editor: Editor, target: keyof typeof LISTS) {
  const { $from } = editor.state.selection
  const lists: { depth: number; name: keyof typeof LISTS }[] = []
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name
    if (name in LISTS) lists.push({ depth, name: name as keyof typeof LISTS })
  }
  if (lists.length !== 1 || lists[0].name === target) return
  editor.chain().focus().liftListItem(LISTS[lists[0].name]).run()
}

/** Selected hard breaks become newlines, the only line breaks a code block keeps. */
function hardBreaksToNewlines(editor: Editor) {
  const { from, to } = editor.state.selection
  const breaks: number[] = []
  editor.state.doc.nodesBetween(from, to, (node, pos) => { if (node.type.name === 'hardBreak') breaks.push(pos) })
  if (!breaks.length) return
  const tr = editor.state.tr
  for (const at of breaks.reverse()) tr.replaceWith(at, at + 1, editor.state.schema.text('\n'))
  editor.view.dispatch(tr)
}

/** The text the rich editor shows from the start of `doc` to `to`, without block separators. */
export function richTextBefore(doc: ProseMirrorNode, to: number): string {
  return doc.textBetween(0, to, '', () => '')
}

/** The text the rich editor would show for `markdown`. */
export function shownText(markdown: string): string {
  converter ??= new Editor({ extensions: createRichMarkdownExtensions() })
  converter.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
  return richTextBefore(converter.state.doc, converter.state.doc.content.size)
}

/** Applies a toolbar format to the rich editor selection. */
export function applyRichFormat(editor: Editor, format: MarkdownFormat) {
  if (['heading', 'quote', 'bulletList', 'numberedList', 'taskList'].includes(format)) isolateSelectedLines(editor, format !== 'quote')
  if (format === 'bulletList' || format === 'taskList') liftFromOtherList(editor, format)
  if (format === 'numberedList') liftFromOtherList(editor, 'orderedList')
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
      const { $from, $to, empty, from, to } = editor.state.selection
      const multiline = !empty && lineBreaks($from.parent, $from.before()).some((at) => at >= from && at < to)
      const block = editor.isActive('codeBlock') || !$from.sameParent($to) || multiline || (empty && $from.parent.content.size === 0)
      if (block) {
        // The selected lines become one code block, without the lines around them.
        if (!editor.isActive('codeBlock')) {
          isolateSelectedLines(editor, false)
          hardBreaksToNewlines(editor)
        }
        editor.chain().focus().toggleCodeBlock().run()
      } else chain.toggleCode().run()
      return
    }
    case 'link': {
      if (editor.isActive('link')) {
        chain.extendMarkRange('link').unsetLink().run()
        return
      }
      const href = globalThis.prompt(translate('common.richMarkdown.linkPrompt'), 'https://')?.trim()
      if (!href || href === 'https://') return
      if (editor.state.selection.empty) chain.insertContent({ marks: [{ attrs: { href }, type: 'link' }], text: href, type: 'text' }).run()
      else chain.setLink({ href }).run()
    }
  }
}
