import type { Position } from '../../types/gitlab'
import { translate } from '../../i18n/i18n'

export type CommentCodeState = 'unchanged' | 'changed' | 'unknown'
export interface CommentCodeResult { state: CommentCodeState; explanation: string }

/** A conservative textual match: equality at the old line number is not
 * sufficient when the same text occurs elsewhere. Only a unique exact match
 * is treated as unchanged, including when earlier edits shifted its line.
 *
 * It is intentionally not a semantic rename/move detector. A changed line can
 * still occur in another file; in that case this method cannot prove identity.
 */
export function compareCommentCode(previous: string, current: string, position: Pick<Position, 'newLine' | 'lineRange'>): CommentCodeResult {
  const oldLines = previous.replace(/\r\n/gu, '\n').split('\n')
  const nowLines = current.replace(/\r\n/gu, '\n').split('\n')
  const end = position.newLine
  const start = position.lineRange?.start.newLine ?? end
  if (!start || !end || start < 1 || end < start || end > oldLines.length || end - start > 20) {
    return { state: 'unknown', explanation: translate('review.codeStatus.reason.noRange') }
  }
  const original = oldLines.slice(start - 1, end)
  if (original.every((line) => !line.trim()) || original.some((line) => line.length > 10000)) {
    return { state: 'unknown', explanation: translate('review.codeStatus.reason.untrackable') }
  }
  // An unchanged but repeated pattern is not evidence that the original line
  // survived; report unknown rather than a false "unchanged".
  const occurrences = (lines: string[], target: string[]): number[] => {
    const matches: number[] = []
    for (let i = 0; i <= lines.length - target.length; i += 1) {
      if (target.every((line, j) => lines[i + j] === line)) matches.push(i)
      if (matches.length > 1) break
    }
    return matches
  }
  if (occurrences(oldLines, original).length !== 1) {
    return { state: 'unknown', explanation: translate('review.codeStatus.reason.ambiguousOriginal') }
  }
  const matches = occurrences(nowLines, original)
  if (matches.length === 1) {
    return { state: 'unchanged', explanation: matches[0] === start - 1 ? translate('review.codeStatus.reason.same') : translate('review.codeStatus.reason.moved') }
  }
  if (matches.length > 1) return { state: 'unknown', explanation: translate('review.codeStatus.reason.ambiguousCurrent') }
  return { state: 'changed', explanation: translate('review.codeStatus.reason.notFound') }
}
