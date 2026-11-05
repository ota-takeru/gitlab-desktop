/** GitLab's address for what the MR review shows. */

/** GitLab names a file in the MR's diff page by the SHA-1 of its path. */
export async function diffFileAnchor(path: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(path))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    // The diff page still opens, only not at the file.
    return null
  }
}

export function discussionPageUrl(webUrl: string, noteId: string | null | undefined): string {
  return noteId ? `${webUrl}#note_${noteId}` : webUrl
}

export interface DiffPageTarget {
  /** The commit shown alone. */
  commit?: string | null
  /** The head of the earlier version compared with the latest. */
  compareFrom?: string | null
  /** A comment in view; it says more than the file it is in. */
  noteId?: string | null
  fileAnchor?: string | null
}

export function diffPageUrl(webUrl: string, { commit, compareFrom, fileAnchor, noteId }: DiffPageTarget): string {
  const query = commit ? `?commit_id=${commit}` : compareFrom ? `?start_sha=${compareFrom}` : ''
  const anchor = noteId ? `note_${noteId}` : fileAnchor
  return `${webUrl}/diffs${query}${anchor ? `#${anchor}` : ''}`
}

export function pipelinesPageUrl(webUrl: string, shownUrl: string | null | undefined): string {
  return shownUrl || `${webUrl}/pipelines`
}
