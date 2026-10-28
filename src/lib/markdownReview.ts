import type { FullFileDiffAnnotations, RemovedFileLines } from '../features/mergeRequests/fullFileAnnotations'
import { translate } from '../i18n/i18n'

/** Minimal HAST structure used by the rehype plugin. No raw HTML or
 * user-controlled markup is introduced; deleted source becomes text nodes. */
interface ReviewNode {
  type: string
  tagName?: string
  value?: string
  children?: ReviewNode[]
  properties?: Record<string, unknown>
  position?: { start?: { line: number }; end?: { line: number } }
}

const changeBlocks = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre', 'blockquote', 'tr', 'hr'])
const text = (value: string): ReviewNode => ({ type: 'text', value })

function removedElement(item: RemovedFileLines): ReviewNode {
  const numbers = item.oldStart === item.oldEnd ? String(item.oldStart) : `${item.oldStart}–${item.oldEnd}`
  return {
    type: 'element', tagName: 'div',
    properties: { 'data-review-deleted': 'true', 'data-file-anchor': String(item.anchorLine), 'aria-label': translate('common.markdownReview.removedLabel', { lines: numbers }) },
    children: [
      // A UI badge rather than a sentence, so it is not mistaken for the document's own text.
      { type: 'element', tagName: 'span', properties: { 'aria-hidden': 'true', 'data-review-marker': 'remove', title: translate('common.markdownReview.removedTitle', { lines: numbers }) }, children: [text(`− L${numbers}`)] },
      { type: 'element', tagName: 'pre', properties: {}, children: [text(item.text)] },
    ],
  }
}

function labelBlocks(node: ReviewNode, added: ReadonlySet<number>, parent: string | undefined) {
  const from = node.position?.start?.line
  const to = node.position?.end?.line ?? from
  if (node.type === 'element' && from !== undefined && to !== undefined) {
    node.properties = { ...node.properties, 'data-source-start': String(from), 'data-source-end': String(to) }
    // Mark the most specific block possible: individual list items rather than
    // the entire list, and a paragraph only when it is not inside a list item.
    if (changeBlocks.has(node.tagName ?? '') && !(parent === 'li' && node.tagName === 'p')) {
      for (let line = from; line <= to; line += 1) {
        if (added.has(line)) {
          node.properties['data-review-change'] = 'add'
          break
        }
      }
    }
  }
  for (const child of node.children ?? []) labelBlocks(child, added, node.tagName)
}

/** Annotate actual rendered Markdown blocks by their source positions, while
 * inserting explicit old-version deletion markers near the surviving text. */
export function rehypeReviewDiff(annotations: FullFileDiffAnnotations, showBlame = false) {
  return () => (root: ReviewNode) => {
    for (const child of root.children ?? []) labelBlocks(child, annotations.addedLines, undefined)
    if (!root.children) return
    const withBlame = (node: ReviewNode): ReviewNode => {
      const line = node.position?.start?.line
      // Synthetic old-revision deletions have no line in the current file.
      if (!showBlame || !line || node.type !== 'element' || node.properties?.['data-review-deleted']) return node
      return {
        type: 'element',
        tagName: 'div',
        properties: { 'data-review-blame-line': String(line) },
        position: node.position,
        children: [node],
      }
    }
    if (annotations.removedByAnchor.size === 0) {
      root.children = root.children.map(withBlame)
      return
    }
    const groups = [...annotations.removedByAnchor.values()].flat().sort((a,b)=>a.anchorLine-b.anchorLine)
    const updated: ReviewNode[] = []
    let next = 0
    for (const child of root.children) {
      const end = child.position?.end?.line
      if (end !== undefined) {
        while (next < groups.length && groups[next].anchorLine <= end) {
          updated.push(removedElement(groups[next]))
          next += 1
        }
      }
      updated.push(child)
    }
    while (next < groups.length) {
      updated.push(removedElement(groups[next]))
      next += 1
    }
    root.children = updated.map(withBlame)
  }
}
