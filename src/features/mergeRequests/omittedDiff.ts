import { useEffect, useMemo } from 'react'
import { structuredPatch } from 'diff'
import type { Diff, FileQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'

const CONTEXT_LINES = 3
/** Comparing runs on the UI thread, so two very different files are given up on rather than freezing it. */
const COMPARE_TIMEOUT_MS = 3000

export type OmittedDiffRead =
  | { status: 'loading' }
  | { status: 'ready'; diff: string }
  | { status: 'notComparable' }
  | { status: 'failed'; message: string }

/** The versions a file is compared between, when its diff is left out by GitLab. */
export interface OmittedDiffSource {
  beforeSha?: string
  projectId: string
  sessionId: string
  sha: string
}

export function isDiffOmitted(diff: Diff | undefined): boolean {
  return Boolean(diff && (diff.collapsed || diff.tooLarge))
}

/** A new file has no earlier version to read; any other file needs the one it is compared from. */
export function canReadOmittedDiff(diff: Diff, source: OmittedDiffSource | undefined): source is OmittedDiffSource {
  return Boolean(source && (source.beforeSha || diff.newFile))
}

/**
 * The unified diff between two versions of a file, shaped as GitLab's `diff`
 * field. Null when they are not text or comparing them takes too long.
 */
export function diffFromFiles(before: string, after: string): string | null {
  if (before.includes('\0') || after.includes('\0')) return null
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: CONTEXT_LINES, timeout: COMPARE_TIMEOUT_MS })
  if (!patch) return null
  return patch.hunks.map((hunk) => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}\n`).join('')
}

/**
 * Reads both versions of a file whose diff GitLab left out and reports the
 * comparison. It is a component so that only a file left out reads anything.
 */
export function OmittedDiffReader({ diff, onRead, source }: { diff: Diff; onRead: (read: OmittedDiffRead) => void; source: OmittedDiffSource }) {
  const { beforeSha, projectId, sessionId, sha } = source
  const beforePath = diff.oldPath || diff.newPath
  const afterPath = diff.newPath || diff.oldPath
  const beforeQuery = useMemo<FileQuery | null>(() => !diff.newFile && beforeSha ? { kind: 'file', path: beforePath, projectId, sha: beforeSha } : null, [beforePath, beforeSha, diff.newFile, projectId])
  const afterQuery = useMemo<FileQuery | null>(() => diff.deletedFile ? null : { kind: 'file', path: afterPath, projectId, sha }, [afterPath, diff.deletedFile, projectId, sha])
  const before = useGitLabQuery<FileQuery>(sessionId, beforeQuery)
  const after = useGitLabQuery<FileQuery>(sessionId, afterQuery)
  const beforeContent = beforeQuery ? before.data?.content : ''
  const afterContent = afterQuery ? after.data?.content : ''
  const failure = (beforeQuery && !before.data ? before.error : null) ?? (afterQuery && !after.data ? after.error : null)
  const failureMessage = failure?.message
  const read = useMemo<OmittedDiffRead>(() => {
    if (failureMessage !== undefined) return { message: failureMessage, status: 'failed' }
    if (beforeContent === undefined || afterContent === undefined) return { status: 'loading' }
    const compared = diffFromFiles(beforeContent, afterContent)
    return compared === null ? { status: 'notComparable' } : { diff: compared, status: 'ready' }
  }, [afterContent, beforeContent, failureMessage])
  useEffect(() => onRead(read), [onRead, read])
  return null
}

/**
 * Whether GitLab's list leaves out files the MR changed. `changes_count` ends
 * in `+` once GitLab stopped counting at a limit, as in `1000+`.
 */
export function listMissesFiles(changesCount: string | null | undefined, listed: number): boolean {
  if (!changesCount) return false
  if (changesCount.endsWith('+')) return true
  const total = Number(changesCount)
  return Number.isInteger(total) && total > listed
}
