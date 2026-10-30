import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { findMentionRanges, type MentionStatuses } from './mentionRanges'

interface MentionHighlightState { decorations: DecorationSet; statuses: MentionStatuses | undefined }

const mentionHighlightKey = new PluginKey<MentionHighlightState>('mentionHighlight')

/** Marks each `@username` in the rich editor as `mention-resolved` or `mention-unresolved` from the statuses `setMentionStatuses` gave. */
export const MentionHighlight = Extension.create({
  name: 'mentionHighlight',
  addProseMirrorPlugins: () => [new Plugin<MentionHighlightState>({
    key: mentionHighlightKey,
    props: { decorations: (state) => mentionHighlightKey.getState(state)?.decorations },
    state: {
      apply: (tr, old) => {
        const statuses: MentionStatuses | undefined = tr.getMeta(mentionHighlightKey) ?? old.statuses
        return tr.docChanged || statuses !== old.statuses ? { decorations: mentionDecorations(tr.doc, statuses), statuses } : old
      },
      init: () => ({ decorations: DecorationSet.empty, statuses: undefined }),
    },
  })],
})

export function setMentionStatuses(tr: Transaction, statuses: MentionStatuses | undefined): Transaction {
  return tr.setMeta(mentionHighlightKey, statuses ?? NO_STATUSES)
}

const NO_STATUSES: MentionStatuses = new Map()

function mentionDecorations(doc: ProseMirrorNode, statuses: MentionStatuses | undefined): DecorationSet {
  if (!statuses?.size) return DecorationSet.empty
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    // One character per position: text in code is blanked, other inline nodes stand in as one character.
    let text = ''
    node.forEach((child) => {
      if (!child.isText) text += '￼'
      else if (child.marks.some((mark) => mark.type.spec.code)) text += ' '.repeat(child.nodeSize)
      else text += child.text ?? ''
    })
    for (const range of findMentionRanges(text)) {
      const status = statuses.get(range.username.toLowerCase())
      if (status) decorations.push(Decoration.inline(pos + 1 + range.start, pos + 1 + range.end, { class: `mention-${status}`, 'data-mention-status': status }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}
