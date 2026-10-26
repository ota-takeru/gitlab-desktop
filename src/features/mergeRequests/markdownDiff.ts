import type { ParsedLine } from './diffParser'

/** One consecutive edited stretch; unchanged context is intentionally omitted.
 * The rendering layer receives Markdown text, never a second full-file body. */
export interface MarkdownChangeSide {
  text: string
  firstLine: number
  lastLine: number
}
export interface MarkdownChange {
  id: string
  old: MarkdownChangeSide | null
  new: MarkdownChangeSide | null
}

/** Diff hunks are delimited by context lines and hunk indices. Rendering each
 * changed stretch separately preserves headings, lists and inline formatting
 * while keeping unrelated document text out of the review. */
export function markdownDiffChanges(lines: readonly ParsedLine[]): MarkdownChange[] {
  const changes: MarkdownChange[] = []
  let before: ParsedLine[] = []
  let after: ParsedLine[] = []
  let currentHunk: number | undefined

  const makeSide = (part: ParsedLine[], side: 'old' | 'new'): MarkdownChangeSide | null => {
    if (part.length === 0) return null
    const numbers = part.map((line) => side === 'old' ? line.oldLine : line.newLine)
    const firstLine = numbers[0]
    const lastLine = numbers[numbers.length - 1]
    if (firstLine === undefined || lastLine === undefined) return null
    return { firstLine, lastLine, text: part.map((line) => line.text).join('\n') }
  }
  const flush = () => {
    const old = makeSide(before, 'old')
    const next = makeSide(after, 'new')
    if (old || next) changes.push({ id: `${currentHunk ?? 'unknown'}:${old?.firstLine ?? ''}:${next?.firstLine ?? ''}:${changes.length}`, old, new: next })
    before = []
    after = []
  }

  for (const line of lines) {
    if (currentHunk !== undefined && line.hunk !== currentHunk) flush()
    currentHunk = line.hunk
    if (line.kind === 'context') {
      flush()
    } else if (line.kind === 'remove') {
      before.push(line)
    } else {
      after.push(line)
    }
  }
  flush()
  return changes
}
