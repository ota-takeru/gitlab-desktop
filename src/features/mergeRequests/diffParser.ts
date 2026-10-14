export type ParsedLineKind = 'add' | 'remove' | 'context'

export type DiffParseStatus = 'valid' | 'invalid' | 'truncated'

export interface ParsedLine {
  kind: ParsedLineKind
  newLine?: number
  oldLine?: number
  newPath: string
  oldPath: string
  prefix: '+' | '-' | ' '
  text: string
  /** False when the hunk did not contain enough trusted metadata for a comment. */
  commentable: boolean
  /** Index of the line's hunk in `ParsedDiff.hunks`; multi-line comments stay within one. */
  hunk?: number
  /** The hunk's counters at the line on both sides, as GitLab's line codes count them. */
  oldPosition?: number
  newPosition?: number
  /** A removed and an added line that differ only in whitespace, shown as one unchanged line. */
  whitespaceOnly?: boolean
}

/** A hunk as its `@@ -oldStart,oldCount +newStart,newCount @@` header gives it. */
export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

export interface ParsedDiff {
  lines: ParsedLine[]
  status: DiffParseStatus
  /** A short, non-sensitive explanation suitable for a local UI message. */
  issue?: 'invalid-hunk' | 'truncated-hunk' | 'invalid-line'
  hunks?: DiffHunk[]
}

interface HunkState {
  oldLine: number
  newLine: number
  oldRemaining: number
  newRemaining: number
  lineStart: number
  valid: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/u
const NO_NEWLINE_METADATA = /^\\ No newline at end of file$/u

function parseSafeInteger(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parseHunkHeader(raw: string): HunkState | undefined {
  const match = HUNK_HEADER.exec(raw)
  if (!match) return undefined
  const oldLine = parseSafeInteger(match[1])
  const oldCount = parseSafeInteger(match[2] ?? '1')
  const newLine = parseSafeInteger(match[3])
  const newCount = parseSafeInteger(match[4] ?? '1')
  if (oldLine === undefined || oldCount === undefined || newLine === undefined || newCount === undefined) return undefined
  if ((oldCount > 0 && oldLine === 0) || (newCount > 0 && newLine === 0)
    || !Number.isSafeInteger(oldLine + oldCount) || !Number.isSafeInteger(newLine + newCount)) return undefined
  return { oldLine, newLine, oldRemaining: oldCount, newRemaining: newCount, lineStart: 0, valid: true }
}

function markHunkUncommentable(lines: ParsedLine[], hunk: HunkState): void {
  for (let index = hunk.lineStart; index < lines.length; index += 1) lines[index].commentable = false
}

/**
 * Parse the unified diff text returned by GitLab.
 *
 * File headers are only meaningful outside a hunk. Inside a hunk the first
 * character is the record prefix, so lines such as `+++ generated.ts` remain
 * ordinary additions. Counts from every hunk are checked before its lines are
 * made commentable.
 */
export function parseDiff(diff: string, oldPath: string, newPath: string): ParsedDiff {
  const rawLines = diff.split(/\r?\n/u)
  if (rawLines.at(-1) === '') rawLines.pop()

  const lines: ParsedLine[] = []
  const hunks: DiffHunk[] = []
  let hunk: HunkState | undefined
  let status: DiffParseStatus = 'valid'
  let issue: ParsedDiff['issue']

  const finishHunk = (): void => {
    if (!hunk) return
    if (hunk.oldRemaining !== 0 || hunk.newRemaining !== 0) {
      hunk.valid = false
      if (status !== 'invalid') {
        status = 'truncated'
        issue = 'truncated-hunk'
      }
    }
    if (!hunk.valid) markHunkUncommentable(lines, hunk)
    hunk = undefined
  }

  for (const raw of rawLines) {
    const header = parseHunkHeader(raw)
    if (header) {
      finishHunk()
      header.lineStart = lines.length
      hunk = header
      hunks.push({ newCount: header.newRemaining, newStart: header.newLine, oldCount: header.oldRemaining, oldStart: header.oldLine })
      continue
    }

    if (raw.startsWith('@@')) {
      finishHunk()
      status = 'invalid'
      issue = 'invalid-hunk'
      continue
    }

    if (!hunk) {
      // `---`/`+++`, `diff`, and `index` lines are file headers. They do not
      // create rows until a valid hunk header is encountered.
      continue
    }

    // Git emits this metadata without a line prefix. It describes the
    // previous record and must never consume either side's line count.
    if (NO_NEWLINE_METADATA.test(raw)) continue

    if (raw.startsWith('diff --git ')) {
      finishHunk()
      continue
    }

    const prefix = raw[0]
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') {
      hunk.valid = false
      status = 'invalid'
      issue = 'invalid-line'
      markHunkUncommentable(lines, hunk)
      // Ignore the rest until the next hunk header. This avoids assigning
      // invented positions to a malformed or prematurely terminated hunk.
      hunk = undefined
      continue
    }

    // Once both counts reach zero, another prefixed record is extra data and
    // must not silently become a commentable line.
    if (hunk.oldRemaining === 0 && hunk.newRemaining === 0) {
      hunk.valid = false
      status = 'invalid'
      issue = 'invalid-hunk'
      markHunkUncommentable(lines, hunk)
      hunk = undefined
      continue
    }

    const kind: ParsedLineKind = prefix === '+' ? 'add' : prefix === '-' ? 'remove' : 'context'
    const consumesOld = kind !== 'add'
    const consumesNew = kind !== 'remove'
    if ((consumesOld && hunk.oldRemaining === 0) || (consumesNew && hunk.newRemaining === 0)) {
      hunk.valid = false
      status = 'invalid'
      issue = 'invalid-hunk'
      markHunkUncommentable(lines, hunk)
      hunk = undefined
      continue
    }

    const parsedLine: ParsedLine = {
      kind,
      newLine: kind === 'remove' ? undefined : hunk.newLine,
      oldLine: kind === 'add' ? undefined : hunk.oldLine,
      newPath,
      oldPath,
      prefix,
      text: raw.slice(1),
      commentable: true,
      hunk: hunks.length - 1,
      oldPosition: hunk.oldLine,
      newPosition: hunk.newLine,
    }
    lines.push(parsedLine)
    if (consumesOld) {
      hunk.oldRemaining -= 1
      hunk.oldLine += 1
    }
    if (consumesNew) {
      hunk.newRemaining -= 1
      hunk.newLine += 1
    }
  }

  finishHunk()
  return { lines, status, issue, hunks }
}

/** Above this many removed × added lines in one block, lines are paired in order instead of by best match. */
const MAX_WHITESPACE_MATCH_CELLS = 250_000

/**
 * Approximates `git diff -w` on GitLab's diff, which has no whitespace option:
 * within each block of removed and added lines, pairs whose text is equal
 * once all whitespace is removed become one unchanged line (with both line
 * numbers and the new text). Other lines keep their order and kind.
 */
export function ignoreWhitespace(lines: ParsedLine[]): { lines: ParsedLine[]; changed: boolean } {
  const result: ParsedLine[] = []
  let changed = false
  let index = 0
  while (index < lines.length) {
    if (lines[index].kind === 'context') { result.push(lines[index]); index += 1; continue }
    const removed: ParsedLine[] = []
    const added: ParsedLine[] = []
    while (index < lines.length && lines[index].kind !== 'context') {
      (lines[index].kind === 'remove' ? removed : added).push(lines[index])
      index += 1
    }
    const pairs = matchWhitespacePairs(removed, added)
    let removedAt = 0
    let addedAt = 0
    for (const [removedIndex, addedIndex] of [...pairs, [removed.length, added.length] as const]) {
      while (removedAt < removedIndex) { result.push(removed[removedAt]); removedAt += 1; changed = true }
      while (addedAt < addedIndex) { result.push(added[addedAt]); addedAt += 1; changed = true }
      if (removedIndex === removed.length) break
      const before = removed[removedIndex]
      const after = added[addedIndex]
      result.push({ ...after, kind: 'context', oldLine: before.oldLine, prefix: ' ', whitespaceOnly: true })
      removedAt += 1
      addedAt += 1
    }
  }
  return { changed, lines: result }
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/gu, '')
}

/** Removed/added index pairs that are equal without whitespace, in order (a longest common subsequence). */
function matchWhitespacePairs(removed: ParsedLine[], added: ParsedLine[]): Array<readonly [number, number]> {
  if (!removed.length || !added.length) return []
  const left = removed.map((line) => withoutWhitespace(line.text))
  const right = added.map((line) => withoutWhitespace(line.text))
  if (left.length * right.length > MAX_WHITESPACE_MATCH_CELLS) {
    const pairs: Array<readonly [number, number]> = []
    for (let at = 0; at < Math.min(left.length, right.length); at += 1) if (left[at] === right[at]) pairs.push([at, at])
    return pairs
  }
  const width = right.length + 1
  const lengths = new Uint32Array((left.length + 1) * width)
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      lengths[row * width + column] = left[row] === right[column]
        ? lengths[(row + 1) * width + column + 1] + 1
        : Math.max(lengths[(row + 1) * width + column], lengths[row * width + column + 1])
    }
  }
  const pairs: Array<readonly [number, number]> = []
  let row = 0
  let column = 0
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) { pairs.push([row, column]); row += 1; column += 1 }
    else if (lengths[(row + 1) * width + column] >= lengths[row * width + column + 1]) row += 1
    else column += 1
  }
  return pairs
}

/** Split a text file into logical lines without inventing a row after EOF. */
export function splitFileLines(content: string): string[] {
  const lines = content.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  return lines
}
