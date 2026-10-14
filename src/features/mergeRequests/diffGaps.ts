import { splitFileLines, type ParsedLine } from './diffParser'

/** Hidden lines are revealed a bounded step at a time, like a diff page. */
export const GAP_STEP = 600

/** Unchanged lines GitLab omitted before a displayed diff line. */
export interface DiffGapInfo {
  count: number
  oldPath: string
  newPath: string
  /** First hidden line on each side; unknown when the diff around the gap does not tell. */
  start?: { oldLine: number; newLine: number }
  /** The first displayed new-side line after the gap, to check the file matches the diff. */
  next?: { newLine: number; text: string }
}

/**
 * Number of unchanged lines omitted before each displayed line, and where they
 * start. Hidden lines are unchanged, so both sides shift by the offset of the
 * context line next to the gap (zero before the first change of the file).
 */
export function diffGaps(lines: ParsedLine[], startIndex: number): DiffGapInfo[] {
  let lastOld: number | undefined
  let lastNew: number | undefined
  return lines.map((line, index) => {
    const first = startIndex + index === 0
    let count = 0
    if (first) count = Math.max(0, (line.newLine ?? line.oldLine ?? 1) - 1)
    else if (line.newLine !== undefined && lastNew !== undefined) count = Math.max(0, line.newLine - lastNew - 1)
    else if (line.oldLine !== undefined && lastOld !== undefined) count = Math.max(0, line.oldLine - lastOld - 1)
    if (line.oldLine !== undefined) lastOld = line.oldLine
    if (line.newLine !== undefined) lastNew = line.newLine
    const gap: DiffGapInfo = { count, newPath: line.newPath, oldPath: line.oldPath }
    if (count === 0) return gap
    const previous = index > 0 ? lines[index - 1] : undefined
    const offset = line.kind === 'context' ? line.oldLine! - line.newLine!
      : previous?.kind === 'context' ? previous.oldLine! - previous.newLine!
        : first ? 0 : undefined
    if (offset !== undefined) {
      const newEnd = line.newLine !== undefined ? line.newLine - 1 : line.oldLine! - 1 - offset
      const start = { newLine: newEnd - count + 1, oldLine: newEnd - count + 1 + offset }
      if (start.newLine >= 1 && start.oldLine >= 1) gap.start = start
    }
    const next = lines.slice(index).find((candidate) => candidate.newLine !== undefined)
    if (next?.newLine !== undefined) gap.next = { newLine: next.newLine, text: next.text }
    return gap
  })
}

/** The hidden lines of a gap read from the file, or null when the file does not match the diff. */
export function gapLines(content: string, gap: DiffGapInfo, shown: number): ParsedLine[] | null {
  if (!gap.start) return null
  const file = splitFileLines(content)
  const { newLine, oldLine } = gap.start
  if (newLine + gap.count - 1 > file.length) return null
  if (gap.next && file[gap.next.newLine - 1] !== gap.next.text) return null
  return file.slice(newLine - 1, newLine - 1 + Math.min(shown, gap.count)).map((text, index) => ({
    commentable: false,
    kind: 'context',
    newLine: newLine + index,
    newPath: gap.newPath,
    oldLine: oldLine + index,
    oldPath: gap.oldPath,
    prefix: ' ',
    text,
  }))
}
