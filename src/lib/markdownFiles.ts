import type { Diff } from '../types/gitlab'

/** A single rule for every read-only repository, MR and local file view. */
export function isMarkdownFilePath(path: string | null | undefined): boolean {
  return Boolean(path && /\.(?:md|markdown|mdown)$/iu.test(path))
}

/** A line-comment navigation can explicitly override this initial selection. */
export function defaultFileViewForDiff(diff: Pick<Diff, 'newPath' | 'oldPath' | 'deletedFile' | 'tooLarge' | 'collapsed'> | null | undefined): 'diff' | 'file' {
  if (!diff || diff.deletedFile || diff.tooLarge || diff.collapsed) return 'diff'
  return isMarkdownFilePath(diff.newPath || diff.oldPath) ? 'file' : 'diff'
}
