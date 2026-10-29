import type { BlameBlock, Diff } from '../../types/gitlab'
import { blameAttributions } from './blameLines'
import { parseDiff, type DiffHunk, type ParsedLine } from './diffParser'

/** Inclusive, 1-based line numbers of one revision of a file. */
export interface LineRange { start: number; end: number }

/** The lines to follow back from one revision. */
export interface HistoryCursor { sha: string; path: string; range: LineRange }

export type HistoryStop = 'added' | 'created' | 'root' | 'unavailable' | 'unmatched' | 'tooWide'

export interface HistoryStep {
  commit: Pick<BlameBlock, 'commitId' | 'title' | 'authorName' | 'committedAt'>
  /** The file's path in this commit. */
  path: string
  /** The followed lines in this commit, and where they came from in its parent. */
  range: LineRange
  before: LineRange | null
  /** The commit's changes that touch the followed lines, each a run of one hunk. */
  segments: ParsedLine[][]
  next: HistoryCursor | null
  stop?: HistoryStop
}

export interface HistoryFetchers {
  blame: (sha: string, path: string, start: number, end: number) => Promise<BlameBlock[]>
  commitDiff: (sha: string, page: number) => Promise<Diff[]>
}

/** GitLab's blame takes at most 100 lines a call; wider ranges are read in parts up to this. */
export const MAX_HISTORY_LINES = 400
const BLAME_CHUNK = 100
/** The page size the native side asks GitLab for. */
const COMMIT_DIFF_PAGE = 30
const MAX_COMMIT_DIFF_PAGES = 10
const SEGMENT_CONTEXT = 3

const sameText = (left: string, right: string) => left.replace(/\r$/u, '') === right.replace(/\r$/u, '')

/** The new-side number of the first of consecutive added lines that read `texts`, nearest to `near`. */
export function findAddedRun(lines: readonly ParsedLine[], texts: readonly string[], near: number): number | null {
  let best: number | null = null
  for (let index = 0; index + texts.length <= lines.length; index += 1) {
    const first = lines[index]
    if (first.kind !== 'add' || first.newLine === undefined) continue
    const matches = texts.every((text, offset) => {
      const line = lines[index + offset]
      return line.kind === 'add' && line.newLine === first.newLine! + offset && sameText(line.text, text)
    })
    if (matches && (best === null || Math.abs(first.newLine - near) < Math.abs(best - near))) best = first.newLine
  }
  return best
}

/**
 * Where the lines `range` of a commit's new side came from in its parent, as `git log -L` follows
 * them: unchanged lines move by the lines added or removed above them, and a change that touches
 * the range brings in all the lines it replaced. Null when the commit added every line of the range.
 */
export function rangeBeforeCommit(lines: readonly ParsedLine[], hunks: readonly DiffHunk[], range: LineRange): LineRange | null {
  const old: number[] = []
  const byNewLine = new Map<number, ParsedLine>()
  for (const line of lines) if (line.newLine !== undefined) byNewLine.set(line.newLine, line)
  for (let line = range.start; line <= range.end; line += 1) {
    const parsed = byNewLine.get(line)
    if (parsed) {
      if (parsed.kind === 'context' && parsed.oldLine !== undefined) old.push(parsed.oldLine)
      continue
    }
    // Outside every hunk: shifted by the hunks above it.
    let shift = 0
    for (const hunk of hunks) {
      const above = hunk.newCount > 0 ? hunk.newStart + hunk.newCount - 1 < line : hunk.newStart < line
      if (above) shift += hunk.oldCount - hunk.newCount
    }
    old.push(line + shift)
  }
  // Runs of changed lines within a hunk: what they removed belongs to the range when they touch it.
  let block: { removed: number[]; added: number[]; after: number } | null = null
  let lastNew = 0
  let hunkIndex: number | undefined
  const finish = () => {
    if (!block) return
    const touches = block.added.length
      ? block.added.some((line) => line >= range.start && line <= range.end)
      : block.after >= range.start && block.after + 1 <= range.end
    if (touches) old.push(...block.removed)
    block = null
  }
  for (const line of lines) {
    if (line.hunk !== hunkIndex) {
      finish()
      hunkIndex = line.hunk
      const hunk = line.hunk === undefined ? undefined : hunks[line.hunk]
      lastNew = hunk ? hunk.newCount > 0 ? hunk.newStart - 1 : hunk.newStart : 0
    }
    if (line.kind === 'context') {
      finish()
      lastNew = line.newLine ?? lastNew
      continue
    }
    block ??= { removed: [], added: [], after: lastNew }
    if (line.kind === 'remove' && line.oldLine !== undefined) block.removed.push(line.oldLine)
    if (line.kind === 'add' && line.newLine !== undefined) {
      block.added.push(line.newLine)
      lastNew = line.newLine
    }
  }
  finish()
  if (!old.length) return null
  return { start: Math.min(...old), end: Math.max(...old) }
}

/** The parts of a commit's hunks around the lines it changed in the followed range. */
export function historySegments(lines: readonly ParsedLine[], range: LineRange, before: LineRange | null): ParsedLine[][] {
  const followed = (line: ParsedLine) => line.kind === 'remove'
    ? Boolean(before && line.oldLine !== undefined && line.oldLine >= before.start && line.oldLine <= before.end)
    : line.newLine !== undefined && line.newLine >= range.start && line.newLine <= range.end
  const segments: ParsedLine[][] = []
  let start = 0
  while (start < lines.length) {
    let end = start
    while (end + 1 < lines.length && lines[end + 1].hunk === lines[start].hunk) end += 1
    const hunk = lines.slice(start, end + 1)
    const changed = hunk.flatMap((line, index) => line.kind !== 'context' && followed(line) ? [index] : [])
    if (changed.length) {
      segments.push(hunk.slice(Math.max(0, changed[0] - SEGMENT_CONTEXT), changed.at(-1)! + SEGMENT_CONTEXT + 1))
    }
    start = end + 1
  }
  return segments
}

export function isFollowedLine(line: ParsedLine, step: Pick<HistoryStep, 'range' | 'before'>): boolean {
  if (line.kind === 'remove') return Boolean(step.before && line.oldLine !== undefined && line.oldLine >= step.before.start && line.oldLine <= step.before.end)
  return line.newLine !== undefined && line.newLine >= step.range.start && line.newLine <= step.range.end
}

/**
 * One step back: the newest commit that changed the range at `cursor.sha`, the range in that commit,
 * and where it came from in the commit's first parent. Blame is taken at `cursor.sha`, so the
 * commit's own diff locates the range in it, by the lines blame credits to the commit.
 */
export async function historyStep(cursor: HistoryCursor, fetch: HistoryFetchers): Promise<HistoryStep | { stop: HistoryStop }> {
  const { range } = cursor
  if (range.end - range.start + 1 > MAX_HISTORY_LINES) return { stop: 'tooWide' }
  const blocks: BlameBlock[] = []
  for (let start = range.start; start <= range.end; start += BLAME_CHUNK) {
    blocks.push(...await fetch.blame(cursor.sha, cursor.path, start, Math.min(range.end, start + BLAME_CHUNK - 1)))
  }
  const attributions = blameAttributions(blocks, range.start)
  let newest: BlameBlock | null = null
  for (const block of blocks) {
    if (!newest || Date.parse(block.committedAt) > Date.parse(newest.committedAt)) newest = block
  }
  if (!newest) return { stop: 'unavailable' }
  // The first run of lines blame gives the commit, as they read now.
  let anchor = -1
  const texts: string[] = []
  for (let line = range.start; line <= range.end; line += 1) {
    const attribution = attributions.get(line)
    if (attribution?.block.commitId === newest.commitId) {
      if (anchor < 0) anchor = line
      else if (anchor + texts.length !== line) break
      texts.push(lineText(attributions, line))
    } else if (anchor >= 0) break
  }
  if (anchor < 0) return { stop: 'unavailable' }

  for (let page = 1; page <= MAX_COMMIT_DIFF_PAGES; page += 1) {
    const diffs = await fetch.commitDiff(newest.commitId, page)
    // The file under its current path first; under another one when it was renamed later.
    const ordered = [...diffs.filter((diff) => diff.newPath === cursor.path), ...diffs.filter((diff) => diff.newPath !== cursor.path)]
    for (const diff of ordered) {
      if (diff.tooLarge || diff.collapsed || !diff.diff) {
        if (diff.newPath === cursor.path) return { stop: 'unavailable' }
        continue
      }
      const parsed = parseDiff(diff.diff, diff.oldPath, diff.newPath)
      if (parsed.status === 'invalid') continue
      const found = findAddedRun(parsed.lines, texts, anchor)
      if (found === null) continue
      const shift = found - anchor
      const atCommit = { start: Math.max(1, range.start + shift), end: range.end + shift }
      const before = diff.newFile ? null : rangeBeforeCommit(parsed.lines, parsed.hunks ?? [], atCommit)
      const parent = newest.parentIds?.[0]
      const stop: HistoryStop | undefined = diff.newFile ? 'created' : !before ? 'added' : !parent ? 'root' : undefined
      return {
        before,
        commit: { authorName: newest.authorName, commitId: newest.commitId, committedAt: newest.committedAt, title: newest.title },
        next: stop || !before || !parent ? null : { path: diff.oldPath || diff.newPath, range: before, sha: parent },
        path: diff.newPath,
        range: atCommit,
        segments: historySegments(parsed.lines, atCommit, before),
        ...(stop ? { stop } : {}),
      }
    }
    if (diffs.length < COMMIT_DIFF_PAGE) break
  }
  return { stop: 'unmatched' }
}

/** A line's text as blame gives it, from its block's lines. */
function lineText(attributions: ReturnType<typeof blameAttributions>, line: number): string {
  const block = attributions.get(line)?.block
  let first = line
  while (attributions.get(first - 1)?.block === block) first -= 1
  return block?.lines[line - first] ?? ''
}
