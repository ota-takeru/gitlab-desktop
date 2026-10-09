import { useEffect, useMemo, useRef } from 'react'
import { notifyWorkspace } from '../../lib/notifications'
import { useConnection } from '../connections/ConnectionProvider'
import { usePersonalWorkspace } from './personalWorkspace'
import { useGitLabQuery } from './useGitLabQuery'
import type { MergeRequest } from '../../types/gitlab'

export function WorkspaceMonitor() {
  const { session } = useConnection()
  const { settings } = usePersonalWorkspace(session)
  const query = useMemo(() => session && settings.notifyTodos ? ({ kind: 'todos' as const, page: 1 }) : null, [session, settings.notifyTodos])
  const result = useGitLabQuery(session?.id ?? null, query)
  const assignedQuery = useMemo(() => session && settings.notifyComments ? ({ kind: 'mrs' as const, search: '', state: 'opened' as const, assigneeId: session.user.id, orderBy: 'updated_at' as const, sort: 'desc' as const, page: 1 }) : null, [session, settings.notifyComments])
  const reviewQuery = useMemo(() => session && settings.notifyComments ? ({ kind: 'mrs' as const, search: '', state: 'opened' as const, reviewerId: session.user.id, orderBy: 'updated_at' as const, sort: 'desc' as const, page: 1 }) : null, [session, settings.notifyComments])
  const assigned = useGitLabQuery(session?.id ?? null, assignedQuery)
  const reviews = useGitLabQuery(session?.id ?? null, reviewQuery)
  const watched = [...new Map([...(assigned.data ?? []), ...(reviews.data ?? [])].map((mr) => [`${mr.projectId}:${mr.iid}`, mr])).values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 10)
  const seen = useRef<{ sessionId: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!session || !settings.notifyTodos) { seen.current = null; return }
    if (!result.data || result.snapshot?.source !== 'network' || result.error) return
    const current = seen.current
    if (current?.sessionId === session.id) {
      const added = result.data.filter((todo) => !current.ids.has(todo.id))
      if (added.length) void notifyWorkspace(`新しいMR To-Doが${added.length}件あります。`).catch(() => undefined)
    }
    seen.current = { sessionId: session.id, ids: new Set([...(current?.sessionId === session.id ? current.ids : []), ...result.data.map((todo) => todo.id)].slice(-1000)) }
  }, [result.data, result.error, result.snapshot?.source, session, settings.notifyTodos])
  return <>{settings.notifyComments ? watched.map((mr) => <WatchedComments key={`${session?.id}:${mr.projectId}:${mr.iid}`} mergeRequest={mr} />) : null}</>
}

function WatchedComments({ mergeRequest }: { mergeRequest: MergeRequest }) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const query = useMemo(() => session ? ({ kind: 'notes' as const, projectId: mergeRequest.projectId, iid: mergeRequest.iid, page: 1 }) : null, [mergeRequest.iid, mergeRequest.projectId, session])
  const result = useGitLabQuery(session?.id ?? null, query)
  const previous = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!session || !result.data || result.snapshot?.source !== 'network' || result.error) return
    const notes = result.data.filter((note) => !note.system && note.author.id !== session.user.id)
    workspace.observe(mergeRequest, result.data)
    if (previous.current) {
      const latest = Math.max(0, ...Array.from(previous.current.values(), (date) => Date.parse(date)))
      const added = notes.filter((note) => previous.current!.has(note.id) ? previous.current!.get(note.id) !== (note.updatedAt || note.createdAt) : Date.parse(note.createdAt) > latest)
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      const currentlyOpen = window.location.hash.startsWith('#client/mr?') && params.get('projectId') === mergeRequest.projectId && params.get('iid') === mergeRequest.iid
      if (added.length && !currentlyOpen) void notifyWorkspace(`担当・レビューMRに新着コメントが${added.length}件あります。`).catch(() => undefined)
    }
    previous.current = new Map(notes.map((note) => [note.id, note.updatedAt || note.createdAt]))
  }, [mergeRequest, result.data, result.error, result.snapshot?.source, session, workspace])
  return null
}
