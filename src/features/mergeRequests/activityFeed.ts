import type { GitLabTodo, GitLabUser, MergeRequest, Note } from '../../types/gitlab'

/** What GitLab's notification emails tell about a merge request, beyond its To-Dos. */
export type ActivityKind = 'comment' | 'pushed' | 'approved' | 'unapproved' | 'merged' | 'closed' | 'reopened'

export interface MergeRequestActivity {
  /** The note's ID; each event is one note on the MR. */
  id: string
  kind: ActivityKind
  projectId: string
  iid: string
  title: string
  projectLabel: string
  author: GitLabUser
  createdAt: string
  /** The comment, kept so reading the event also reads it where the MR list counts unread comments. */
  note: Note
  /** Commits added, for `pushed`. */
  commits?: number
  /** The file and line a diff comment is on. */
  path?: string
  line?: number
}

/** Events older than this are neither shown nor counted. */
export const ACTIVITY_DAYS = 14

/** GitLab writes system notes in English whatever the user's language; others (labels, mentions...) are left out. */
const systemNotes: [RegExp, ActivityKind][] = [
  [/^added (\d+) commits?\b/u, 'pushed'],
  [/^approved this merge request\b/u, 'approved'],
  [/^(?:unapproved this merge request|revoked approval)\b/u, 'unapproved'],
  [/^merged\b/u, 'merged'],
  [/^closed\b/u, 'closed'],
  [/^reopened\b/u, 'reopened'],
]

/** The events of one MR among its notes, newest first, leaving out the user's own. */
export function mergeRequestActivity(mergeRequest: MergeRequest, notes: Note[], currentUserId: string): MergeRequestActivity[] {
  const items: MergeRequestActivity[] = []
  for (const note of notes) {
    if (note.author.id === currentUserId) continue
    const base = { author: note.author, createdAt: note.createdAt, id: note.id, iid: mergeRequest.iid, note, projectId: mergeRequest.projectId, projectLabel: mergeRequest.projectPath || mergeRequest.projectId, title: mergeRequest.title }
    if (!note.system) {
      const path = note.position ? note.position.newPath || note.position.oldPath : undefined
      const line = note.position?.newLine ?? note.position?.oldLine
      items.push({ ...base, kind: 'comment', ...(path ? { path } : {}), ...(line ? { line } : {}) })
      continue
    }
    for (const [pattern, kind] of systemNotes) {
      const match = pattern.exec(note.body.trim())
      if (!match) continue
      items.push({ ...base, kind, ...(kind === 'pushed' ? { commits: Number(match[1]) } : {}) })
      break
    }
  }
  return items.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

/** The comment a mention To-Do is about; that To-Do stands for it, so the comment is not shown twice. */
export function todoNoteId(todo: GitLabTodo): string | null {
  return /#note_(\d+)$/u.exec(todo.webUrl)?.[1] ?? null
}
