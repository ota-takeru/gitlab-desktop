import type { Diff, Position } from '../../types/gitlab'
import { parseDiff, type ParsedLine } from './diffParser'

/** Lines shown before and after the commented line. */
export const LINES_BEFORE = 4
export const LINES_AFTER = 2

/** The commented line and its neighbours within the same hunk. */
export function diffExcerpt(diff: Diff, position: Position): { lines: ParsedLine[]; target: number } | null {
  const parsed = parseDiff(diff.diff, diff.oldPath, diff.newPath)
  const index = parsed.lines.findIndex((line) => position.newLine !== undefined
    ? line.kind !== 'remove' && line.newLine === position.newLine
    : line.kind !== 'add' && line.oldLine === position.oldLine)
  if (index < 0) return null
  let start = index
  while (start > 0 && index - start < LINES_BEFORE && contiguous(parsed.lines[start - 1], parsed.lines[start])) start -= 1
  let end = index
  while (end < parsed.lines.length - 1 && end - index < LINES_AFTER && contiguous(parsed.lines[end], parsed.lines[end + 1])) end += 1
  return { lines: parsed.lines.slice(start, end + 1), target: index - start }
}

/** Whether two parsed lines follow each other in one hunk. */
function contiguous(previous: ParsedLine, next: ParsedLine): boolean {
  const follows = (before: number | undefined, after: number | undefined) => before === undefined || after === undefined || after === before + 1
  // An added line keeps the old cursor and a removed one the new cursor, so
  // compare only the side both lines carry.
  if (previous.kind === 'add' && next.kind === 'remove') return true
  if (previous.kind === 'remove' && next.kind === 'add') return true
  return follows(previous.oldLine, next.oldLine) && follows(previous.newLine, next.newLine)
}
