import type { FullFileDiffAnnotations, RemovedFileLines } from '../features/mergeRequests/fullFileAnnotations'

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
    properties: { 'data-review-deleted': 'true', 'data-file-anchor': String(item.anchorLine), 'aria-label': `変更前の削除 ${numbers}行` },
    children: [
      { type: 'element', tagName: 'strong', children: [text(`− 削除された内容（旧版 ${numbers}行）`)] },
      { type: 'element', tagName: 'pre', children: [text(item.text)] },
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
export function rehypeReviewDiff(annotations: FullFileDiffAnnotations) {
  return () => (root: ReviewNode) => {
    for (const child of root.children ?? []) labelBlocks(child, annotations.addedLines, undefined)
    if (!root.children || annotations.removedByAnchor.size === 0) return
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
    root.children = updated
  }
}
