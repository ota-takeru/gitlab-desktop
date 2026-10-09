import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { RelativeTime } from '../../components/RelativeTime'
import type { Discussion, Note, Position } from '../../types/gitlab'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { GitLabUserAvatar } from '../shared/GitLabUserAvatar'
import { captureAnchor, findNote, findScrollContainer, restoreAnchor, scrollToNearest } from './discussionScroll'

const NOTES_PER_PAGE = 50

interface DiscussionListProps {
  /** Session used to load GitLab avatars; initials are shown without it. */
  sessionId?: string | null
  currentUserId: string
  discussions: Discussion[]
  disabled?: boolean
  unreadNoteIds?: string[]
  replyDiscussionId?: string
  onDelete: (note: Note) => Promise<boolean>
  onEdit: (note: Note, body: string) => Promise<boolean>
  onMarkRead?: (notes: Note[]) => void
  onOpenPosition?: (position: Position) => void
  onReply: (discussion: Discussion) => void
  onResolve: (discussion: Discussion, resolved: boolean) => Promise<boolean>
  /** Older discussions above the loaded ones (newest pages load first). */
  older?: OlderDiscussions
}

export interface OlderDiscussions {
  hasOlder: boolean
  loading: boolean
  limitReached: boolean
  error: string | null
  onLoad: () => void
  onRetry: () => void
}

/** Start loading older threads when the reader scrolls within this distance of the top. */
const LOAD_OLDER_THRESHOLD = 600

export function DiscussionList({ sessionId, currentUserId, discussions, disabled = false, older, onDelete, onEdit, onMarkRead, onOpenPosition, onReply, onResolve, replyDiscussionId, unreadNoteIds = [] }: DiscussionListProps) {
  const [editing, setEditing] = useState<{ note: Note; body: string } | null>(null)
  const [notePages, setNotePages] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<'all' | 'unresolved'>('all')
  const [collapsedResolved, setCollapsedResolved] = useState<Record<string, boolean>>({})
  const [pendingJumpNoteId, setPendingJumpNoteId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const restoreScrollRef = useRef<{ element: HTMLElement; top: number; left: number } | null>(null)
  const anchorRef = useRef<{ id: string; offset: number } | null>(null)
  const olderRef = useRef(older)
  const { setUnsafe } = useAutoUpdateSafety('note-edit')
  const commentDiscussions = useMemo(() => discussions
    .map((discussion) => ({ discussion, notes: discussion.notes.filter((note) => !note.system) }))
    .filter(({ notes }) => notes.length > 0), [discussions])
  const unresolvedDiscussions = useMemo(() => commentDiscussions.filter(({ notes }) => !isResolved(notes)), [commentDiscussions])
  const filteredDiscussions = useMemo(() => filter === 'unresolved' ? unresolvedDiscussions : commentDiscussions, [commentDiscussions, filter, unresolvedDiscussions])
  const visibleDiscussions = filteredDiscussions
  const paginationDisabled = Boolean(editing || replyDiscussionId)
  const unreadIds = useMemo(() => new Set(unreadNoteIds), [unreadNoteIds])
  const loadedCommentNotes = useMemo(() => commentDiscussions.flatMap(({ discussion, notes }) => notes.map((note) => ({ discussion, note }))), [commentDiscussions])
  const latestNote = useMemo(() => [...loadedCommentNotes].sort((left, right) => compareNotesChronologically(left.note, right.note)).at(-1), [loadedCommentNotes])
  const unreadNotes = useMemo(() => loadedCommentNotes.filter(({ note }) => unreadIds.has(note.id)), [loadedCommentNotes, unreadIds])
  const earliestUnreadNote = useMemo(() => [...unreadNotes].sort((left, right) => compareNotesChronologically(left.note, right.note))[0], [unreadNotes])

  useEffect(() => {
    setUnsafe(Boolean(editing))
  }, [editing, setUnsafe])

  useEffect(() => {
    olderRef.current = older
  }, [older])

  // Track the thread at the top of the view so content inserted above it
  // (older pages, refreshed threads) never moves what the reader is looking at.
  // Older pages load automatically only after the reader scrolls by themself.
  useEffect(() => {
    const host = findScrollContainer(listRef.current)
    const root = listRef.current
    if (!host || !root) return
    let userIntent = false
    let frame = 0
    const markIntent = () => { userIntent = true }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        anchorRef.current = captureAnchor(host, root)
        const current = olderRef.current
        if (userIntent && current?.hasOlder && !current.loading && !current.error && host.scrollTop < LOAD_OLDER_THRESHOLD) current.onLoad()
      })
    }
    host.addEventListener('scroll', onScroll, { passive: true })
    host.addEventListener('wheel', markIntent, { passive: true })
    host.addEventListener('touchstart', markIntent, { passive: true })
    host.addEventListener('pointerdown', markIntent)
    host.addEventListener('keydown', markIntent)
    return () => {
      cancelAnimationFrame(frame)
      host.removeEventListener('scroll', onScroll)
      host.removeEventListener('wheel', markIntent)
      host.removeEventListener('touchstart', markIntent)
      host.removeEventListener('pointerdown', markIntent)
      host.removeEventListener('keydown', markIntent)
    }
  }, [])

  useLayoutEffect(() => {
    const host = findScrollContainer(listRef.current)
    if (pendingJumpNoteId) {
      const target = listRef.current ? findNote(listRef.current, pendingJumpNoteId) : null
      if (target) {
        target.focus({ preventScroll: true })
        if (host) scrollToNearest(host, target)
        else target.scrollIntoView?.({ behavior: 'auto', block: 'nearest' })
        setPendingJumpNoteId(null)
        restoreScrollRef.current = null
        return
      }
    }
    const restore = restoreScrollRef.current
    if (restore) {
      restore.element.scrollTop = restore.top
      restore.element.scrollLeft = restore.left
      restoreScrollRef.current = null
      return
    }
    const anchor = anchorRef.current
    if (host && listRef.current && anchor) restoreAnchor(host, listRef.current, anchor)
  }, [collapsedResolved, filter, notePages, pendingJumpNoteId, visibleDiscussions, older?.loading, older?.hasOlder, older?.error])

  const updatePreservingScroll = (update: () => void): void => {
    restoreScrollRef.current = captureScrollPosition(listRef.current)
    update()
  }

  const jumpToNote = ({ discussion, note }: { discussion: Discussion; note: Note }): void => {
    const targetIsResolved = isResolved(discussion.notes.filter((item) => !item.system))
    const targetFilter = targetIsResolved ? 'all' : filter
    const noteIndex = discussion.notes.filter((item) => !item.system).findIndex((item) => item.id === note.id)
    restoreScrollRef.current = null
    setFilter(targetFilter)
    setNotePages((current) => ({ ...current, [discussion.id]: Math.floor(Math.max(0, noteIndex) / NOTES_PER_PAGE) + 1 }))
    setCollapsedResolved((current) => ({ ...current, [discussion.id]: false }))
    setPendingJumpNoteId(note.id)
  }

  const visiblePageNotes = visibleDiscussions.flatMap(({ discussion, notes }) => {
    const canResolve = notes.some((note) => note.resolvable)
    const resolved = canResolve && notes.filter((note) => note.resolvable).every((note) => note.resolved)
    if (resolved && (collapsedResolved[discussion.id] ?? true)) return []
    const notePage = clampPage(notePages[discussion.id] ?? 1, pageCount(notes.length, NOTES_PER_PAGE))
    const noteStart = (notePage - 1) * NOTES_PER_PAGE
    return notes.slice(noteStart, noteStart + NOTES_PER_PAGE)
  })
  const visibleUnreadCount = visiblePageNotes.filter((note) => unreadIds.has(note.id)).length

  return (
    <Stack ref={listRef} spacing={1.5} sx={{ overflowAnchor: 'none' }}>
      <Stack direction={{ sm: 'row', xs: 'column' }} spacing={0.75} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 0.5 }}>
        <ToggleButtonGroup
          aria-label="議論の絞り込み"
          disabled={paginationDisabled}
          exclusive
          onChange={(_, value: 'all' | 'unresolved' | null) => {
            if (!value) return
            updatePreservingScroll(() => setFilter(value))
          }}
          size="small"
          value={filter}
        >
          <ToggleButton value="all">すべて</ToggleButton>
          <ToggleButton value="unresolved">未解決</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {latestNote ? <Button disabled={disabled || paginationDisabled} onClick={() => jumpToNote(latestNote)} size="small">最新へ</Button> : null}
          {earliestUnreadNote ? <Button disabled={disabled || paginationDisabled} onClick={() => jumpToNote(earliestUnreadNote)} size="small">未読へ <Chip color="primary" label={unreadNotes.length} size="small" sx={{ ml: 0.5 }} /></Button> : null}
          {onMarkRead ? <Button disabled={disabled || visibleUnreadCount === 0} onClick={() => onMarkRead(visiblePageNotes)} size="small">表示中を既読</Button> : null}
        </Stack>
      </Stack>
      {older && (older.hasOlder || older.loading || older.limitReached || older.error) ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', minHeight: 32 }}>
          {older.loading ? <Typography color="text.secondary" role="status" variant="caption">以前の議論を読み込み中…</Typography>
            : older.error ? <><Typography color="error" variant="caption">以前の議論を読み込めませんでした: {older.error}</Typography><Button onClick={older.onRetry}>再試行</Button></>
              : older.hasOlder ? <Button onClick={() => { const host = findScrollContainer(listRef.current); if (host && listRef.current) anchorRef.current = captureAnchor(host, listRef.current); older.onLoad() }} startIcon={<ExpandLessRoundedIcon />}>以前の議論を読み込む</Button>
                : <Typography color="text.secondary" variant="caption">読み込み上限に達しました。これより前の議論はGitLabで確認してください。</Typography>}
        </Stack>
      ) : null}
      {visibleDiscussions.map(({ discussion, notes }) => {
        const canResolve = notes.some((note) => note.resolvable)
        const resolved = canResolve && notes.filter((note) => note.resolvable).every((note) => note.resolved)
        const notePageCount = pageCount(notes.length, NOTES_PER_PAGE)
        const editingNoteIndex = editing?.note.id ? notes.findIndex((note) => note.id === editing.note.id) : -1
        const requestedNotePage = notePages[discussion.id] ?? 1
        const notePage = editingNoteIndex >= 0
          ? Math.floor(editingNoteIndex / NOTES_PER_PAGE) + 1
          : clampPage(requestedNotePage, notePageCount)
        const noteStart = (notePage - 1) * NOTES_PER_PAGE
        const visibleNotes = notes.slice(noteStart, noteStart + NOTES_PER_PAGE)
        const containsEditingNote = Boolean(editing?.note && notes.some((note) => note.id === editing.note.id))
        const isCollapsed = resolved && (collapsedResolved[discussion.id] ?? true) && !containsEditingNote
        const position = notes.find((note) => note.position)?.position ?? null
        const positionLabel = position ? `${position.newPath}:${position.newLine ?? position.oldLine ?? 'file'}` : null
        const firstNote = notes[0]
        return (
          <Box component="article" key={discussion.id} data-discussion-id={discussion.id} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: resolved ? 'divider' : 'surface.borderStrong', borderRadius: 2, minWidth: 0, overflow: 'hidden' }}>
            {position || canResolve ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', borderBottom: isCollapsed ? 0 : 1, borderColor: 'divider', justifyContent: 'space-between', minHeight: 36, pl: 1.5, pr: 1, py: 0.5 }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                  {position ? <InsertDriveFileOutlinedIcon sx={{ color: 'text.secondary', fontSize: 16 }} /> : <ForumOutlinedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />}
                  {position && positionLabel ? onOpenPosition ? (
                    <Button
                      aria-label={`差分へ移動: ${positionLabel}`}
                      disabled={disabled || Boolean(editing || replyDiscussionId)}
                      onClick={() => onOpenPosition(position)}
                      sx={{ flexShrink: isCollapsed ? 0 : 1, fontFamily: 'typography.code.fontFamily', fontSize: 12, fontWeight: 500, justifyContent: 'flex-start', minHeight: 24, minWidth: 0, overflowWrap: 'anywhere', px: 0.5, py: 0, textAlign: 'left', whiteSpace: 'normal' }}
                    >{positionLabel}</Button>
                  ) : <Typography color="text.secondary" sx={{ fontFamily: 'typography.code.fontFamily', minWidth: 0, overflowWrap: 'anywhere' }} variant="caption">{positionLabel}</Typography> : <Typography color="text.secondary" variant="caption">MR全体へのスレッド</Typography>}
                  {isCollapsed && firstNote ? <Typography color="text.secondary" noWrap sx={{ minWidth: 0, pl: 0.5 }} variant="caption">— {firstNote.author.name}: {firstNote.body.replace(/\s+/gu, ' ').slice(0, 80)}</Typography> : null}
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  {canResolve ? <Tooltip title={resolved ? 'クリックで未解決に戻す' : 'クリックで解決済みにする'}><span><Button
                    aria-label={resolved ? '解決済み（未解決に戻す）' : '未解決（解決済みにする）'}
                    color={resolved ? 'success' : 'warning'}
                    disabled={disabled}
                    onClick={() => void onResolve(discussion, !resolved)}
                    startIcon={resolved ? <CheckCircleRoundedIcon /> : <RadioButtonUncheckedRoundedIcon />}
                    sx={{ minHeight: 26, px: 1, py: 0 }}
                    variant="outlined"
                  >{resolved ? `解決済み${isCollapsed ? ` · ${notes.length}件` : ''}` : '未解決'}</Button></span></Tooltip> : null}
                  {resolved ? <Button
                    aria-expanded={!isCollapsed}
                    disabled={containsEditingNote}
                    onClick={() => updatePreservingScroll(() => setCollapsedResolved((current) => ({ ...current, [discussion.id]: !isCollapsed })))}
                  >{isCollapsed ? '内容を表示' : '折り畳む'}</Button> : null}
                </Stack>
              </Stack>
            ) : null}
            {!isCollapsed ? <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {visibleNotes.map((note, index) => {
                const unread = unreadIds.has(note.id)
                const own = note.author.id === currentUserId
                return (
                  <Box
                    component="li"
                    key={note.id}
                    data-note-id={note.id}
                    tabIndex={-1}
                    sx={{
                      borderTop: index > 0 ? 1 : 0,
                      borderColor: 'divider',
                      display: 'grid',
                      columnGap: 1.5,
                      gridTemplateColumns: '28px minmax(0, 1fr)',
                      minWidth: 0,
                      position: 'relative',
                      px: 2,
                      py: 1.5,
                      '&:focus': { outline: 'none' },
                      '&:focus-visible': { boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}` },
                      '&:hover .note-actions, &:focus-within .note-actions': { opacity: 1 },
                      '&::before': unread ? { bgcolor: 'primary.main', bottom: 0, content: '""', left: 0, position: 'absolute', top: 0, width: 3 } : undefined,
                    }}
                  >
                    <Box sx={{ pt: 0.25 }}><GitLabUserAvatar sessionId={sessionId} user={note.author} /></Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 26, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', flex: 1, flexWrap: 'wrap', minWidth: 0, rowGap: 0 }}>
                          <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body2">{note.author.name}</Typography>
                          <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }} variant="caption">@{note.author.username}</Typography>
                          {own ? <Typography color="text.secondary" variant="caption">（自分）</Typography> : null}
                          <RelativeTime value={note.createdAt} />
                          {note.updatedAt && note.updatedAt !== note.createdAt ? <Typography color="text.secondary" variant="caption">編集済み</Typography> : null}
                          {unread ? <Typography color="primary" sx={{ fontWeight: 600 }} variant="caption">未読</Typography> : null}
                        </Stack>
                        {own && !note.system ? (
                          <Stack className="note-actions" direction="row" sx={{ alignItems: 'center', flexShrink: 0, mr: -0.75, opacity: editing?.note.id === note.id ? 1 : 0, transition: 'opacity 100ms', '@media (hover: none)': { opacity: 1 } }}>
                            <Tooltip title="コメントを編集"><IconButton aria-label={`${note.id}を編集`} disabled={disabled} onClick={() => setEditing({ body: note.body, note })}><EditOutlinedIcon /></IconButton></Tooltip>
                            <Tooltip title="コメントを削除"><IconButton aria-label={`${note.id}を削除`} disabled={disabled} onClick={() => { if (globalThis.confirm('このコメントを削除しますか？')) void onDelete(note) }}><DeleteOutlineRoundedIcon /></IconButton></Tooltip>
                          </Stack>
                        ) : null}
                      </Stack>
                      {editing?.note.id === note.id ? (
                        <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                          <TextField autoFocus disabled={disabled} fullWidth label="コメントを編集" multiline minRows={3} onChange={(event) => setEditing({ body: event.target.value, note })} value={editing.body} />
                          <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'flex-end' }}>
                            <Button onClick={() => setEditing(null)}>取消</Button>
                            <Button disabled={!editing.body.trim() || disabled} onClick={() => void onEdit(note, editing.body.trim()).then((success) => { if (success) setEditing(null) }).catch(() => undefined)} variant="contained">保存</Button>
                          </Stack>
                        </Stack>
                      ) : <Box sx={{ color: 'text.primary', maxWidth: 760, mt: 0.25 }}><MockMarkdown body={note.body} size="body1" /></Box>}
                    </Box>
                  </Box>
                )
              })}
            </Box> : null}
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', bgcolor: 'action.hover', borderTop: 1, borderColor: 'divider', flexWrap: 'wrap', justifyContent: 'space-between', px: 1, py: 0.5, rowGap: 0.25 }}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Button disabled={disabled} onClick={() => onReply(discussion)} startIcon={<ReplyRoundedIcon />}>返信</Button>
              </Stack>
              {!isCollapsed && notePageCount > 1 ? (
                <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  <Button aria-label={`${discussion.id}の前のノートページ`} disabled={disabled || paginationDisabled || notePage <= 1} onClick={() => updatePreservingScroll(() => setNotePages((current) => ({ ...current, [discussion.id]: notePage - 1 })))} size="small">前へ</Button>
                  <Typography color="text.secondary" variant="caption">コメント {noteRangeStart(notePage, NOTES_PER_PAGE)}–{noteRangeEnd(notePage, NOTES_PER_PAGE, notes.length)} / {notes.length}</Typography>
                  <Button aria-label={`${discussion.id}の次のノートページ`} disabled={disabled || paginationDisabled || notePage >= notePageCount} onClick={() => updatePreservingScroll(() => setNotePages((current) => ({ ...current, [discussion.id]: notePage + 1 })))} size="small">次へ</Button>
                </Stack>
              ) : null}
            </Stack>
          </Box>
        )
      })}
      {commentDiscussions.length === 0 ? <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="text.secondary" variant="body2">表示できるコメントはありません。</Typography></Paper> : null}
      {commentDiscussions.length > 0 && filteredDiscussions.length === 0 ? <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="text.secondary" variant="body2">条件に合う議論はありません。</Typography></Paper> : null}
    </Stack>
  )
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 1), totalPages)
}

function noteRangeStart(page: number, pageSize: number): number {
  return (page - 1) * pageSize + 1
}

function noteRangeEnd(page: number, pageSize: number, total: number): number {
  return Math.min(page * pageSize, total)
}

function isResolved(notes: Note[]): boolean {
  const resolvableNotes = notes.filter((note) => note.resolvable)
  return resolvableNotes.length > 0 && resolvableNotes.every((note) => note.resolved)
}

function compareNotesChronologically(left: Note, right: Note): number {
  const leftDate = Date.parse(left.createdAt)
  const rightDate = Date.parse(right.createdAt)
  const leftTime = Number.isNaN(leftDate) ? Number.NEGATIVE_INFINITY : leftDate
  const rightTime = Number.isNaN(rightDate) ? Number.NEGATIVE_INFINITY : rightDate
  return leftTime - rightTime || left.id.localeCompare(right.id)
}

function captureScrollPosition(root: HTMLElement | null): { element: HTMLElement; top: number; left: number } | null {
  const element = findScrollContainer(root)
  if (element) return { element, left: element.scrollLeft, top: element.scrollTop }
  const scrollingElement = document.scrollingElement
  return scrollingElement ? { element: scrollingElement as HTMLElement, left: scrollingElement.scrollLeft, top: scrollingElement.scrollTop } : null
}
