import { splitFileLines, type ParsedLine } from './diffParser'

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

/** Where the lines around an edit are read from: the whole diff and, when it has been read, the new file. */
export interface MarkdownDiffSource {
  diffLines: readonly ParsedLine[]
  content?: string | null
}

/** Diff hunks are delimited by context lines and hunk indices. Rendering each
 * changed stretch separately preserves headings, lists and inline formatting
 * while keeping unrelated document text out of the review. An edit inside a
 * table, a fenced code block or a nested list keeps the table header, the fence
 * or the list's indentation it needs to render as that structure. */
export function markdownDiffChanges(lines: readonly ParsedLine[], source?: MarkdownDiffSource): MarkdownChange[] {
  const changes: MarkdownChange[] = []
  const sides = sideLines(source?.diffLines ?? lines, source?.content)
  for (const { hunk, old: before, new: after } of editedStretches(lines)) {
    const makeSide = (part: ParsedLine[], side: 'old' | 'new'): MarkdownChangeSide | null => {
      const range = lineRange(part, side)
      return range && { ...range, text: withStructure(part.map((line) => line.text), linesBefore(sides[side], range.firstLine)) }
    }
    const old = makeSide(before, 'old')
    const next = makeSide(after, 'new')
    if (old || next) changes.push({ id: `${hunk ?? 'unknown'}:${old?.firstLine ?? ''}:${next?.firstLine ?? ''}:${changes.length}`, old, new: next })
  }
  return changes
}

/** Whether an edit may be in a table, a fenced block or a list whose start the diff does not show,
 * so the whole new file is needed to render it; other diffs render without reading the file. */
export function markdownDiffNeedsFile(lines: readonly ParsedLine[], diffLines: readonly ParsedLine[] = lines): boolean {
  const sides = sideLines(diffLines)
  return editedStretches(lines).some((stretch) => (['old', 'new'] as const).some((side) => {
    const range = lineRange(stretch[side], side)
    if (!range) return false
    const before = linesBefore(sides[side], range.firstLine)
    if (range.firstLine - before.length === 1) return false
    const part = stretch[side].map((line) => line.text)
    const indent = minIndent(part)
    return (isTableRow(part[0]) && tableHeader(part, before).length === 0)
      || [...before, ...part].some((line) => FENCE.test(line))
      || (indent > 0 && !before.some((line) => line.trim() !== '' && indentOf(line) < indent))
  }))
}

interface EditedStretch { hunk: number | undefined; old: ParsedLine[]; new: ParsedLine[] }

/** Consecutive removed and added lines, split at context lines and hunks. */
function editedStretches(lines: readonly ParsedLine[]): EditedStretch[] {
  const stretches: EditedStretch[] = []
  let before: ParsedLine[] = []
  let after: ParsedLine[] = []
  let currentHunk: number | undefined
  const flush = () => {
    if (before.length || after.length) stretches.push({ hunk: currentHunk, old: before, new: after })
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
  return stretches
}

function lineRange(part: readonly ParsedLine[], side: 'old' | 'new'): { firstLine: number; lastLine: number } | null {
  if (part.length === 0) return null
  const firstLine = side === 'old' ? part[0].oldLine : part[0].newLine
  const lastLine = side === 'old' ? part[part.length - 1].oldLine : part[part.length - 1].newLine
  return firstLine === undefined || lastLine === undefined ? null : { firstLine, lastLine }
}

/** Each side's known lines by number (index = line - 1). The whole file when the new file matches the diff
 * (the old one is rebuilt from it), otherwise only the lines the diff shows. */
function sideLines(diffLines: readonly ParsedLine[], content?: string | null): { old: (string | undefined)[]; new: (string | undefined)[] } {
  const file = typeof content === 'string' ? splitFileLines(content) : null
  if (file && diffLines.every((line) => line.kind === 'remove' || (line.newLine !== undefined && file[line.newLine - 1] === line.text))) {
    const old: string[] = []
    let next = 1
    for (const line of diffLines) {
      if (line.kind === 'remove') {
        while (line.oldLine !== undefined && old.length + 1 < line.oldLine && next <= file.length) old.push(file[next++ - 1])
        old.push(line.text)
      } else if (line.newLine !== undefined) {
        while (next < line.newLine) old.push(file[next++ - 1])
        if (line.kind === 'context') old.push(line.text)
        next = line.newLine + 1
      }
    }
    while (next <= file.length) old.push(file[next++ - 1])
    return { old, new: file }
  }
  const old: (string | undefined)[] = []
  const shown: (string | undefined)[] = []
  for (const line of diffLines) {
    if (line.kind !== 'add' && line.oldLine !== undefined) old[line.oldLine - 1] = line.text
    if (line.kind !== 'remove' && line.newLine !== undefined) shown[line.newLine - 1] = line.text
  }
  return { old, new: shown }
}

/** The known lines right before `line`, up to the first unknown one. */
function linesBefore(side: readonly (string | undefined)[], line: number): string[] {
  let start = line - 1
  while (start > 0 && side[start - 1] !== undefined) start -= 1
  return side.slice(start, line - 1) as string[]
}

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/u
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/u
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/u
const indentOf = (line: string) => /^\s*/u.exec(line)![0].length
const isTableRow = (line: string) => line.trim() !== '' && line.includes('|')
const minIndent = (lines: readonly string[]) => {
  const written = lines.filter((line) => line.trim() !== '')
  return written.length ? Math.min(...written.map(indentOf)) : 0
}

/** The header (and delimiter) rows an edit starting inside a table needs from before it. */
function tableHeader(part: readonly string[], before: readonly string[]): string[] {
  if (TABLE_DELIMITER.test(part[0])) return before.length && isTableRow(before[before.length - 1]) ? [before[before.length - 1]] : []
  if (part.length > 1 && TABLE_DELIMITER.test(part[1])) return []
  let index = before.length - 1
  while (index > 0 && isTableRow(before[index]) && !TABLE_DELIMITER.test(before[index])) index -= 1
  return index > 0 && TABLE_DELIMITER.test(before[index]) && isTableRow(before[index - 1]) ? [before[index - 1], before[index]] : []
}

interface OpenFence { line: string; indent: number; marker: string }

/** The fence still open after `lines`, starting from `open`. */
function fenceAfter(lines: readonly string[], open: OpenFence | null): OpenFence | null {
  let current = open
  for (const line of lines) {
    const match = FENCE.exec(line)
    if (!match) continue
    const [, indent, marker, rest] = match
    if (!current) {
      if (marker[0] !== '`' || !rest.includes('`')) current = { indent: indent.length, line, marker }
    } else if (marker[0] === current.marker[0] && marker.length >= current.marker.length && rest.trim() === '') {
      current = null
    }
  }
  return current
}

/** Removes up to `count` leading whitespace characters from each line. */
const dedent = (lines: readonly string[], count: number) => lines.map((line) => line.slice(Math.min(count, indentOf(line))))

/** The edited lines with the lines they need from before them to render as the structure they are in. */
function withStructure(part: readonly string[], before: readonly string[]): string {
  const open = fenceAfter(before, null)
  if (open) {
    // Inside a fenced block: reopen it, and close it if it runs past the edit.
    const lines = [open.line, ...part]
    if (fenceAfter(part, open)) lines.push(`${' '.repeat(open.indent)}${open.marker}`)
    return dedent(lines, open.indent).join('\n')
  }
  const lines = [...part]
  const opened = fenceAfter(part, null)
  if (opened) lines.push(`${' '.repeat(opened.indent)}${opened.marker}`)
  // Table rows render as a table only under their header and delimiter rows.
  if (isTableRow(part[0])) lines.unshift(...tableHeader(part, before))
  // Lines indented under a list item are read at the list's own level, not as an indented code block.
  const indent = minIndent(lines)
  if (indent > 0) {
    const parent = [...before].reverse().find((line) => line.trim() !== '' && indentOf(line) < indent)
    if (parent && LIST_ITEM.test(parent)) return dedent(lines, indent).join('\n')
  }
  return lines.join('\n')
}
