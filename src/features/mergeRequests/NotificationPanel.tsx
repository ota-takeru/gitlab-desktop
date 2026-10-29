import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded'
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import CommitRoundedIcon from '@mui/icons-material/CommitRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined'
import MergeRoundedIcon from '@mui/icons-material/MergeRounded'
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded'
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Popover, { type PopoverVirtualElement } from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import { ClientNavItem } from '../../components/ClientNavItem'
import { frame, hairline, panelFrame } from '../../components/hairline'
import { type NotifyOptions } from '../../components/Feedback'
import { useNotify } from '../../components/feedbackContext'
import { moveListRowFocus } from '../../components/listRowFocus'
import { NotificationBellIcon, NotificationCount } from '../../components/NotificationBellIcon'
import { PaneEmpty } from '../../components/Pane'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon, type StateIconTone } from '../../components/StateIcon'
import { translate, type MessageKey } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { formatFetchedAt } from '../../lib/format'
import { normalizeGitLabError, queryGitLab } from '../../lib/gitlab'
import type { GitLabCommandError, GitLabSession, GitLabTodo, TodosQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { mrRefKey, usePersonalWorkspace, type MrRef } from '../shared/personalWorkspace'
import { runGitLabMutation, useGitLabMutation } from '../shared/useGitLabMutation'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { mentionsUser, todoNoteId, type ActivityKind, type MergeRequestActivity } from './activityFeed'
import { useLoadedActivity } from './activityStore'
import { forgetDoneTodos, isNotificationTodo } from './todoCache'
import { Row } from '../../components/Row'

const actionLabels: Record<string, MessageKey> = { assigned: 'mrList.notifications.action.assigned', mentioned: 'mrList.notifications.action.mentioned', directly_addressed: 'mrList.notifications.action.directlyAddressed', approval_required: 'mrList.notifications.action.approvalRequired', marked: 'mrList.notifications.action.marked', build_failed: 'mrList.notifications.action.buildFailed', unmergeable: 'mrList.notifications.action.unmergeable', merge_train_removed: 'mrList.notifications.action.mergeTrainRemoved', review_requested: 'mrList.notifications.action.reviewRequested' }
// What blocks the MR stands out from requests and mentions.
const actionTones: Record<string, StateIconTone> = { build_failed: 'error', unmergeable: 'error', merge_train_removed: 'warning' }
// Each request has its own shape, so a stack of notifications can be scanned without reading; the name is the tooltip.
const actionIcons: Record<string, ReactElement> = { assigned: <AssignmentIndOutlinedIcon fontSize="inherit" />, mentioned: <AlternateEmailRoundedIcon fontSize="inherit" />, directly_addressed: <AlternateEmailRoundedIcon fontSize="inherit" />, approval_required: <HowToRegOutlinedIcon fontSize="inherit" />, marked: <BookmarkBorderRoundedIcon fontSize="inherit" />, build_failed: <ErrorOutlineRoundedIcon fontSize="inherit" />, unmergeable: <BlockRoundedIcon fontSize="inherit" />, merge_train_removed: <WarningAmberRoundedIcon fontSize="inherit" />, review_requested: <PersonSearchOutlinedIcon fontSize="inherit" /> }
// A mention carries the comment that made it; for the other events the text only repeats the MR.
const quotesComment = new Set(['mentioned', 'directly_addressed'])
const activityLabels: Record<Exclude<ActivityKind, 'pushed'>, MessageKey> = { comment: 'mrList.notifications.activity.comment', approved: 'mrList.notifications.activity.approved', unapproved: 'mrList.notifications.activity.unapproved', merged: 'mrList.notifications.activity.merged', closed: 'mrList.notifications.activity.closed', reopened: 'mrList.notifications.activity.reopened' }
const activityTones: Partial<Record<ActivityKind, StateIconTone>> = { approved: 'success', merged: 'success', unapproved: 'warning', closed: 'neutral' }
const activityIcons: Record<ActivityKind, ReactElement> = { comment: <ChatBubbleOutlineRoundedIcon fontSize="inherit" />, pushed: <CommitRoundedIcon fontSize="inherit" />, approved: <CheckCircleOutlineRoundedIcon fontSize="inherit" />, unapproved: <RemoveCircleOutlineRoundedIcon fontSize="inherit" />, merged: <MergeRoundedIcon fontSize="inherit" />, closed: <CancelOutlinedIcon fontSize="inherit" />, reopened: <ReplayRoundedIcon fontSize="inherit" /> }

/**
 * The MR events shown beside the To-Dos: unread ones, or with `read` the read ones. A comment
 * mentioning the user is left to its To-Do, pending or done, so reading it never brings the
 * comment back; one a pending To-Do is about otherwise (a group mention) is left to it too.
 */
function useActivityNotifications(session: GitLabSession | null, read: boolean, todos: GitLabTodo[]): MergeRequestActivity[] {
  const workspace = usePersonalWorkspace(session)
  const loaded = useLoadedActivity(session?.id ?? null)
  return useMemo(() => {
    if (!workspace.settings.showActivity) return []
    const fromTodos = new Set(todos.map(todoNoteId))
    const username = session?.user.username ?? ''
    return loaded.filter((item) => !fromTodos.has(item.id)
      && !(item.kind === 'comment' && username && mentionsUser(item.note.body, username))
      && workspace.isActivityUnread(item, item.createdAt, item.kind === 'comment' ? item.id : null) !== read)
  }, [loaded, read, session?.user.username, todos, workspace])
}

/**
 * The navigation's notification button. The count sits inside the bell, and
 * the notifications open as a stack over the page rather than as a place.
 * The stack opens beside `navigationWidth`, the width the navigation settles at
 * (a peeked navigation folds as the stack opens), level with the button's foot.
 */
export function NotificationNavItem({ collapsed, navigationWidth, onOpen, onOpenChange }: { collapsed: boolean; navigationWidth: number; onOpen: (ref: MrRef) => void; onOpenChange?: (open: boolean) => void }) {
  const t = useT()
  const { session } = useConnection()
  const [button, setButton] = useState<HTMLElement | null>(null)
  // Measured whenever the stack is placed, also after the window is resized, so it follows the button.
  const anchor = useMemo((): PopoverVirtualElement | null => button ? {
    getBoundingClientRect: () => {
      const left = (button.closest('aside')?.getBoundingClientRect().left ?? 0) + navigationWidth
      const bottom = button.getBoundingClientRect().bottom
      return new DOMRect(left, bottom, 0, 0)
    },
    nodeType: Node.ELEMENT_NODE,
  } : null, [button, navigationWidth])
  const openAt = (next: HTMLElement) => {
    setButton(next)
    onOpenChange?.(true)
  }
  const close = () => {
    setButton(null)
    onOpenChange?.(false)
  }
  // The first page is the count, shared with the panel's first page and the desktop notifications.
  const query = useMemo(() => session ? ({ kind: 'todos' as const, page: 1 }) : null, [session])
  const result = useGitLabQuery(session?.id ?? null, query)
  const todos = useMemo(() => result.data?.filter(isNotificationTodo) ?? [], [result.data])
  const activity = useActivityNotifications(session, false, todos)
  const count = todos.length + activity.length
  const more = result.snapshot?.nextPage != null
  const title = count || more ? t(more ? 'mrList.notifications.navTitleMore' : 'mrList.notifications.navTitle', { count }) : t('mrList.notifications.title')
  return <>
    <ClientNavItem collapsed={collapsed} disabled={!session} expanded={Boolean(button)} place="notifications" icon={<NotificationBellIcon count={count} more={more} withCount={collapsed} />} label={t('mrList.notifications.title')} onClick={(event) => openAt(event.currentTarget)} selected={Boolean(button)} title={title} trailing={<NotificationCount count={count} more={more} />} />
    <Popover
      anchorEl={anchor}
      anchorOrigin={{ horizontal: 'left', vertical: 'top' }}
      onClose={close}
      open={Boolean(anchor && session)}
      slotProps={{ paper: { 'aria-label': t('mrList.notifications.title'), role: 'dialog', sx: { display: 'flex', flexDirection: 'column', maxHeight: 'min(560px, calc(100vh - 32px))', ml: 1, width: 380 } } }}
      transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
    >
      {session ? <NotificationStack onOpen={(ref) => { close(); onOpen(ref) }} sessionId={session.id} /> : null}
    </Popover>
  </>
}

/** A GitLab To-Do, or an event on one of the user's MRs that GitLab only emails about. */
type NotificationEntry = { todo: GitLabTodo; activity?: undefined } | { todo?: undefined; activity: MergeRequestActivity }

function entryOf(entry: NotificationEntry): GitLabTodo | MergeRequestActivity {
  return entry.todo ?? entry.activity
}

/** The notifications of one MR, newest first; a mention per comment would otherwise fill the stack with one MR. */
interface NotificationGroup {
  key: string
  entries: NotificationEntry[]
}

function groupByMergeRequest(entries: NotificationEntry[]): NotificationGroup[] {
  const groups = new Map<string, NotificationEntry[]>()
  const sorted = [...entries].sort((left, right) => Date.parse(entryOf(right).createdAt) - Date.parse(entryOf(left).createdAt))
  for (const entry of sorted) {
    const { iid, projectId } = entryOf(entry)
    const key = `${projectId}-${iid}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups].map(([key, items]) => ({ key, entries: items }))
}

/**
 * Reads MR events: comments where the MR list counts unread comments, the other events up to
 * the newest of them.
 */
function markActivityRead(workspace: ReturnType<typeof usePersonalWorkspace>, items: MergeRequestActivity[]) {
  const byMergeRequest = new Map<string, MergeRequestActivity[]>()
  for (const item of items) byMergeRequest.set(mrRefKey(item), [...(byMergeRequest.get(mrRefKey(item)) ?? []), item])
  for (const group of byMergeRequest.values()) {
    const ref = { iid: group[0].iid, projectId: group[0].projectId }
    const comments = group.filter((item) => item.kind === 'comment').map((item) => item.note)
    if (comments.length) workspace.markRead(ref, comments)
    const latest = group.filter((item) => item.kind !== 'comment').map((item) => item.createdAt).sort((left, right) => Date.parse(right) - Date.parse(left))[0]
    if (latest) workspace.markActivityRead(ref, latest)
  }
}

/** Scrolling, or reading every notification, goes through at most this many pages of GitLab's To-Dos (100 each). */
const MAX_PAGES = 10
/** Reads sent at once; each also asks GitLab whether the To-Do is still pending. */
const MARK_ALL_PARALLEL = 4

interface PageResult {
  data: GitLabTodo[] | null
  error: GitLabCommandError | null
  loading: boolean
  nextPage: number | null
  refresh: () => void
}

/** GitLab's pending To-Dos are the unread notifications and its done To-Dos the read ones. */
function todosQuery(page: number, read: boolean): TodosQuery {
  return read ? { kind: 'todos', page, done: true } : { kind: 'todos', page }
}

function NotificationStack({ onOpen, sessionId }: { onOpen: (ref: MrRef) => void; sessionId: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const [marking, setMarking] = useState<{ done: number; total: number | null } | null>(null)
  // Read notifications stay in GitLab as done To-Dos, so they can be looked back on.
  const [read, setRead] = useState(false)
  const query = useMemo(() => todosQuery(1, read), [read])
  const result = useGitLabQuery(sessionId, query)
  // The pages after the first, loaded as the stack is scrolled to its end.
  const [morePages, setMorePages] = useState(0)
  const [loadedPages, setLoadedPages] = useState<Record<number, PageResult>>({})
  const showRead = (next: boolean) => {
    setRead(next)
    setMorePages(0)
    setLoadedPages({})
  }
  const reportPage = useCallback((page: number, loaded: PageResult | null) => setLoadedPages((current) => {
    const next = { ...current }
    if (loaded) next[page] = loaded
    else delete next[page]
    return next
  }), [])
  const later = Array.from({ length: morePages }, (_, index) => loadedPages[index + 2])
  const last = later.length ? later[later.length - 1] : null
  const nextPage = last ? last.nextPage : result.snapshot?.nextPage ?? null
  // GitLab's pages shift as notifications are read, so one may come again on the next page.
  const notifications = useMemo(() => {
    const seen = new Set<string>()
    const pages = [result.data, ...Array.from({ length: morePages }, (_, index) => loadedPages[index + 2]?.data)]
    return pages.flatMap((data) => data ?? []).filter((todo) => isNotificationTodo(todo) && !seen.has(todo.id) && Boolean(seen.add(todo.id)))
  }, [result.data, loadedPages, morePages])
  const activity = useActivityNotifications(session, read, notifications)
  const entries = useMemo((): NotificationEntry[] => [...notifications.map((todo) => ({ todo })), ...activity.map((item) => ({ activity: item }))], [activity, notifications])
  const groups = useMemo(() => groupByMergeRequest(entries), [entries])
  const shown = result.data !== null
  const loadingMore = Boolean(last?.loading) || (morePages > 0 && !last)
  const loadMore = nextPage !== null && !loadingMore && !last?.error && morePages + 1 < MAX_PAGES ? () => setMorePages((count) => count + 1) : undefined
  const scrollRef = useRef<HTMLDivElement>(null)
  // Opening a notification reads it, with the others of its MR: the MR opens at once and the reads are sent behind it.
  const open = (group: NotificationGroup) => {
    const { iid, projectId } = entryOf(group.entries[0])
    if (read) { onOpen({ iid, projectId }); return }
    markActivityRead(workspace, group.entries.flatMap((entry) => entry.activity ? [entry.activity] : []))
    void (async () => {
      const read: string[] = []
      for (const entry of group.entries) if (entry.todo && await markNotificationRead(notify, sessionId, entry.todo, false)) read.push(entry.todo.id)
      forgetDoneTodos(queryClient, sessionId, read)
    })()
    onOpen({ iid, projectId })
  }
  // Every page, not only those scrolled to. Each read goes under its MR's write record, so a failed
  // or unknown one never hides the others; the list is reloaded once at the end.
  const markAllRead = async () => {
    // The events are read on this device at once; only the To-Dos are sent to GitLab.
    const events = activity.length
    markActivityRead(workspace, activity)
    setMarking({ done: 0, total: null })
    const targets: GitLabTodo[] = []
    try {
      let next: number | null = 1
      for (let walked = 0; next !== null && walked < MAX_PAGES; walked += 1) {
        const pageQuery: TodosQuery = todosQuery(next, false)
        const snapshot = await queryGitLab({ mode: 'network', query: pageQuery, sessionId })
        targets.push(...(snapshot?.data ?? []).filter(isNotificationTodo))
        next = snapshot?.nextPage ?? null
      }
    } catch (caught) {
      setMarking(null)
      notify({ message: t('mrList.notifications.loadFailed', { error: normalizeGitLabError(caught).message }), severity: 'error' })
      return
    }
    const read: string[] = []
    let failed = 0
    let cursor = 0
    setMarking({ done: 0, total: targets.length })
    const worker = async () => {
      while (cursor < targets.length) {
        const todo = targets[cursor++]
        if (await markNotificationRead(null, sessionId, todo, false)) read.push(todo.id)
        else failed += 1
        setMarking({ done: read.length + failed, total: targets.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(MARK_ALL_PARALLEL, targets.length) }, worker))
    setMorePages(0)
    forgetDoneTodos(queryClient, sessionId, read)
    setMarking(null)
    notify(failed
      ? { message: t('mrList.notifications.markedSome', { failed, read: read.length }), severity: 'warning' }
      : { message: t('mrList.notifications.markedAll', { count: read.length + events }), severity: 'success' })
  }
  return <>
    <Row spacing={1} sx={{ ...hairline('bottom'), flexShrink: 0, pl: 1.5, pr: 0.5, py: 0.5 }}>
      <Typography component="h2" variant="h2">{t('mrList.notifications.title')}</Typography>
      <ToggleButtonGroup aria-label={t('mrList.notifications.show')} disabled={marking !== null} exclusive onChange={(_, next: 'unread' | 'read' | null) => { if (next) showRead(next === 'read') }} size="small" value={read ? 'read' : 'unread'}>
        <ToggleButton sx={{ px: 1, py: 0.25 }} value="unread">{t('mrList.notifications.unread')}</ToggleButton>
        <ToggleButton sx={{ px: 1, py: 0.25 }} value="read">{t('mrList.notifications.read')}</ToggleButton>
      </ToggleButtonGroup>
      <Typography aria-live="polite" color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">
        {shown ? <>{t(nextPage !== null ? 'mrList.notifications.countMore' : 'mrList.notifications.count', { count: entries.length })}{result.stale ? ` · ${t('mrList.notifications.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) })}` : result.refreshing ? ` · ${t('mrList.notifications.refreshing')}` : ''}</> : result.loading ? t('mrList.notifications.loading') : null}
      </Typography>
      {read ? null : <Button disabled={!shown || !entries.length || marking !== null} onClick={() => void markAllRead()} size="small">{marking ? marking.total === null ? t('mrList.notifications.checking') : t('mrList.notifications.marking', { done: marking.done, total: marking.total }) : t('mrList.notifications.markAll')}</Button>}
      <Tooltip title={t('mrList.notifications.refresh')}><span><IconButton aria-label={t('mrList.notifications.refreshAria')} disabled={result.loading || result.refreshing} onClick={() => { setMorePages(0); result.refresh() }}><RefreshRoundedIcon /></IconButton></span></Tooltip>
    </Row>
    <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {result.error ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('mrList.notifications.retry')}</Button>} severity={result.data ? 'warning' : 'error'} sx={{ m: 1 }}>{result.data ? t('mrList.notifications.staleError', { error: result.error.message }) : result.error.message}</Alert> : null}
      {shown && entries.length === 0 && nextPage === null ? read
        ? <PaneEmpty description={t('mrList.notifications.emptyReadDescription')} icon={<NotificationsNoneRoundedIcon fontSize="inherit" />} title={t('mrList.notifications.emptyReadTitle')} />
        : <PaneEmpty description={t('mrList.notifications.emptyDescription')} icon={<NotificationsNoneRoundedIcon fontSize="inherit" />} title={t('mrList.notifications.emptyTitle')} /> : null}
      {groups.length ? <Stack aria-label={t('mrList.notifications.title')} component="ul" onKeyDown={moveListRowFocus} spacing={1} sx={{ m: 0, p: 1 }}>
        {groups.map((group) => <NotificationCard disabled={marking !== null} group={group} key={group.key} onOpen={() => open(group)} />)}
      </Stack> : null}
      {shown && (nextPage !== null || morePages > 0) ? <MoreNotifications capped={nextPage !== null && morePages + 1 >= MAX_PAGES} cappedNote={read ? '' : t('mrList.notifications.more.readForMore')} error={last?.error ?? null} loading={loadingMore} onLoad={loadMore} onRetry={() => last?.refresh()} rootRef={scrollRef} /> : null}
    </Box>
    {Array.from({ length: morePages }, (_, index) => <NotificationPageLoader key={`${read}:${index + 2}`} onChange={reportPage} page={index + 2} read={read} sessionId={sessionId} />)}
  </>
}

/** One later page of the stack. It refreshes with the first page's reload rather than every minute on its own. */
function NotificationPageLoader({ onChange, page, read, sessionId }: { onChange: (page: number, result: PageResult | null) => void; page: number; read: boolean; sessionId: string }) {
  const query = useMemo(() => todosQuery(page, read), [page, read])
  const { data, error, loading, refresh, snapshot } = useGitLabQuery(sessionId, query, { refreshIntervalMs: false })
  const nextPage = snapshot?.nextPage ?? null
  useEffect(() => onChange(page, { data, error, loading, nextPage, refresh }), [data, error, loading, nextPage, onChange, page, refresh])
  useEffect(() => () => onChange(page, null), [onChange, page])
  return null
}

/**
 * The end of the stack: the next page loads when it comes near the bottom of the panel, or
 * from the button for keyboard use. Its height stays the same while loading so the cards do not move.
 */
function MoreNotifications({ capped, cappedNote, error, loading, onLoad, onRetry, rootRef }: { capped: boolean; cappedNote: string; error: GitLabCommandError | null; loading: boolean; onLoad?: () => void; onRetry: () => void; rootRef: RefObject<HTMLDivElement | null> }) {
  const t = useT()
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!onLoad || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoad() }, { root: rootRef.current, rootMargin: '0px 0px 240px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoad, rootRef])
  return (
    <Box ref={sentinelRef} sx={{ alignItems: 'center', display: 'flex', justifyContent: 'center', minHeight: 48, px: 1, pb: 1 }}>
      {error ? <Alert action={<Button color="inherit" onClick={onRetry}>{t('mrList.notifications.retry')}</Button>} severity="error" sx={{ flex: 1 }}>{t('mrList.notifications.more.error', { error: error.message })}</Alert>
        : loading ? <Typography color="textSecondary" role="status" variant="caption">{t('mrList.notifications.more.loading')}</Typography>
          : capped ? <Typography color="textSecondary" variant="caption">{t('mrList.notifications.more.capped', { count: MAX_PAGES * 100, note: cappedNote })}</Typography>
            : onLoad ? <Button onClick={onLoad} size="small">{t('mrList.notifications.more.load')}</Button>
              : <Typography color="textSecondary" variant="caption">{t('mrList.notifications.more.all')}</Typography>}
    </Box>
  )
}

/**
 * One MR's notifications as one card: the newest says what happened, where and when, and for a
 * mention quotes the comment. More than one shows as a stack, with how many more. The card opens
 * the MR and reads them all.
 */
function NotificationCard({ disabled, group, onOpen }: { disabled: boolean; group: NotificationGroup; onOpen: () => void }) {
  const t = useT()
  const [newest, ...others] = group.entries
  const { todo, activity } = newest
  const label = todo ? t(actionLabels[todo.actionName] ?? 'mrList.notifications.action.other')
    : activity.kind === 'pushed' ? t('mrList.notifications.activity.pushed', { count: activity.commits ?? 0 })
      : t(activity.path ? 'mrList.notifications.activity.diffComment' : activityLabels[activity.kind])
  const item = entryOf(newest)
  const quote = todo ? quotesComment.has(todo.actionName) && todo.body ? todo.body : null : activity.kind === 'comment' ? activity.note.body : null
  // The cards behind show as edges below this one, at most two, like a stack of paper.
  const behind = Math.min(others.length, 2)
  return <Box component="li" sx={{ listStyle: 'none', pb: behind * 0.5, position: 'relative' }}>
    {Array.from({ length: behind }, (_, index) => <Box aria-hidden key={index} sx={{ bgcolor: 'surface.raised', ...frame(), borderRadius: 2, bottom: (behind - 1 - index) * 4, left: (index + 1) * 6, position: 'absolute', right: (index + 1) * 6, top: 8 }} />)}
    <Box sx={{ bgcolor: 'surface.raised', ...panelFrame(), borderRadius: 2, overflow: 'hidden' }}>
      <ButtonBase data-list-row="true" disabled={disabled} onClick={onOpen} sx={{ alignItems: 'stretch', display: 'flex', flexDirection: 'column', pb: 1, px: 1.5, pt: 1, textAlign: 'left', width: '100%', '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outlineOffset: -2 } }}>
        <Row spacing={0.5} sx={{ minWidth: 0 }}>
          <StateIcon icon={todo ? actionIcons[todo.actionName] ?? <NotificationsNoneRoundedIcon fontSize="inherit" /> : activityIcons[activity.kind]} label={label} tone={(todo ? actionTones[todo.actionName] : activityTones[activity.kind]) ?? 'info'} />
          <Typography aria-hidden sx={{ fontWeight: 600 }} variant="caption">{label}</Typography>
          <Typography aria-hidden color="textSecondary" variant="caption">·</Typography>
          <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{todo ? todo.projectName : activity.projectLabel} !{item.iid}</Typography>
          {/* When the newest notification arrived, not when the MR changed. */}
          <RelativeTime value={item.createdAt} />
        </Row>
        <Typography sx={{ display: '-webkit-box', fontWeight: 600, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{item.title}</Typography>
        {activity?.path ? <Typography color="textSecondary" noWrap sx={{ fontFamily: 'code.fontFamily' }} variant="caption">{activity.path}{activity.line ? `:${activity.line}` : ''}</Typography> : null}
        {quote ? <Typography color="textSecondary" sx={{ display: '-webkit-box', overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="caption">{item.author.name}: {quote}</Typography>
          : <Typography color="textSecondary" noWrap variant="caption">{item.author.name}</Typography>}
        {others.length ? <Typography color="primary" sx={{ fontWeight: 600 }} variant="caption">{t('mrList.notifications.others', { count: others.length })}</Typography> : null}
      </ButtonBase>
    </Box>
  </Box>
}

/**
 * Marks one notification read, which marks its GitLab To-Do done. The write is recorded against
 * the To-Do's MR, so an unknown outcome stops further writes to that MR until it is checked there.
 * The caller drops what was read from the loaded pages. With `notify` null the caller reports the
 * outcome; `announceSuccess` also reports a success.
 */
async function markNotificationRead(notify: ((options: NotifyOptions) => void) | null, sessionId: string, todo: GitLabTodo, announceSuccess: boolean): Promise<boolean> {
  const result = await runGitLabMutation(sessionId, JSON.stringify({ iid: todo.iid, projectId: todo.projectId }), { iid: todo.iid, kind: 'markTodoDone', projectId: todo.projectId, todoId: todo.id })
  if (result.ok) {
    if (announceSuccess) notify?.({ message: translate('mrList.notifications.marked'), severity: 'success' })
  } else if (result.status === 'unknown') {
    notify?.({ message: translate('mrList.notifications.markUnknown'), severity: 'warning' })
  } else if (result.error) {
    notify?.({ message: translate('mrList.notifications.markFailed', { error: result.error.message }), severity: 'error' })
  }
  return result.ok
}

/** The MR view's button for its pending notification. */
export function MarkNotificationReadButton({ sessionId, todo }: { sessionId: string; todo: GitLabTodo }) {
  const t = useT()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const mutation = useGitLabMutation(sessionId, JSON.stringify({ iid: todo.iid, projectId: todo.projectId }))
  const [sending, setSending] = useState(false)
  const markRead = async () => {
    setSending(true)
    try {
      if (await markNotificationRead(notify, sessionId, todo, true)) forgetDoneTodos(queryClient, sessionId, [todo.id])
    } finally { setSending(false) }
  }
  return <Button disabled={mutation.isLocked || sending} onClick={() => void markRead()} startIcon={<DoneRoundedIcon />} variant="outlined">{sending ? t('mrList.notifications.markingOne') : t('mrList.notifications.markOne')}</Button>
}
