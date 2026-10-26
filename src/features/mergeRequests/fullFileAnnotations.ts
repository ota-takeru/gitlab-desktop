import type { ParsedLine } from './diffParser'

export interface RemovedFileLines {
  /** One-based line of the current file BEFORE which the removed code belonged. */
  anchorLine: number
  oldStart: number
  oldEnd: number
  text: string
}

export interface FullFileDiffAnnotations {
  addedLines: ReadonlySet<number>
  removedByAnchor: ReadonlyMap<number, readonly RemovedFileLines[]>
  /** Do not show inaccurate marks if the selected file does not match the diff. */
  consistent: boolean
}

/** The new-side file cannot contain deleted code; retain it as explicit
 * previous-revision context anchored between the surviving lines. */
export function annotateFullFile(lines: readonly ParsedLine[], content: string): FullFileDiffAnnotations {
  const current = content.replace(/\r\n?/gu, '\n').split('\n')
  if (content.endsWith('\n')) current.pop()
  const addedLines = new Set<number>()
  const removed = new Map<number, RemovedFileLines[]>()
  let before: ParsedLine[] = []
  let firstAdded: number | undefined
  let precedingNewLine = 0
  let hunk: number | undefined
  let consistent = true

  const flush = (nextNewLine?: number) => {
    if (before.length) {
      const oldStart = before[0].oldLine
      const oldEnd = before[before.length - 1].oldLine
      if (oldStart !== undefined && oldEnd !== undefined) {
        const anchorLine = Math.max(1, Math.min(current.length + 1, firstAdded ?? nextNewLine ?? precedingNewLine + 1))
        const range = { anchorLine, oldStart, oldEnd, text: before.map((line) => line.text).join('\n') }
        removed.set(anchorLine, [...(removed.get(anchorLine) ?? []), range])
      }
    }
    before = []
    firstAdded = undefined
  }

  for (const line of lines) {
    if (hunk !== undefined && hunk !== line.hunk) flush(line.newLine)
    hunk = line.hunk
    if (line.kind === 'context') {
      flush(line.newLine)
      if (line.newLine !== undefined) precedingNewLine = line.newLine
    } else if (line.kind === 'add') {
      if (line.newLine !== undefined) {
        firstAdded ??= line.newLine
        addedLines.add(line.newLine)
        if (current[line.newLine - 1] !== line.text) consistent = false
        precedingNewLine = line.newLine
      }
    } else {
      before.push(line)
    }
  }
  flush()
  return { addedLines, removedByAnchor: removed, consistent }
}

/** Keep file paging in 1,000-line windows while opening the page of the
 * requested diff line rather than the first page. */
export function filePageStart(line: number, totalLines: number, pageSize: number): number {
  const actual = Math.max(1, Math.min(Math.max(1, totalLines), Math.floor(line) || 1))
  return Math.floor((actual - 1) / pageSize) * pageSize
}

/** A deletion has no new-side line. Find the next surviving line, or the
 * boundary immediately following the last available new-side line. */
export function firstChangedFileLine(lines: readonly ParsedLine[]): number {
  const first = lines.findIndex((line) => line.kind !== 'context')
  if (first < 0) return lines[0]?.newLine ?? 1
  for (let index = first; index < lines.length; index += 1) {
    if (lines[index].newLine !== undefined) return lines[index].newLine!
    if (index > first && lines[index].kind === 'context') break
  }
  for (let index = first - 1; index >= 0; index -= 1) {
    if (lines[index].newLine !== undefined) return lines[index].newLine! + 1
  }
  return 1
}
