import { useEffect, useMemo, useRef, useState } from 'react'
import { translate } from '../../i18n/i18n'
import { notifyWorkspace } from '../../lib/notifications'
import { useConnection } from '../connections/connectionContext'
import { ACTIVITY_DAYS, mergeRequestActivity } from '../mergeRequests/activityFeed'
import { forgetActivity, publishActivity } from '../mergeRequests/activityStore'
import { isNotificationTodo } from '../mergeRequests/todoCache'
import { mrRefKey, usePersonalWorkspace } from './personalWorkspace'
import { useGitLabQuery } from './useGitLabQuery'
import type { MergeRequest, MergeRequestsQuery } from '../../types/gitlab'

/** The user's MRs whose events are followed, the most recently updated first. */
const WATCHED_MRS = 20
const ACTIVITY_DAYS_MS = ACTIVITY_DAYS * 24 * 60 * 60_000

export function WorkspaceMonitor() {
  const { session } = useConnection()
  const { settings, startActivity } = usePersonalWorkspace(session)
  const query = useMemo(() => session && settings.notifyTodos ? ({ kind: 'todos' as const, page: 1 }) : null, [session, settings.notifyTodos])
  const result = useGitLabQuery(session?.id ?? null, query)
  const following = Boolean(session) && (settings.showActivity || settings.notifyComments)
  // Merged and closed MRs too, as their last events are what the emails tell; the day is kept
  // whole so the saved lists are found again after a restart the same day.
  const [updatedAfter] = useState(() => `${new Date(Date.now() - ACTIVITY_DAYS_MS).toISOString().slice(0, 10)}T00:00:00Z`)
  const roleQueries = useMemo(() => (['authorId', 'assigneeId', 'reviewerId'] as const).map((role): MergeRequestsQuery | null => session && following
    ? { kind: 'mrs', search: '', state: 'all', [role]: session.user.id, updatedAfter, orderBy: 'updated_at', sort: 'desc', page: 1 }
    : null), [following, session, updatedAfter])
  const authored = useGitLabQuery(session?.id ?? null, roleQueries[0])
  const assigned = useGitLabQuery(session?.id ?? null, roleQueries[1])
  const reviews = useGitLabQuery(session?.id ?? null, roleQueries[2])
  const watched = [...new Map([...(authored.data ?? []), ...(assigned.data ?? []), ...(reviews.data ?? [])].map((mr) => [mrRefKey(mr), mr])).values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, WATCHED_MRS)
  useEffect(() => { if (following) startActivity() }, [following, startActivity])
  const seen = useRef<{ sessionId: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!session || !settings.notifyTodos) { seen.current = null; return }
    if (!result.data || result.snapshot?.source !== 'network' || result.error) return
    const current = seen.current
    if (current?.sessionId === session.id) {
      const added = result.data.filter((todo) => isNotificationTodo(todo) && !current.ids.has(todo.id))
      if (added.length) void notifyWorkspace(translate('common.notifications.newTodos', { count: added.length })).catch(() => undefined)
    }
    seen.current = { sessionId: session.id, ids: new Set([...(current?.sessionId === session.id ? current.ids : []), ...result.data.map((todo) => todo.id)].slice(-1000)) }
  }, [result.data, result.error, result.snapshot?.source, session, settings.notifyTodos])
  return <>{following ? watched.map((mr) => <WatchedActivity key={`${session?.id}:${mrRefKey(mr)}`} mergeRequest={mr} notify={settings.notifyComments} />) : null}</>
}

/**
 * The events of one watched MR. Its comments are read again only when GitLab reports the MR
 * updated, which a new comment, push or approval does.
 */
function WatchedActivity({ mergeRequest, notify }: { mergeRequest: MergeRequest; notify: boolean }) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const query = useMemo(() => session ? ({ kind: 'notes' as const, projectId: mergeRequest.projectId, iid: mergeRequest.iid, page: 1 }) : null, [mergeRequest.iid, mergeRequest.projectId, session])
  const result = useGitLabQuery(session?.id ?? null, query, { refreshIntervalMs: false })
  const { refresh } = result
  const updatedAt = useRef(mergeRequest.updatedAt)
  useEffect(() => {
    if (updatedAt.current === mergeRequest.updatedAt) return
    updatedAt.current = mergeRequest.updatedAt
    refresh()
  }, [mergeRequest.updatedAt, refresh])
  const sessionId = session?.id
  const mrKey = mrRefKey(mergeRequest)
  useEffect(() => () => { if (sessionId) forgetActivity(sessionId, mrKey) }, [mrKey, sessionId])
  const previous = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!session || !result.data) return
    const items = mergeRequestActivity(mergeRequest, result.data, session.user.id)
    const since = Date.now() - ACTIVITY_DAYS_MS
    publishActivity(session.id, mrKey, items.filter((item) => Date.parse(item.createdAt) > since))
    if (result.snapshot?.source !== 'network' || result.error) return
    workspace.observe(mergeRequest, result.data)
    if (previous.current) {
      const known = previous.current
      // Only newer than what was seen, so an older event coming onto the page is not new.
      const latest = Math.max(0, ...items.filter((item) => known.has(item.id)).map((item) => Date.parse(item.createdAt)))
      const added = items.filter((item) => !known.has(item.id) && Date.parse(item.createdAt) > latest)
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      const currentlyOpen = window.location.hash.startsWith('#client/mr?') && params.get('projectId') === mergeRequest.projectId && params.get('iid') === mergeRequest.iid
      if (notify && added.length && !currentlyOpen) void notifyWorkspace(translate('common.notifications.newActivity', { count: added.length })).catch(() => undefined)
    }
    previous.current = new Set(items.map((item) => item.id))
  }, [mergeRequest, mrKey, notify, result.data, result.error, result.snapshot?.source, session, workspace])
  return null
}
