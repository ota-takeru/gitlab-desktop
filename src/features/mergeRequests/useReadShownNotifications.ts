import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'

import { useNotify } from '../../components/feedbackContext'
import type { GitLabTodo, Note } from '../../types/gitlab'
import { todoNoteId } from './activityFeed'
import { noteInView } from './discussionScroll'
import { forgetDoneTodos, markNotificationRead } from './todoCache'

interface Options {
  sessionId: string | null
  /** The MR shown, so what is known starts again for another one. */
  scope: string
  /** The threads have been read, so the comments at hand are those shown at opening. */
  ready: boolean
  sectionRef: RefObject<HTMLElement | null>
  notes: Note[]
  unreadNoteIds: string[]
  todos: GitLabTodo[]
  onReadNotes: (notes: Note[]) => void
}

interface Known {
  scope: string
  /** The newest comment when the MR was opened: older ones coming with earlier pages have not just arrived. */
  since: number
  /** The comments shown so far. */
  noteIds: Set<string>
  todoIds: Set<string>
}

/**
 * A notification that comes while its comment is already on screen is read: a new comment by
 * someone else, or a To-Do (a mention) about a comment shown. The unread comments there when
 * the MR was opened stay unread, so the reader is still led to them.
 */
export function useReadShownNotifications({ sessionId, scope, ready, sectionRef, notes, unreadNoteIds, todos, onReadNotes }: Options): void {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const known = useRef<Known | null>(null)
  const sent = useRef(new Set<string>())
  const readShown = useEffectEvent(() => {
    if (!sessionId || !ready) return
    const previous = known.current?.scope === scope ? known.current : null
    const since = previous?.since ?? Math.max(0, ...notes.map((note) => Date.parse(note.createdAt)))
    known.current = { noteIds: new Set([...previous?.noteIds ?? [], ...notes.map((note) => note.id)]), scope, since, todoIds: new Set([...previous?.todoIds ?? [], ...todos.map((todo) => todo.id)]) }
    if (!previous || document.visibilityState !== 'visible') return
    const section = sectionRef.current
    const host = section?.closest('main')
    if (!section || !host) return
    const unread = new Set(unreadNoteIds)
    const arrived = [
      ...notes.filter((note) => unread.has(note.id) && !previous.noteIds.has(note.id) && Date.parse(note.createdAt) > since).map((note) => note.id),
      ...todos.filter((todo) => !previous.todoIds.has(todo.id)).map(todoNoteId),
    ]
    const shown = new Set(arrived.filter((id): id is string => id !== null && noteInView(host, section, id)))
    if (!shown.size) return
    const readNotes = notes.filter((note) => shown.has(note.id) && unread.has(note.id))
    if (readNotes.length) onReadNotes(readNotes)
    // A To-Do that came before its comment is read with the comment.
    const readTodos = todos.filter((todo) => shown.has(todoNoteId(todo) ?? '') && !sent.current.has(todo.id))
    for (const todo of readTodos) sent.current.add(todo.id)
    if (readTodos.length) {
      void (async () => {
        const done: string[] = []
        for (const todo of readTodos) if (await markNotificationRead(notify, sessionId, todo, false)) done.push(todo.id)
        forgetDoneTodos(queryClient, sessionId, done)
      })()
    }
  })
  const noteKey = notes.map((note) => note.id).join(' ')
  const unreadKey = unreadNoteIds.join(' ')
  const todoKey = todos.map((todo) => todo.id).join(' ')
  useEffect(() => { readShown() }, [sessionId, scope, ready, noteKey, unreadKey, todoKey])
}
