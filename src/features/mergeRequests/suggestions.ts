import type { Diff, LineRangePoint, Position } from '../../types/gitlab'
import { parseDiff, type DiffHunk, type ParsedLine } from './diffParser'

/**
 * GitLab's suggestions (```` ```suggestion:-N+M ````) replace the commented
 * line, N lines above it and M below it, at most 100 each way.
 */
export const MAX_SUGGESTION_LINES_ABOVE = 100

/** A position on one line, or on a range of lines `from`..`to` of one hunk ending at `to`. */
export function rangePosition(lines: ParsedLine[], hunks: DiffHunk[], from: number, to: number): Position | undefined {
  const start = lines[from]
  const end = lines[to]
  if (!start || !end || !start.commentable || !end.commentable || (end.newLine === undefined && end.oldLine === undefined)) return undefined
  const position: Position = { baseSha: '', headSha: '', newLine: end.newLine, newPath: end.newPath, oldLine: end.oldLine, oldPath: end.oldPath, positionType: 'text', startSha: '' }
  if (from === to) return position
  const hunk = end.hunk === undefined ? undefined : hunks[end.hunk]
  if (!hunk || from > to || start.hunk !== end.hunk) return undefined
  return { ...position, lineRange: { end: rangePoint(end), hunk, start: rangePoint(start) } }
}

function rangePoint(line: ParsedLine): LineRangePoint {
  return { newLine: line.newLine, newPosition: line.newPosition, oldLine: line.oldLine, oldPosition: line.oldPosition }
}

/** True when the line is the one a position (or a range end) names. */
export function isLineAt(line: Pick<ParsedLine, 'oldLine' | 'newLine'>, point: Pick<LineRangePoint, 'oldLine' | 'newLine'>): boolean {
  return line.oldLine === point.oldLine && line.newLine === point.newLine
}

/** Indices of the first and last line a position covers in `lines`, or null when it is not there. */
export function positionIndexRange(lines: ParsedLine[], position: Position): [number, number] | null {
  const end = lines.findIndex((line) => isLineAt(line, position))
  if (end < 0) return null
  const range = position.lineRange
  if (!range) return [end, end]
  const start = lines.findIndex((line) => isLineAt(line, range.start))
  return start >= 0 && start <= end ? [start, end] : [end, end]
}

/**
 * The text a suggestion on `position` replaces: the commented lines that exist
 * after the change. Null when the comment ends on a removed line, where GitLab
 * offers no suggestion, or when the lines are not in the loaded diffs.
 */
export function suggestionSourceLines(diffs: Diff[], position: Position): string[] | null {
  if (position.newLine === undefined) return null
  const diff = diffs.find((item) => item.newPath === position.newPath && item.oldPath === position.oldPath)
    ?? diffs.find((item) => item.newPath === position.newPath)
  if (!diff) return null
  const lines = parseDiff(diff.diff, diff.oldPath, diff.newPath).lines
  const range = positionIndexRange(lines, position)
  return range ? lines.slice(range[0], range[1] + 1).filter((line) => line.kind !== 'remove').map((line) => line.text) : null
}

/** A suggestion block that starts as the current text of `lines`, the last of which is commented on. */
export function suggestionBlock(lines: string[]): string {
  const longestRun = Math.max(0, ...lines.flatMap((line) => Array.from(line.matchAll(/`+/gu), (match) => match[0].length)))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  const above = lines.length > 1 ? `:-${lines.length - 1}+0` : ''
  return `${fence}suggestion${above}\n${lines.join('\n')}\n${fence}`
}

export type BodySegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'suggestion'; lines: string[]; above: number; below: number }

const SUGGESTION_START = /^ {0,3}(`{3,}|~{3,})[ \t]*suggestion(?::-(\d+)\+(\d+))?[ \t]*$/u
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/u

/** Quick test before splitting, so comments without suggestions keep the plain Markdown view. */
export function hasSuggestionBlock(body: string): boolean {
  return /^ {0,3}(`{3,}|~{3,})[ \t]*suggestion\b/mu.test(body)
}

/**
 * Splits a comment into Markdown and suggestion blocks, in order. Other fenced
 * code is kept as Markdown, so a suggestion shown as an example inside it is
 * not taken for one.
 */
export function splitSuggestions(body: string): BodySegment[] {
  const segments: BodySegment[] = []
  const text: string[] = []
  const flushText = () => {
    if (text.some((line) => line.trim())) segments.push({ kind: 'markdown', text: text.join('\n') })
    text.length = 0
  }
  const rows = body.split(/\r?\n/u)
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    const suggestion = SUGGESTION_START.exec(row)
    const fence = suggestion ? suggestion[1] : FENCE_START.exec(row)?.[1]
    if (!fence) { text.push(row); index += 1; continue }
    const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`, 'u')
    let end = index + 1
    while (end < rows.length && !closing.test(rows[end])) end += 1
    if (suggestion) {
      flushText()
      segments.push({ above: Number(suggestion[2] ?? 0), below: Number(suggestion[3] ?? 0), kind: 'suggestion', lines: rows.slice(index + 1, end) })
    } else {
      text.push(...rows.slice(index, end + 1))
    }
    index = end + 1
  }
  flushText()
  return segments
}

/** Content lines of GitLab's `from_content`, which ends with a newline. */
export function contentLines(content: string): string[] {
  const lines = content.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  return lines
}
