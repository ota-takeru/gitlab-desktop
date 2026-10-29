import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useConfirm } from '../../components/feedbackContext'
import { hairline, panelFrame } from '../../components/hairline'
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor'
import { ReactionBar } from '../../components/ReactionBar'
import { RelativeTime } from '../../components/RelativeTime'
import { ResolveToggle } from '../../components/ResolveToggle'
import type { AwardEmoji, Discussion, GitLabUser, Note, Position } from '../../types/gitlab'
import { useAutoUpdateSafety } from '../shared/autoUpdateSafetyContext'
import { useStableCallback } from '../shared/useStableCallback'
import { GitLabUserAvatar } from '../shared/GitLabUserAvatar'
import { GitLabUserLink } from '../../components/GitLabUserLink'
import { captureAnchor, findNote, findScrollContainer, restoreAnchor, scrollToNearest, type ScrollAnchor } from './discussionScroll'
import { CommentChangeStatus } from './CommentChangeStatus'
import { positionLabel as formatPositionLabel } from './diffLineThreads'
import { plainExcerpt } from './discussionText'
import { NoteBody, type SuggestionActions } from './SuggestionBlock'
import { seedComposerBuffer, useComposerBuffer } from './useComposerBuffer'
import { useMentionSuggestions } from './useMentionSuggestions'
import { useT } from '../../i18n/useT'

const NOTES_PER_PAGE = 50
/** Thread width from which a line comment's code sits beside its comments. */
const THREAD_WITH_CODE_WIDE = '@container (min-width: 960px)'

interface DiscussionListProps {
  projectId?: string
  /** The MR, so a comment's renamed or deleted file can be looked up. */
  iid?: string
  headSha?: string | null
  /** Session used to load GitLab avatars; initials are shown without it. */
  sessionId?: string | null
  currentUserId: string
  discussions: Discussion[]
  disabled?: boolean
  unreadNoteIds?: string[]
  replyDiscussionId?: string
  /** The reply editor, shown inside the thread being replied to. */
  replyComposer?: React.ReactNode
  onDelete: (note: Note) => Promise<boolean>
  onEdit: (note: Note, body: string) => Promise<boolean>
  onMarkRead?: (notes: Note[]) => void
  onOpenPosition?: (position: Position) => void
  onReply: (discussion: Discussion) => void
  onResolve: (discussion: Discussion, resolved: boolean) => Promise<boolean>
  /** Older discussions above the loaded ones (newest pages load first). */
  older?: OlderDiscussions
  /** The code a line comment refers to, shown beside the thread's comments. */
  renderCodeContext?: (position: Position) => React.ReactNode
  /** The own comment being edited, when the caller keeps it (so it stays open across tab changes). */
  editingNoteId?: string | null
  onEditingNoteChange?: (noteId: string | null) => void
  /** Where an edit's text is kept, like new comments, so it survives leaving the tab. */
  noteEditBufferKey?: (note: Note) => string
  /** People of the MR, offered first when `@` is typed in an edit. */
  mentionParticipants?: GitLabUser[]
  /** The emoji reactions shown under each comment. */
  reactions?: NoteReactions
  /** Applying the suggestions in the comments. */
  suggestionActions?: SuggestionActions
}

export interface NoteReactions {
  /** Each comment's reactions; an entry keeps its identity while unchanged, so the other comments do not render again. */
  awardsByNote: ReadonlyMap<string, readonly AwardEmoji[]>
  disabled: boolean
  /** Keeps one identity, like the other callbacks, so that the comments stay memoized. */
  onToggle: (note: Note, name: string, add: boolean) => Promise<boolean> | void
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

export function DiscussionList({ projectId, iid, headSha, sessionId, currentUserId, discussions, disabled = false, editingNoteId, mentionParticipants, noteEditBufferKey, older, onDelete, onEdit, onEditingNoteChange, onMarkRead, onOpenPosition, onReply, onResolve, reactions, renderCodeContext, replyComposer, replyDiscussionId, suggestionActions, unreadNoteIds = [] }: DiscussionListProps) {
  const t = useT()
  const [localEditingId, setLocalEditingId] = useState<string | null>(null)
  const editing = onEditingNoteChange ? editingNoteId ?? null : localEditingId
  const setEditing = onEditingNoteChange ?? setLocalEditingId
  const confirm = useConfirm()
  const [notePages, setNotePages] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<'all' | 'unresolved'>('all')
  const [collapsedThreads, setCollapsedThreads] = useState<Record<string, boolean>>({})
  const [pendingJumpNoteId, setPendingJumpNoteId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const restoreScrollRef = useRef<{ element: HTMLElement; top: number; left: number } | null>(null)
  const anchorRef = useRef<ScrollAnchor | null>(null)
  const olderRef = useRef(older)
  const { setUnsafe } = useAutoUpdateSafety('note-edit')
  // The comments are memoized; the callbacks they get keep one identity and run the caller's latest ones.
  const deleteNote = useStableCallback((note: Note) => onDelete(note))
  const editNote = useStableCallback((note: Note, body: string) => onEdit(note, body))
  const toggleReaction = useStableCallback((note: Note, name: string, add: boolean) => reactions?.onToggle(note, name, add))
  const applySuggestions = useStableCallback((suggestionIds: string[], commitMessage?: string) => suggestionActions?.onApply(suggestionIds, commitMessage) ?? Promise.resolve(false))
  const openSuggestionInGitLab = useStableCallback(() => suggestionActions?.onOpenInGitLab?.())
  const hasSuggestionActions = Boolean(suggestionActions)
  const canOpenInGitLab = Boolean(suggestionActions?.onOpenInGitLab)
  const { currentUserId: suggestionUserId, disabled: suggestionsDisabled, headSha: suggestionHeadSha } = suggestionActions ?? {}
  const noteSuggestionActions = useMemo<SuggestionActions | undefined>(() => hasSuggestionActions ? {
    currentUserId: suggestionUserId ?? '',
    disabled: suggestionsDisabled ?? true,
    headSha: suggestionHeadSha,
    onApply: applySuggestions,
    onOpenInGitLab: canOpenInGitLab ? openSuggestionInGitLab : undefined,
  } : undefined, [applySuggestions, canOpenInGitLab, hasSuggestionActions, openSuggestionInGitLab, suggestionHeadSha, suggestionUserId, suggestionsDisabled])
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

  // A thread is folded when first shown resolved; one already open stays open when someone else resolves it.
  const unseenThreads = commentDiscussions.filter(({ discussion }) => !(discussion.id in collapsedThreads))
  if (unseenThreads.length) setCollapsedThreads((current) => ({ ...Object.fromEntries(unseenThreads.map(({ discussion, notes }) => [discussion.id, isResolved(notes)])), ...current }))

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
    // Content that changes size by itself (an image loading, a code context arriving) is kept from moving the reading position too.
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (anchorRef.current) restoreAnchor(host, root, anchorRef.current) })
    resizes?.observe(root)
    return () => {
      resizes?.disconnect()
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
        // The view moved without a scroll event yet; the next run must keep this position, not the one before the jump.
        if (host && listRef.current) anchorRef.current = captureAnchor(host, listRef.current)
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
      if (host && listRef.current) anchorRef.current = captureAnchor(host, listRef.current)
      return
    }
    const anchor = anchorRef.current
    if (host && listRef.current && anchor) restoreAnchor(host, listRef.current, anchor)
  }, [collapsedThreads, filter, notePages, pendingJumpNoteId, visibleDiscussions, older?.loading, older?.hasOlder, older?.error])

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
    setCollapsedThreads((current) => ({ ...current, [discussion.id]: false }))
    setPendingJumpNoteId(note.id)
  }

  return (
    <Stack ref={listRef} spacing={1.5} sx={{ overflowAnchor: 'none' }}>
      <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 0.5 }}>
        <ToggleButtonGroup
          aria-label={t('review.discussion.filter')}
          disabled={paginationDisabled}
          exclusive
          onChange={(_, value: 'all' | 'unresolved' | null) => {
            if (!value) return
            updatePreservingScroll(() => setFilter(value))
          }}
          size="small"
          value={filter}
        >
          <ToggleButton value="all">{t('review.discussion.filter.all')}</ToggleButton>
          <ToggleButton value="unresolved">{t('review.discussion.filter.unresolved')}</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {latestNote ? <Button disabled={disabled || paginationDisabled} onClick={() => jumpToNote(latestNote)} size="small">{t('review.discussion.latest')}</Button> : null}
          {earliestUnreadNote ? <Button disabled={disabled || paginationDisabled} onClick={() => jumpToNote(earliestUnreadNote)} size="small">{t('review.discussion.unread')} <Chip color="primary" label={unreadNotes.length} size="small" sx={{ ml: 0.5 }} /></Button> : null}
          {onMarkRead ? <Button disabled={disabled || unreadNotes.length === 0} onClick={() => onMarkRead(loadedCommentNotes.map(({ note }) => note))} size="small">{t('review.discussion.markRead')}</Button> : null}
        </Stack>
      </Stack>
      {older && (older.hasOlder || older.loading || older.limitReached || older.error) ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', minHeight: 32 }}>
          {older.loading ? <Typography color="textSecondary" role="status" variant="caption">{t('review.discussion.older.loading')}</Typography>
            : older.error ? <><Typography color="error" variant="caption">{t('review.discussion.older.error', { message: older.error })}</Typography><Button onClick={older.onRetry}>{t('review.discussion.older.retry')}</Button></>
              : older.hasOlder ? <Button onClick={() => { const host = findScrollContainer(listRef.current); if (host && listRef.current) anchorRef.current = captureAnchor(host, listRef.current); older.onLoad() }} startIcon={<ExpandLessRoundedIcon />}>{t('review.discussion.older.load')}</Button>
                : <Typography color="textSecondary" variant="caption">{t('review.discussion.older.limit')}</Typography>}
        </Stack>
      ) : null}
      {visibleDiscussions.map(({ discussion, notes }) => {
        const canResolve = notes.some((note) => note.resolvable)
        const resolved = canResolve && notes.filter((note) => note.resolvable).every((note) => note.resolved)
        const notePageCount = pageCount(notes.length, NOTES_PER_PAGE)
        const editingNoteIndex = editing ? notes.findIndex((note) => note.id === editing) : -1
        const requestedNotePage = notePages[discussion.id] ?? 1
        const notePage = editingNoteIndex >= 0
          ? Math.floor(editingNoteIndex / NOTES_PER_PAGE) + 1
          : clampPage(requestedNotePage, notePageCount)
        const noteStart = (notePage - 1) * NOTES_PER_PAGE
        const visibleNotes = notes.slice(noteStart, noteStart + NOTES_PER_PAGE)
        const containsEditingNote = editingNoteIndex >= 0
        // Resolved threads start collapsed (see unseenThreads); any thread can be folded or opened.
        const replying = discussion.id === replyDiscussionId && Boolean(replyComposer)
        const isCollapsed = isThreadCollapsible(notes) && (collapsedThreads[discussion.id] ?? resolved) && !containsEditingNote && !replying
        const position = notes.find((note) => note.position)?.position ?? null
        const positionLabel = position ? formatPositionLabel(position) : null
        const firstNote = notes[0]
        const threadLabel = positionLabel ?? t('review.discussion.threadLabel', { author: firstNote?.author.name ?? '' })
        const codeContext = position && !isCollapsed ? renderCodeContext?.(position) : null
        return (
          <Box component="article" key={discussion.id} data-discussion-id={discussion.id} sx={{ scrollMarginTop: 'calc(var(--detail-header-height, 0px) + 8px)', bgcolor: 'surface.raised', ...panelFrame({ color: resolved ? 'divider' : 'surface.borderStrong' }), borderRadius: 1, minWidth: 0, overflow: 'clip' }}>
            {isThreadCollapsible(notes) ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ...(isCollapsed ? {} : hairline('bottom')), justifyContent: 'space-between', minHeight: 36, pl: 1.5, pr: 1, py: 0.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
                  {position ? <InsertDriveFileOutlinedIcon sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 16 }} /> : <ForumOutlinedIcon sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 16 }} />}
                  {/* A long path gives way with an ellipsis (full path in the tooltip) rather than run under the controls. */}
                  {position && positionLabel ? <Tooltip describeChild title={positionLabel}>{onOpenPosition ? (
                    <Box component="span" sx={{ display: 'flex', flex: '0 1 auto', minWidth: 0 }}>
                      <Button
                        aria-label={t('review.discussion.goToDiff', { place: positionLabel })}
                        disabled={disabled || Boolean(editing || replyDiscussionId)}
                        onClick={() => onOpenPosition(position)}
                        sx={{ display: 'block', fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', fontWeight: 500, minHeight: 24, minWidth: 0, overflow: 'hidden', px: 0.5, py: 0, textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >{positionLabel}</Button>
                    </Box>
                  ) : <Typography color="textSecondary" noWrap sx={{ flex: '0 1 auto', fontFamily: 'code.fontFamily', minWidth: 0 }} variant="caption">{positionLabel}</Typography>}</Tooltip> : <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="caption">{t('review.discussion.overview')}</Typography>}
                  {position && position.headSha !== headSha && headSha && sessionId && projectId ? <CommentChangeStatus headSha={headSha} iid={iid} position={position} projectId={projectId} sessionId={sessionId} /> : null}
                  {isCollapsed && firstNote ? <Tooltip describeChild title={plainExcerpt(firstNote.body, 300)}><Typography color="textSecondary" noWrap sx={{ flex: '1 1 0', minWidth: 0 }} variant="caption">— {firstNote.author.name}: {plainExcerpt(firstNote.body, 80)}</Typography></Tooltip> : null}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  {canResolve ? <ResolveToggle disabled={disabled} onToggle={(resolve) => void onResolve(discussion, resolve).then((ok) => { if (ok) setCollapsedThreads((current) => ({ ...current, [discussion.id]: resolve })) })} resolved={resolved} /> : null}
                  <Button
                    aria-expanded={!isCollapsed}
                    disabled={containsEditingNote || replying}
                    onClick={() => updatePreservingScroll(() => setCollapsedThreads((current) => ({ ...current, [discussion.id]: !isCollapsed })))}
                  >{isCollapsed ? t('review.discussion.expand', { count: notes.length }) : t('review.discussion.collapse')}</Button>
                </Stack>
              </Stack>
            ) : null}
            {!isCollapsed ? <Box sx={{ containerType: 'inline-size' }}><Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', [THREAD_WITH_CODE_WIDE]: codeContext ? { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' } : {} }}>
            {/* Narrow threads put the code above the comments; wide ones keep the comments where
                every thread starts and the code on their right, kept in view while reading. */}
            {codeContext ? <Box sx={{ ...hairline('bottom'), minWidth: 0, [THREAD_WITH_CODE_WIDE]: { alignSelf: 'start', '&::after': { borderWidth: '0 0 0 1px' }, gridColumn: 2, gridRow: 1, position: 'sticky', top: 'calc(var(--detail-header-height, 0px) + 8px)' } }}>{codeContext}</Box> : null}
            <Box component="ol" sx={{ listStyle: 'none', m: 0, minWidth: 0, p: 0, [THREAD_WITH_CODE_WIDE]: { gridColumn: 1, gridRow: 1 } }}>
              {visibleNotes.map((note, index) => <NoteItem
                awards={reactions?.awardsByNote.get(note.id)}
                confirm={confirm}
                currentUserId={currentUserId}
                disabled={disabled}
                divided={index > 0}
                editBufferKey={editing === note.id ? noteEditBufferKey?.(note) ?? JSON.stringify({ noteEdit: note.id }) : null}
                key={note.id}
                mentionParticipants={mentionParticipants}
                note={note}
                onDelete={deleteNote}
                onEdit={editNote}
                onToggleReaction={reactions ? toggleReaction : undefined}
                reactionsDisabled={reactions?.disabled ?? true}
                sessionId={sessionId}
                setEditing={setEditing}
                suggestionActions={noteSuggestionActions}
                unread={unreadIds.has(note.id)}
              />)}
            </Box>
            </Box></Box> : null}
            {/* A folded thread shows only its header; replying starts from the open thread. */}
            {!isCollapsed ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center', bgcolor: 'action.hover', ...hairline('top'), flexWrap: 'wrap', justifyContent: 'space-between', px: 1, py: 0.5, rowGap: 0.5 }}>
              {replying ? <Box sx={{ flex: '1 1 100%', minWidth: 0 }}>{replyComposer}</Box> : (
                <Button disabled={disabled} onClick={() => onReply(discussion)} size="small" startIcon={<ReplyRoundedIcon />}>{t('review.discussion.reply')}</Button>
              )}
              {notePageCount > 1 ? (
                <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0, ml: 'auto' }}>
                  <Button aria-label={t('review.discussion.previousComments', { thread: threadLabel })} disabled={disabled || paginationDisabled || notePage <= 1} onClick={() => updatePreservingScroll(() => setNotePages((current) => ({ ...current, [discussion.id]: notePage - 1 })))} size="small">{t('review.diff.page.previous')}</Button>
                  <Typography color="textSecondary" variant="caption">{t('review.discussion.commentRange', { start: noteRangeStart(notePage, NOTES_PER_PAGE), end: noteRangeEnd(notePage, NOTES_PER_PAGE, notes.length), total: notes.length })}</Typography>
                  <Button aria-label={t('review.discussion.nextComments', { thread: threadLabel })} disabled={disabled || paginationDisabled || notePage >= notePageCount} onClick={() => updatePreservingScroll(() => setNotePages((current) => ({ ...current, [discussion.id]: notePage + 1 })))} size="small">{t('review.diff.page.next')}</Button>
                </Stack>
              ) : null}
            </Stack> : null}
          </Box>
        )
      })}
      {commentDiscussions.length === 0 ? <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="textSecondary" variant="body2">{t('review.discussion.empty')}</Typography></Paper> : null}
      {commentDiscussions.length > 0 && filteredDiscussions.length === 0 ? <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="textSecondary" variant="body2">{t('review.discussion.noMatch')}</Typography></Paper> : null}
    </Stack>
  )
}

const noAwards: readonly AwardEmoji[] = []

interface NoteItemProps {
  awards?: readonly AwardEmoji[]
  confirm: ReturnType<typeof useConfirm>
  currentUserId: string
  disabled: boolean
  divided: boolean
  /** Where the edit's text is kept while this comment is being edited; null otherwise. */
  editBufferKey: string | null
  mentionParticipants?: GitLabUser[]
  note: Note
  onDelete: (note: Note) => Promise<boolean>
  onEdit: (note: Note, body: string) => Promise<boolean>
  onToggleReaction?: (note: Note, name: string, add: boolean) => Promise<boolean> | void
  reactionsDisabled: boolean
  sessionId?: string | null
  setEditing: (noteId: string | null) => void
  suggestionActions?: SuggestionActions
  unread: boolean
}

/** One comment. Memoized: a change to another comment (its reactions, its edit) does not render this one again. */
const NoteItem = memo(function NoteItem({ awards, confirm, currentUserId, disabled, divided, editBufferKey, mentionParticipants, note, onDelete, onEdit, onToggleReaction, reactionsDisabled, sessionId, setEditing, suggestionActions, unread }: NoteItemProps) {
  const t = useT()
  const own = note.author.id === currentUserId
  const editing = editBufferKey !== null
  const itemRef = useRef<HTMLElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  // A saved edit shows at once; GitLab's copy takes over when a refetch brings a changed body.
  const [savedEdit, setSavedEdit] = useState<{ base: string; body: string } | null>(null)
  if (savedEdit && savedEdit.base !== note.body) setSavedEdit(null)
  const shown = useMemo(() => savedEdit ? { ...note, body: savedEdit.body } : note, [note, savedEdit])
  const saveEdit = async (body: string) => {
    const saved = await onEdit(note, body)
    if (saved && body !== note.body) setSavedEdit({ base: note.body, body })
    return saved
  }
  const closeEditor = () => {
    // Focus goes back to the edit button (or the comment), unless the reader already moved it elsewhere.
    const active = document.activeElement
    const returnFocus = !active || active === document.body || Boolean(itemRef.current?.contains(active))
    setEditing(null)
    if (returnFocus) (editButtonRef.current && !editButtonRef.current.disabled ? editButtonRef.current : itemRef.current)?.focus({ preventScroll: true })
  }
  return (
    <Box
      component="li"
      data-note-id={note.id}
      ref={itemRef}
      tabIndex={-1}
      sx={{
        ...(divided ? hairline('top', { position: false }) : {}),
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
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 24, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flex: 1, flexWrap: 'wrap', minWidth: 0, rowGap: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body2"><GitLabUserLink user={note.author} /></Typography>
            <Typography color="textSecondary" sx={{ overflowWrap: 'anywhere' }} variant="caption">@{note.author.username}</Typography>
            {own ? <Typography color="textSecondary" variant="caption">{t('review.note.own')}</Typography> : null}
            <RelativeTime value={note.createdAt} />
            {note.updatedAt && note.updatedAt !== note.createdAt ? <Typography color="textSecondary" variant="caption">{t('review.note.edited')}</Typography> : null}
            {unread ? <Typography color="primary" sx={{ fontWeight: 600 }} variant="caption">{t('review.note.unread')}</Typography> : null}
          </Stack>
          {own && !note.system ? (
            <Stack className="note-actions" direction="row" sx={{ alignItems: 'center', flexShrink: 0, mr: -1, opacity: editing ? 1 : 0, transition: 'opacity 100ms', '@media (hover: none)': { opacity: 1 } }}>
              <Tooltip title={t('review.note.editTooltip')}><IconButton aria-label={t('review.note.edit', { author: note.author.name, excerpt: plainExcerpt(shown.body, 30) })} disabled={disabled} onClick={() => setEditing(note.id)} ref={editButtonRef}><EditOutlinedIcon /></IconButton></Tooltip>
              <Tooltip title={t('review.note.deleteTooltip')}><IconButton aria-label={t('review.note.delete', { author: note.author.name, excerpt: plainExcerpt(note.body, 30) })} disabled={disabled} onClick={() => void confirm({ cancelLabel: t('review.drafts.delete.cancel'), confirmLabel: t('review.drafts.delete.confirm'), destructive: true, message: plainExcerpt(note.body, 120), title: t('review.note.delete.title') }).then((ok) => { if (ok) void onDelete(note) })}><DeleteOutlineRoundedIcon /></IconButton></Tooltip>
            </Stack>
          ) : null}
        </Stack>
        {editing ? (
          <NoteEditor bufferKey={editBufferKey} disabled={disabled} mentionParticipants={mentionParticipants} note={shown} onClose={closeEditor} onSave={saveEdit} sessionId={sessionId ?? null} />
        ) : <Box sx={{ color: 'text.primary', '& :is(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6)': { maxWidth: 760 } }}><NoteBody actions={suggestionActions} note={shown} size="body1" /></Box>}
        {!editing && onToggleReaction ? <Box sx={{ mt: 1 }}><ReactionBar awards={awards ?? noAwards} currentUserId={currentUserId} disabled={reactionsDisabled} label={t('review.note.reactions', { author: note.author.name })} onToggle={(name, add) => onToggleReaction(note, name, add)} /></Box> : null}
      </Box>
    </Box>
  )
})

/**
 * Edits an own comment. Its text is kept in the composer buffer, so closing
 * (Esc) or leaving the tab keeps it; cancelling a changed text asks first.
 */
function NoteEditor({ bufferKey, disabled, mentionParticipants, note, onClose, onSave, sessionId }: { bufferKey: string; disabled: boolean; mentionParticipants?: GitLabUser[]; note: Note; onClose: () => void; onSave: (body: string) => Promise<boolean>; sessionId: string | null }) {
  const t = useT()
  const { body, change, persistenceStatus } = useComposerBuffer(bufferKey, sessionId)
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const seededRef = useRef(false)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const { containerRef: mentionContainerRef, editorProps: mentionEditorProps, handleKeyDown: handleMentionKeyDown, popup: mentionPopup } = useMentionSuggestions({ disabled: disabled || saving, editorRef, enabled: Boolean(sessionId), participants: mentionParticipants })
  useEffect(() => {
    // Start from the comment, or from the text kept when the edit was last closed.
    if (seededRef.current || persistenceStatus === 'hydrating') return
    seededRef.current = seedComposerBuffer(bufferKey, note.body)
  }, [bufferKey, note.body, persistenceStatus])
  const changed = body !== note.body
  const close = () => {
    // An unchanged copy of the comment is not worth keeping.
    if (!changed) change('')
    onClose()
  }
  const cancel = async () => {
    if (changed && !await confirm({ cancelLabel: t('review.editor.discard.cancel'), confirmLabel: t('review.editor.discard.confirm'), destructive: true, title: t('review.note.discard.title') })) return
    change('')
    onClose()
  }
  const save = async () => {
    const trimmed = body.trim()
    if (!trimmed || disabled || saving) return
    setSaving(true)
    try {
      if (await onSave(trimmed)) {
        change('')
        onClose()
      }
    } catch {
      // The text stays in the editor; the detail view reports the failure.
    } finally {
      setSaving(false)
    }
  }
  return (
    <Stack data-composer="" ref={mentionContainerRef} spacing={1} sx={{ mt: 1 }}>
      <MarkdownEditor
        {...mentionEditorProps}
        autoFocus
        disabled={disabled || saving}
        label={t('review.note.editTooltip')}
        onChange={change}
        onKeyDown={(event) => {
          if (handleMentionKeyDown(event)) return true
          if (event.key === 'Escape') { event.preventDefault(); close(); return true }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return true }
          return false
        }}
        ref={editorRef}
        value={body}
      />
      {mentionPopup}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
        <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{t('review.editor.hint')}</Typography>
        <Button disabled={saving} onClick={() => void cancel()}>{t('review.editor.cancel')}</Button>
        <Button disabled={!body.trim() || disabled || saving} onClick={() => void save()} variant="contained">{saving ? t('review.editor.saving') : t('review.editor.save')}</Button>
      </Stack>
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

/** Threads (line comments, resolvable or with replies) can be folded; a single plain comment cannot. */
function isThreadCollapsible(notes: Note[]): boolean {
  return notes.length > 1 || notes.some((note) => note.resolvable || note.position)
}
