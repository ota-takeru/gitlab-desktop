import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded'
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined'
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded'
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
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
import { type NotifyOptions } from '../../components/Feedback'
import { useNotify } from '../../components/feedbackContext'
import { moveListRowFocus } from '../../components/listRowFocus'
import { NotificationBellIcon, NotificationCount } from '../../components/NotificationBellIcon'
import { PaneEmpty } from '../../components/Pane'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon, type StateIconTone } from '../../components/StateIcon'
import { formatFetchedAt } from '../../lib/format'
import { normalizeGitLabError, queryGitLab } from '../../lib/gitlab'
import type { GitLabCommandError, GitLabTodo, TodosQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import type { MrRef } from '../shared/personalWorkspace'
import { runGitLabMutation, useGitLabMutation } from '../shared/useGitLabMutation'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { forgetDoneTodos, isNotificationTodo } from './todoCache'

const actionLabels: Record<string, string> = { assigned: '担当依頼', mentioned: 'メンション', directly_addressed: '直接メンション', approval_required: '承認依頼', marked: 'To-Do', build_failed: 'CI失敗', unmergeable: 'マージ不可', merge_train_removed: 'マージトレイン解除', review_requested: 'レビュー依頼' }
// What blocks the MR stands out from requests and mentions.
const actionTones: Record<string, StateIconTone> = { build_failed: 'error', unmergeable: 'error', merge_train_removed: 'warning' }
// Each request has its own shape, so a stack of notifications can be scanned without reading; the name is the tooltip.
const actionIcons: Record<string, ReactElement> = { assigned: <AssignmentIndOutlinedIcon fontSize="inherit" />, mentioned: <AlternateEmailRoundedIcon fontSize="inherit" />, directly_addressed: <AlternateEmailRoundedIcon fontSize="inherit" />, approval_required: <HowToRegOutlinedIcon fontSize="inherit" />, marked: <BookmarkBorderRoundedIcon fontSize="inherit" />, build_failed: <ErrorOutlineRoundedIcon fontSize="inherit" />, unmergeable: <BlockRoundedIcon fontSize="inherit" />, merge_train_removed: <WarningAmberRoundedIcon fontSize="inherit" />, review_requested: <PersonSearchOutlinedIcon fontSize="inherit" /> }
// A mention carries the comment that made it; for the other events the text only repeats the MR.
const quotesComment = new Set(['mentioned', 'directly_addressed'])

/**
 * The navigation's notification button. The count sits inside the bell, and
 * the notifications open as a stack over the page rather than as a place.
 * The stack opens beside `navigationWidth`, the width the navigation settles at
 * (a peeked navigation folds as the stack opens), level with the button's foot.
 */
export function NotificationNavItem({ collapsed, navigationWidth, onOpen, onOpenChange }: { collapsed: boolean; navigationWidth: number; onOpen: (ref: MrRef) => void; onOpenChange?: (open: boolean) => void }) {
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
  const count = result.data?.filter(isNotificationTodo).length ?? 0
  const more = result.snapshot?.nextPage != null
  const title = count || more ? `通知 ${count}${more ? '件以上' : '件'}` : '通知'
  return <>
    <ClientNavItem collapsed={collapsed} disabled={!session} expanded={Boolean(button)} place="notifications" icon={<NotificationBellIcon count={count} more={more} withCount={collapsed} />} label="通知" onClick={(event) => openAt(event.currentTarget)} selected={Boolean(button)} title={title} trailing={<NotificationCount count={count} more={more} />} />
    <Popover
      anchorEl={anchor}
      anchorOrigin={{ horizontal: 'left', vertical: 'top' }}
      onClose={close}
      open={Boolean(anchor && session)}
      slotProps={{ paper: { 'aria-label': '通知', role: 'dialog', sx: { display: 'flex', flexDirection: 'column', maxHeight: 'min(560px, calc(100vh - 32px))', ml: 1, width: 380 } } }}
      transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
    >
      {session ? <NotificationStack onOpen={(ref) => { close(); onOpen(ref) }} sessionId={session.id} /> : null}
    </Popover>
  </>
}

/** The notifications of one MR, newest first; a mention per comment would otherwise fill the stack with one MR. */
interface NotificationGroup {
  key: string
  todos: GitLabTodo[]
}

function groupByMergeRequest(todos: GitLabTodo[]): NotificationGroup[] {
  const groups = new Map<string, GitLabTodo[]>()
  for (const todo of todos) {
    const key = `${todo.projectId}-${todo.iid}`
    groups.set(key, [...(groups.get(key) ?? []), todo])
  }
  return [...groups].map(([key, items]) => ({ key, todos: items }))
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
  const queryClient = useQueryClient()
  const notify = useNotify()
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
  const groups = useMemo(() => groupByMergeRequest(notifications), [notifications])
  const shown = result.data !== null
  const loadingMore = Boolean(last?.loading) || (morePages > 0 && !last)
  const loadMore = nextPage !== null && !loadingMore && !last?.error && morePages + 1 < MAX_PAGES ? () => setMorePages((count) => count + 1) : undefined
  const scrollRef = useRef<HTMLDivElement>(null)
  // Opening a notification reads it, with the others of its MR: the MR opens at once and the reads are sent behind it.
  const open = (group: NotificationGroup) => {
    if (read) { onOpen(group.todos[0]); return }
    void (async () => {
      const read: string[] = []
      for (const todo of group.todos) if (await markNotificationRead(notify, sessionId, todo, false)) read.push(todo.id)
      forgetDoneTodos(queryClient, sessionId, read)
    })()
    onOpen(group.todos[0])
  }
  // Every page, not only those scrolled to. Each read goes under its MR's write record, so a failed
  // or unknown one never hides the others; the list is reloaded once at the end.
  const markAllRead = async () => {
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
      notify({ message: `通知を取得できませんでした: ${normalizeGitLabError(caught).message}`, severity: 'error' })
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
      ? { message: `${read.length}件を既読にしました。${failed}件は既読にできなかったか、結果を確認できませんでした。`, severity: 'warning' }
      : { message: `通知を${read.length}件既読にしました`, severity: 'success' })
  }
  return <>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, pl: 1.5, pr: 0.5, py: 0.5 }}>
      <Typography component="h2" variant="h2">通知</Typography>
      <ToggleButtonGroup aria-label="表示する通知" disabled={marking !== null} exclusive onChange={(_, next: 'unread' | 'read' | null) => { if (next) showRead(next === 'read') }} size="small" value={read ? 'read' : 'unread'}>
        <ToggleButton sx={{ px: 1, py: 0.25 }} value="unread">未読</ToggleButton>
        <ToggleButton sx={{ px: 1, py: 0.25 }} value="read">既読</ToggleButton>
      </ToggleButtonGroup>
      <Typography aria-live="polite" color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">
        {shown ? <>{notifications.length}{nextPage !== null ? '件以上' : '件'}{result.stale ? ` · 保存済み · ${formatFetchedAt(result.snapshot?.fetchedAt)}` : result.refreshing ? ' · 更新中…' : ''}</> : result.loading ? '読み込み中…' : null}
      </Typography>
      {read ? null : <Button disabled={!shown || !notifications.length || marking !== null} onClick={() => void markAllRead()} size="small">{marking ? marking.total === null ? '通知を確認中…' : `既読にしています… ${marking.done}/${marking.total}` : 'すべて既読'}</Button>}
      <Tooltip title="更新"><span><IconButton aria-label="通知を更新" disabled={result.loading || result.refreshing} onClick={() => { setMorePages(0); result.refresh() }}><RefreshRoundedIcon /></IconButton></span></Tooltip>
    </Stack>
    <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {result.error ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity={result.data ? 'warning' : 'error'} sx={{ m: 1 }}>{result.data ? `保存済みの通知を表示中です。更新に失敗しました: ${result.error.message}` : result.error.message}</Alert> : null}
      {shown && notifications.length === 0 && nextPage === null ? read
        ? <PaneEmpty description="既読にした通知をここで見返せます。" icon={<NotificationsNoneRoundedIcon fontSize="inherit" />} title="既読の通知はありません" />
        : <PaneEmpty description="メンションやCI失敗などがあるとここに表示します。" icon={<NotificationsNoneRoundedIcon fontSize="inherit" />} title="通知はありません" /> : null}
      {groups.length ? <Stack aria-label="通知" component="ul" onKeyDown={moveListRowFocus} spacing={1} sx={{ m: 0, p: 1 }}>
        {groups.map((group) => <NotificationCard disabled={marking !== null} group={group} key={group.key} onOpen={() => open(group)} />)}
      </Stack> : null}
      {shown && (nextPage !== null || morePages > 0) ? <MoreNotifications capped={nextPage !== null && morePages + 1 >= MAX_PAGES} cappedNote={read ? '' : '既読にすると続きが表示されます。'} error={last?.error ?? null} loading={loadingMore} onLoad={loadMore} onRetry={() => last?.refresh()} rootRef={scrollRef} /> : null}
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
      {error ? <Alert action={<Button color="inherit" onClick={onRetry}>再試行</Button>} severity="error" sx={{ flex: 1 }}>続きを取得できませんでした: {error.message}</Alert>
        : loading ? <Typography color="textSecondary" role="status" variant="caption">続きを読み込み中…</Typography>
          : capped ? <Typography color="textSecondary" variant="caption">{MAX_PAGES * 100}件分まで表示しています。{cappedNote}</Typography>
            : onLoad ? <Button onClick={onLoad} size="small">さらに読み込む</Button>
              : <Typography color="textSecondary" variant="caption">すべて表示しました</Typography>}
    </Box>
  )
}

/**
 * One MR's notifications as one card: the newest says what happened, where and when, and for a
 * mention quotes the comment. More than one shows as a stack, with how many more. The card opens
 * the MR and reads them all.
 */
function NotificationCard({ disabled, group, onOpen }: { disabled: boolean; group: NotificationGroup; onOpen: () => void }) {
  const [todo, ...others] = group.todos
  const label = actionLabels[todo.actionName] ?? 'To-Do'
  // The cards behind show as edges below this one, at most two, like a stack of paper.
  const behind = Math.min(others.length, 2)
  return <Box component="li" sx={{ listStyle: 'none', pb: behind * 0.5, position: 'relative' }}>
    {Array.from({ length: behind }, (_, index) => <Box aria-hidden key={index} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'divider', borderRadius: 2, bottom: (behind - 1 - index) * 4, left: (index + 1) * 6, position: 'absolute', right: (index + 1) * 6, top: 8 }} />)}
    <Box sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
      <ButtonBase data-list-row="true" disabled={disabled} onClick={onOpen} sx={{ alignItems: 'stretch', display: 'flex', flexDirection: 'column', pb: 1, px: 1.5, pt: 1, textAlign: 'left', width: '100%', '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outlineOffset: -2 } }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          <StateIcon icon={actionIcons[todo.actionName] ?? <NotificationsNoneRoundedIcon fontSize="inherit" />} label={label} tone={actionTones[todo.actionName] ?? 'info'} />
          <Typography aria-hidden sx={{ fontWeight: 600 }} variant="caption">{label}</Typography>
          <Typography aria-hidden color="textSecondary" variant="caption">·</Typography>
          <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{todo.projectName} !{todo.iid}</Typography>
          {/* When the newest notification arrived, not when the MR changed. */}
          <RelativeTime value={todo.createdAt} />
        </Stack>
        <Typography sx={{ display: '-webkit-box', fontWeight: 600, mt: 0.25, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{todo.title}</Typography>
        {quotesComment.has(todo.actionName) && todo.body ? <Typography color="textSecondary" sx={{ display: '-webkit-box', overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="caption">{todo.author.name}: {todo.body}</Typography>
          : <Typography color="textSecondary" noWrap variant="caption">{todo.author.name}</Typography>}
        {others.length ? <Typography color="primary" sx={{ fontWeight: 600, mt: 0.25 }} variant="caption">ほか{others.length}件</Typography> : null}
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
    if (announceSuccess) notify?.({ message: '通知を既読にしました', severity: 'success' })
  } else if (result.status === 'unknown') {
    notify?.({ message: '既読にできたか確認できません。MRを開いて結果を確認してください。', severity: 'warning' })
  } else if (result.error) {
    notify?.({ message: `通知を既読にできませんでした: ${result.error.message}`, severity: 'error' })
  }
  return result.ok
}

/** The MR view's button for its pending notification. */
export function MarkNotificationReadButton({ sessionId, todo }: { sessionId: string; todo: GitLabTodo }) {
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
  return <Button disabled={mutation.isLocked || sending} onClick={() => void markRead()} startIcon={<DoneRoundedIcon />} variant="outlined">{sending ? '既読にしています…' : '通知を既読にする'}</Button>
}
