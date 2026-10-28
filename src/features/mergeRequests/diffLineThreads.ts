import { translate } from '../../i18n/i18n'
import type { Diff, Discussion, Draft, Position } from '../../types/gitlab'
import type { ParsedLine } from './diffParser'

/** Places line comments of a diff file by line, for the threads shown under diff lines. */

export function pendingDraftsByLine(drafts: Draft[] | undefined, diff: Diff | undefined, headSha: string | undefined): Map<string, Draft[]> {
  const byLine = new Map<string, Draft[]>()
  if (!drafts || !diff || !headSha) return byLine
  for (const draft of drafts) {
    const position = draft.position
    if (!position || position.positionType !== 'text' || position.headSha !== headSha || (position.newPath !== diff.newPath && position.oldPath !== diff.oldPath)) continue
    const key = lineKey(position)
    if (key) byLine.set(key, [...byLine.get(key) ?? [], draft])
  }
  return byLine
}

/** Lines are matched like positions: by the new line number, or the old one for removed lines. */
export function lineKey(line: Pick<ParsedLine, 'newLine' | 'oldLine'>): string | null {
  if (line.newLine != null) return `n:${line.newLine}`
  return line.oldLine != null ? `o:${line.oldLine}` : null
}

/**
 * The commented lines: `12`, or `12〜15` for a multi-line comment. A line that
 * exists only before the change is marked `−`, where a range mixes the sides.
 */
export function positionLines(position: Pick<Position, 'newLine' | 'oldLine' | 'lineRange'>): string {
  const end = position.newLine ?? position.oldLine
  if (end == null) return 'file'
  const range = position.lineRange
  const start = range?.start.newLine ?? range?.start.oldLine
  if (!range || start == null || (start === end && (range.start.newLine == null) === (position.newLine == null))) return String(end)
  const mixed = (range.start.newLine == null) !== (position.newLine == null)
  const label = (line: number, oldOnly: boolean) => mixed && oldOnly ? `−${line}` : String(line)
  return translate('review.lineRange', { start: label(start, range.start.newLine == null), end: label(end, position.newLine == null) })
}

/** Where a line comment is, such as `src/a.ts:12〜15`. */
export function positionLabel(position: Pick<Position, 'newPath' | 'newLine' | 'oldLine' | 'lineRange'>): string {
  return `${position.newPath}:${positionLines(position)}`
}

/** Threads of the file placed by line, and how many belong to another version of it. */
export function threadsByLine(discussions: Discussion[] | undefined, diff: Diff | undefined, headSha: string | undefined): { byLine: Map<string, Discussion[]>; outdated: number } {
  const byLine = new Map<string, Discussion[]>()
  let outdated = 0
  if (!discussions || !diff) return { byLine, outdated }
  for (const discussion of discussions) {
    const position = discussion.notes.find((note) => !note.system && note.position)?.position
    if (!position || position.positionType !== 'text' || (position.newPath !== diff.newPath && position.oldPath !== diff.oldPath)) continue
    const key = lineKey(position)
    if (!key) continue
    if (!headSha || position.headSha !== headSha) { outdated += 1; continue }
    byLine.set(key, [...byLine.get(key) ?? [], discussion])
  }
  return { byLine, outdated }
}

export interface FileThreadCount { total: number; unresolved: number }

/** Comment threads on each changed file, current or on an older version, and how many still need resolving. */
export function threadCountsByFile(discussions: Discussion[] | undefined, diffs: Diff[]): Map<string, FileThreadCount> {
  const counts = new Map<string, FileThreadCount>()
  if (!discussions?.length) return counts
  const byPath = new Map<string, string>()
  for (const diff of diffs) {
    const path = diff.newPath || diff.oldPath
    if (diff.oldPath) byPath.set(`o:${diff.oldPath}`, path)
    if (diff.newPath) byPath.set(`n:${diff.newPath}`, path)
  }
  for (const discussion of discussions) {
    const position = discussion.notes.find((note) => !note.system && note.position)?.position
    const path = position ? byPath.get(`n:${position.newPath}`) ?? byPath.get(`o:${position.oldPath}`) : undefined
    if (!path) continue
    const current = counts.get(path) ?? { total: 0, unresolved: 0 }
    const unresolved = discussion.notes.some((note) => note.resolvable && !note.resolved)
    counts.set(path, { total: current.total + 1, unresolved: current.unresolved + (unresolved ? 1 : 0) })
  }
  return counts
}

/** The row's name carries its review state, which the marks show only visually. */
export function fileRowLabel(path: string, threads: FileThreadCount | undefined, reviewed: boolean): string {
  return [path, threads?.total ? threadLabel(threads) : null, reviewed ? translate('review.fileTree.reviewed') : null].filter(Boolean).join(translate('common.list.separator'))
}

export function threadLabel({ total, unresolved }: FileThreadCount): string {
  return unresolved ? translate('review.fileTree.threadsUnresolved', { total, unresolved }) : translate('review.fileTree.threads', { total })
}
