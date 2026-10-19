import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import PublishRoundedIcon from '@mui/icons-material/PublishRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined'
import ThumbUpRoundedIcon from '@mui/icons-material/ThumbUpRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useConfirm, useNotify } from '../../components/Feedback'
import { MarkdownEditor, type MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { MergeRequestStateGlyph } from '../../components/MergeRequestStateIcon'
import { delayedRevealSx } from '../../components/paneSx'
import { PipelineStatus } from '../../components/PipelineStatus'
import { ReactionBar } from '../../components/ReactionBar'
import { applyOwnReaction } from '../../lib/awardEmoji'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon } from '../../components/StateIcon'
import { StatusPill } from '../../components/StatusPill'
import { LabelChip } from '../../components/LabelChip'
import { formatMergeRequestState, mergeRequestStateTone, shortSha } from '../../lib/format'
import { uploadGitLabAttachment } from '../../lib/attachments'
import { createRequestId, normalizeGitLabError, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import type {
  Approvals,
  AwardEmoji,
  Commit,
  DiffsQuery,
  Diff,
  Discussion,
  Draft,
  FileQuery,
  GitLabUser,
  GitLabAction,
  LabelsQuery,
  GitLabQuery,
  GitLabSnapshot,
  ApprovalsQuery,
  CommitDiffQuery,
  MergeRequest,
  MergeRequestQuery,
  MrAwardsQuery,
  MrVersion,
  MrVersionsQuery,
  Note,
  NoteAwardsQuery,
  Position,
  ReviewResourceQuery,
  VersionCompareQuery,
} from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { usePersonalWorkspace } from '../shared/personalWorkspace'
import { notifyWorkspace } from '../../lib/notifications'
import { useDiscussionWindow } from './useDiscussionWindow'
import { positionAtLatest } from './discussionScroll'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { clearGitLabMutationStates, useGitLabMutation } from '../shared/useGitLabMutation'
import { applyConfirmedGitLabChange, useGitLabQuery } from '../shared/useGitLabQuery'
import { readLoadedDiffPages, useDiscussionCode } from './useDiscussionCode'
import { DiscussionList, type NoteReactions, type OlderDiscussions } from './DiscussionList'
import type { ThreadActions } from './DiffThreads'
import { diffFileOrder, DiffViewer } from './DiffViewer'
import { LocalChanges } from './LocalChanges'
import { DiscussionLayout } from './DiscussionLayout'
import { lineKey, threadsByLine } from './diffLineThreads'
import { isUnresolvedDiscussion } from './discussionStatus'
import { UnresolvedThreadNav, UnresolvedThreadStepper } from './UnresolvedThreadNav'
import { plainExcerpt } from './discussionText'
import type { ReviewedFileContext } from './useReviewedFiles'
import { MergeRequestPeopleDialog } from './MergeRequestPeopleDialog'
import { PipelinesTab } from './PipelinesTab'
import { MergeRequestActions, MergeStatusText } from './MergeRequestActions'
import { ReviewComposer } from './ReviewComposer'
import type { SuggestionActions } from './SuggestionBlock'
import { suggestionSourceLines } from './suggestions'
import { MarkNotificationReadButton } from './NotificationPanel'
import { useLoadedMergeRequestNotifications } from './todoCache'
import { appendComposerBuffer, clearComposerBuffer, clearComposerBufferStore, createComposerBackendKey, createComposerBufferKey, moveComposerBuffer, rememberComposerTarget, restoreComposerBuffer, seedComposerBuffer, useComposerBuffer, flushComposerBuffers } from './useComposerBuffer'

export type ReviewTab = 'discussion' | 'changes' | 'overview' | 'pipelines'
type CommitsQuery = ReviewResourceQuery & { kind: 'commits' }
type DraftsQuery = ReviewResourceQuery & { kind: 'drafts' }
const commentScrollPositions = new Map<string, number>()
/** 「すべて公開」 reads at most this many pages of drafts before publishing. */
const MAX_DRAFT_PAGES = 50

/** Clear in-memory composer text when a workspace/session is disposed. */
export function clearComposerBuffers(): void {
  commentScrollPositions.clear()
  clearComposerBufferStore()
  clearGitLabMutationStates()
}

export interface MergeRequestDetailProps {
  initialMergeRequest: MergeRequest
  /** Returns to the list the MR was opened from. */
  onBack?: () => void
  /** Where onBack returns to, such as 「レビュー依頼に戻る」. */
  backLabel?: string
  onOpenProject?: () => void
  /** The tab, when the caller keeps it (in the window location, so Back returns to the previous tab). */
  tab?: ReviewTab
  onTabChange?: (tab: ReviewTab) => void
}

export function MergeRequestDetail({ backLabel = '一覧に戻る', initialMergeRequest, onBack, onOpenProject, onTabChange, tab }: MergeRequestDetailProps) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const sectionRef = useRef<HTMLElement | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)
  const [compactHeader, setCompactHeader] = useState(false)
  useEffect(() => {
    // Sticky content below the sticky header starts at its current height.
    const header = headerRef.current
    const section = sectionRef.current
    if (!header || !section || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => section.style.setProperty('--detail-header-height', `${header.offsetHeight}px`))
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    // Once the reader scrolls into the content the header keeps only the title line and the tabs.
    // The two thresholds and the scroll-room check keep it from flickering on short pages.
    const host = sectionRef.current?.closest('main')
    if (!host) return
    const update = () => setCompactHeader((compact) => compact ? host.scrollTop > 8 : host.scrollTop > 64 && host.scrollHeight - host.clientHeight > 320)
    update()
    host.addEventListener('scroll', update, { passive: true })
    return () => host.removeEventListener('scroll', update)
  }, [])
  const queryClient = useQueryClient()
  const [localTab, setLocalTab] = useState<ReviewTab>('discussion')
  const activeTab = tab ?? localTab
  const setActiveTab = (next: ReviewTab) => { if (onTabChange) onTabChange(next); else setLocalTab(next) }
  // A thread opened from the diff, shown once the discussion tab has settled.
  const pendingThread = useRef<string | null>(null)
  // A diff thread in another file reached with N / P, focused once its file is shown.
  const pendingDiffThread = useRef<{ id: string; path: string } | null>(null)
  const [descriptionEdit, setDescriptionEdit] = useState<{ body: string; expected: string } | null>(null)
  const [replyDiscussion, setReplyDiscussion] = useState<Discussion | null>(null)
  // Any tab change, including Back, closes the reply; its text stays in the composer buffer.
  const [replyTab, setReplyTab] = useState(activeTab)
  if (replyTab !== activeTab) { setReplyTab(activeTab); setReplyDiscussion(null) }
  const [viewPosition, setViewPosition] = useState<Position | undefined>()
  const [pendingFileTarget, setPendingFileTarget] = useState<string | null>(null)
  const [draftPage, setDraftPage] = useState(1)
  const [commitPage, setCommitPage] = useState(1)
  const [changePage, setChangePage] = useState(1)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  // The head of an earlier version: the changes tab then shows that version → the latest.
  const [compareVersion, setCompareVersion] = useState<string | null>(null)
  // The changes tab shows the linked local clone's working tree against the MR head.
  const [localChanges, setLocalChanges] = useState(false)
  const [fileView, setFileView] = useState<'diff' | 'file'>('diff')
  // The diff line being commented on; its editor opens under the line in the changes tab.
  const [position, setPosition] = useState<Position | undefined>()
  const [positionError, setPositionError] = useState<string | null>(null)
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([])
  const [draftStatuses, setDraftStatuses] = useState<Record<string, DraftStatus>>({})
  // The draft being edited; its text is kept in the composer buffer.
  const [draftEditId, setDraftEditId] = useState<string | null>(null)
  // Kept here, not in the discussion list, so an edit stays open across tab changes.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [publishingAll, setPublishingAll] = useState(false)
  const [approvalWriting, setApprovalWriting] = useState<'approve' | 'unapprove' | null>(null)
  const [retryingApprovals, setRetryingApprovals] = useState(false)
  const [dismissedError, setDismissedError] = useState<unknown>(null)
  const confirm = useConfirm()
  const notify = useNotify()
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [verificationReady, setVerificationReady] = useState(false)
  const [verifyingUnknown, setVerifyingUnknown] = useState(false)
  const [peopleEditor, setPeopleEditor] = useState<'assignees' | 'reviewers' | null>(null)
  const resourceId = initialMergeRequest.projectId
  const iid = initialMergeRequest.iid
  const mutationInstanceId = useId()
  // Scroll positions are remembered per opened view, so reopening an MR starts at the latest comment again.
  const scrollPositionScope = useId()
  const { setUnsafe: setReviewUnsafe } = useAutoUpdateSafety(`review:${session?.id ?? 'none'}:${resourceId}:${iid}:${mutationInstanceId}`, { persistOnUnmount: true })
  const { setUnsafe: setDescriptionEditUnsafe } = useAutoUpdateSafety(`description-edit:${session?.id ?? 'none'}:${resourceId}:${iid}`)
  const mutationResourceKey = useMemo(() => JSON.stringify({ iid, projectId: resourceId }), [iid, resourceId])
  const mutation = useGitLabMutation(session?.id ?? null, mutationResourceKey, setReviewUnsafe)

  useEffect(() => {
    setDescriptionEditUnsafe(Boolean(descriptionEdit))
  }, [descriptionEdit, setDescriptionEditUnsafe])

  const uploadAttachment = async (file: File): Promise<string | null> => {
    if (!session) return null
    const flushed = await flushComposerBuffers().catch(() => false)
    if (!flushed) throw normalizeGitLabError({ code: 'STORAGE', message: '入力の保存を確認できないため、添付を停止しました。' })
    let markdown: string | null = null
    const result = await mutation.runDetailed({ kind: 'uploadAttachment', projectId: resourceId, iid, fileName: file.name }, undefined, async () => {
      markdown = await uploadGitLabAttachment({ file, iid, projectId: resourceId, sessionId: session.id })
    })
    if (!result.ok) {
      if (result.error) throw result.error
      return null
    }
    return markdown
  }

  const currentQuery = useMemo(() => ({ iid, kind: 'mr' as const, projectId: resourceId }), [iid, resourceId])
  const currentResult = useGitLabQuery<MergeRequestQuery>(session?.id ?? null, currentQuery)
  const accessDenied = currentResult.error?.code === 'AUTH_REQUIRED' || currentResult.error?.code === 'FORBIDDEN' || currentResult.error?.code === 'NOT_FOUND'
  const mergeRequest = accessDenied ? null : currentResult.data ?? initialMergeRequest
  const mergeRequestHeadSha = mergeRequest?.diffRefs?.headSha

  // A commit's diff or a version comparison is shown read-only: no new line comments, threads or reviewed marks.
  const comparing = Boolean(compareVersion && mergeRequestHeadSha)
  const showingLocal = localChanges && Boolean(mergeRequestHeadSha)
  const readOnlyChanges = Boolean(selectedCommit) || comparing || showingLocal
  const diffsQuery = useMemo<DiffsQuery | null>(() => activeTab === 'changes' && !selectedCommit && !compareVersion && !showingLocal && mergeRequestHeadSha ? ({ headSha: mergeRequestHeadSha, iid, kind: 'diffs', page: changePage, projectId: resourceId } as DiffsQuery) : null, [activeTab, changePage, compareVersion, iid, resourceId, selectedCommit, showingLocal, mergeRequestHeadSha])
  const commitDiffQuery = useMemo<CommitDiffQuery | null>(() => activeTab === 'changes' && selectedCommit ? ({ iid, kind: 'commitDiff', page: changePage, projectId: resourceId, sha: selectedCommit } as CommitDiffQuery) : null, [activeTab, changePage, iid, resourceId, selectedCommit])
  const versionCompareQuery = useMemo<VersionCompareQuery | null>(() => activeTab === 'changes' && !selectedCommit && compareVersion && mergeRequestHeadSha ? { fromSha: compareVersion, iid, kind: 'versionCompare', page: changePage, projectId: resourceId, toSha: mergeRequestHeadSha } : null, [activeTab, changePage, compareVersion, iid, mergeRequestHeadSha, resourceId, selectedCommit])
  const versionsQuery = useMemo<MrVersionsQuery | null>(() => activeTab === 'changes' ? { iid, kind: 'mrVersions', page: 1, projectId: resourceId } : null, [activeTab, iid, resourceId])
  const commitsQuery = useMemo<CommitsQuery | null>(() => activeTab === 'changes' ? ({ iid, kind: 'commits', page: commitPage, projectId: resourceId } as CommitsQuery) : null, [activeTab, commitPage, iid, resourceId])
  // The changes tab shows pending line comments under their lines too.
  const draftQuery = useMemo<DraftsQuery | null>(() => activeTab === 'discussion' || activeTab === 'changes' ? ({ iid, kind: 'drafts', page: draftPage, projectId: resourceId } as DraftsQuery) : null, [activeTab, draftPage, iid, resourceId])
  const approvalsQuery = useMemo<ApprovalsQuery | null>(() => ({ iid, kind: 'approvals', projectId: resourceId } as ApprovalsQuery), [iid, resourceId])

  // The changes tab shows line comments too, so it keeps the discussions loaded.
  const discussionWindow = useDiscussionWindow(session?.id ?? null, resourceId, iid, activeTab === 'discussion' || activeTab === 'changes')
  const diffsResult = useGitLabQuery<DiffsQuery>(session?.id ?? null, diffsQuery)
  const commitDiffResult = useGitLabQuery<CommitDiffQuery>(session?.id ?? null, commitDiffQuery)
  const versionCompareResult = useGitLabQuery<VersionCompareQuery>(session?.id ?? null, versionCompareQuery)
  const versionsResult = useGitLabQuery<MrVersionsQuery>(session?.id ?? null, versionsQuery)
  const commitsResult = useGitLabQuery<CommitsQuery>(session?.id ?? null, commitsQuery)
  const draftsResult = useGitLabQuery<DraftsQuery>(session?.id ?? null, draftQuery)
  const approvalsResult = useGitLabQuery<ApprovalsQuery>(session?.id ?? null, approvalsQuery)

  // The diff shown in the changes tab: a commit, a version comparison, or the whole MR.
  const changesResult = selectedCommit ? commitDiffResult : comparing ? versionCompareResult : diffsResult
  const diffs = (changesResult.data ?? []) as Diff[]
  const commits = (commitsResult.data ?? []) as Commit[]
  const discussionAccessDenied = ['AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND'].includes(discussionWindow.error?.code ?? '')
  const discussions = useMemo(() => discussionAccessDenied || accessDenied ? [] : discussionWindow.discussions, [accessDenied, discussionAccessDenied, discussionWindow.discussions])
  const renderCodeContext = useDiscussionCode({ discussions, enabled: activeTab === 'discussion', headSha: mergeRequestHeadSha, iid, projectId: resourceId, sessionId: session?.id ?? null })
  const drafts = (draftsResult.data ?? []) as Draft[]
  const approvals = approvalsResult.data as Approvals | null
  const selectedDiff = diffs.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? diffs[0]
  const fileSha = selectedCommit ?? mergeRequest?.headSha
  const fileQuery = useMemo<FileQuery | null>(() => activeTab === 'changes' && fileView === 'file' && selectedDiff && fileSha ? ({ kind: 'file', path: selectedDiff.newPath || selectedDiff.oldPath, projectId: resourceId, sha: fileSha }) : null, [activeTab, fileSha, fileView, resourceId, selectedDiff])
  const fileResult = useGitLabQuery<FileQuery>(session?.id ?? null, fileQuery)
  const previousCommentIds = useRef<{ sessionId: string; notes: Map<string, string> } | null>(null)
  const commentNotes = useMemo(() => discussions.flatMap((discussion) => discussion.notes).filter((note) => !note.system), [discussions])
  const unreadNoteIds = workspace.unreadIds({ projectId: resourceId, iid }, commentNotes)
  // Reactions on the comments shown, read back to the oldest one in a single GraphQL request.
  const projectPath = mergeRequest?.projectPath ?? null
  const sinceNoteId = useMemo(() => oldestNoteId(commentNotes), [commentNotes])
  const noteAwardsQuery = useMemo<NoteAwardsQuery | null>(() => (activeTab === 'discussion' || activeTab === 'changes') && projectPath && sinceNoteId ? { iid, kind: 'noteAwards', projectPath, sinceNoteId } : null, [activeTab, iid, projectPath, sinceNoteId])
  const noteAwardsResult = useGitLabQuery<NoteAwardsQuery>(session?.id ?? null, noteAwardsQuery)
  const awardsByNote = useMemo(() => new Map((noteAwardsResult.data ?? []).map((entry) => [entry.noteId, entry.awards])), [noteAwardsResult.data])
  const mrAwardsQuery = useMemo<MrAwardsQuery | null>(() => activeTab === 'overview' ? { iid, kind: 'mrAwards', projectId: resourceId } : null, [activeTab, iid, resourceId])
  const mrAwardsResult = useGitLabQuery<MrAwardsQuery>(session?.id ?? null, mrAwardsQuery)
  const mergeRequestNotifications = useLoadedMergeRequestNotifications(session?.id ?? null, resourceId, iid)
  useEffect(() => { if (session && mergeRequest) workspace.recordRecent({ projectId: resourceId, iid }) }, [session?.id, resourceId, iid, Boolean(mergeRequest)]) // eslint-disable-line react-hooks/exhaustive-deps
  // The sidebar tab shows the title and state as last seen here.
  const tabMeta = mergeRequest ? { projectPath: mergeRequest.projectPath ?? '', state: mergeRequest.state, title: mergeRequest.title } : null
  useEffect(() => { if (session && tabMeta) workspace.rememberTab({ projectId: resourceId, iid }, tabMeta) }, [session?.id, resourceId, iid, tabMeta?.title, tabMeta?.state, tabMeta?.projectPath]) // eslint-disable-line react-hooks/exhaustive-deps
  // The close confirmation names this MR if it holds unsent input.
  useEffect(() => { if (tabMeta) rememberComposerTarget(session, resourceId, iid, { projectPath: tabMeta.projectPath, title: tabMeta.title }) }, [session, resourceId, iid, tabMeta?.title, tabMeta?.projectPath]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || accessDenied) return
    workspace.observe({ projectId: resourceId, iid }, commentNotes, discussionWindow.ready && !discussionWindow.error)
  }, [commentNotes, session, accessDenied, workspace, resourceId, iid, discussionWindow.ready, discussionWindow.error])
  const latestDiscussions = discussionWindow.latest
  useEffect(() => {
    if (!session || !latestDiscussions?.data || latestDiscussions.source !== 'network' || discussionWindow.error) return
    const currentNotes = latestDiscussions.data.flatMap((discussion) => discussion.notes).filter((note) => !note.system && note.author.id !== session.user.id)
    const previous = previousCommentIds.current
    if (previous?.sessionId === session.id && workspace.settings.notifyComments) {
      const added = currentNotes.filter((note) => previous.notes.has(note.id) && previous.notes.get(note.id) !== (note.updatedAt || note.createdAt) || !previous.notes.has(note.id) && Date.parse(note.createdAt) > Math.max(0, ...Array.from(previous.notes.values(), (date) => Date.parse(date))))
      if (added.length) void notifyWorkspace(`開いているMRに新着コメントが${added.length}件あります。`).catch(() => undefined)
    }
    previousCommentIds.current = { sessionId: session.id, notes: new Map([...(previous?.sessionId === session.id ? previous.notes : []), ...currentNotes.map((note) => [note.id, note.updatedAt || note.createdAt] as const)]) }
  }, [discussionWindow.error, latestDiscussions, session, workspace.settings.notifyComments])
  // Opening the discussion tab shows the first unread comment, or the newest
  // thread when everything is read. The position is applied before paint, and
  // only once the view's content (threads and drafts) has settled, so the
  // reader never sees the list jump. Returning from another tab restores the
  // previous position of this MR view.
  const discussionViewSettled = activeTab === 'discussion' && (discussionWindow.ready || Boolean(discussionWindow.error)) && !draftsResult.loading
  const currentUserId = session?.user.id
  const earliestUnreadNoteId = useMemo(() => {
    const unread = new Set(unreadNoteIds)
    const unreadNotes = commentNotes.filter((note) => unread.has(note.id))
    // When nothing by others has been read yet (a first visit), the newest comment is the useful start.
    const othersNotes = commentNotes.filter((note) => note.author.id !== currentUserId)
    if (unreadNotes.length === othersNotes.length) return null
    return unreadNotes.sort(compareNotesByTime)[0]?.id ?? null
  }, [commentNotes, currentUserId, unreadNoteIds])
  const latestNoteId = useMemo(() => [...commentNotes].sort(compareNotesByTime).at(-1)?.id ?? null, [commentNotes])
  useLayoutEffect(() => {
    const host = sectionRef.current?.closest('main')
    if (!host || !session || !discussionViewSettled || !sectionRef.current) return
    const key = `${scrollPositionScope}:${session.id}:${resourceId}:${iid}`
    const saved = commentScrollPositions.get(key)
    if (saved !== undefined) host.scrollTop = saved
    else positionAtLatest(host, sectionRef.current, earliestUnreadNoteId, latestNoteId)
    const remember = () => { commentScrollPositions.set(key, host.scrollTop); if (commentScrollPositions.size > 100) commentScrollPositions.delete(commentScrollPositions.keys().next().value!) }
    remember()
    host.addEventListener('scroll', remember, { passive: true })
    return () => { remember(); host.removeEventListener('scroll', remember) }
  }, [discussionViewSettled, iid, resourceId, session?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const target = pendingThread.current
    if (!target || !discussionViewSettled) return
    pendingThread.current = null
    const thread = sectionRef.current?.querySelector<HTMLElement>(`[data-discussion-id="${CSS.escape(target)}"]`)
    thread?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
    thread?.querySelector<HTMLElement>('[data-note-id]')?.focus({ preventScroll: true })
  }, [discussionViewSettled])
  useEffect(() => {
    if (!pendingFileTarget || activeTab !== 'changes' || diffsResult.loading || diffsResult.refreshing || !diffsResult.data) return
    const timer = globalThis.setTimeout(() => {
      if (diffsResult.data!.some((diff) => diff.newPath === pendingFileTarget || diff.oldPath === pendingFileTarget)) { setPendingFileTarget(null); return }
      const next = diffsResult.snapshot?.nextPage
      if (next && next <= 10) setChangePage(next)
      else { setPendingFileTarget(null); setViewPosition(undefined); setPositionError('対象ファイルを取得した差分で見つけられませんでした。GitLabで確認してください。') }
    }, 0)
    return () => globalThis.clearTimeout(timer)
  }, [activeTab, diffsResult.data, diffsResult.loading, diffsResult.refreshing, diffsResult.snapshot?.nextPage, pendingFileTarget])

  useLayoutEffect(() => {
    const pending = pendingDiffThread.current
    if (!pending) return
    if (activeTab !== 'changes') { pendingDiffThread.current = null; return }
    const thread = sectionRef.current?.querySelector<HTMLElement>(`[data-diff-thread="${CSS.escape(pending.id)}"]`)
    if (thread) {
      pendingDiffThread.current = null
      thread.scrollIntoView?.({ behavior: 'auto', block: 'start' })
      thread.focus({ preventScroll: true })
      return
    }
    // The file is shown without the thread under its lines, so there is nothing left to wait for.
    if (!pendingFileTarget && !diffsResult.loading && selectedDiff && (selectedDiff.newPath || selectedDiff.oldPath) === pending.path) pendingDiffThread.current = null
  })

  // N / P move through the unresolved threads shown in the discussion list or under the diff lines.
  const stepUnresolved = (direction: 1 | -1) => {
    const unresolvedDiscussions = discussions.filter(isUnresolvedDiscussion)
    const unresolved = new Set(unresolvedDiscussions.map((discussion) => discussion.id))
    const inDiff = activeTab === 'changes'
    const threads = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>(inDiff ? '[data-diff-thread]' : '[data-discussion-id]') ?? [])
      .filter((element) => unresolved.has((inDiff ? element.dataset.diffThread : element.dataset.discussionId) ?? ''))
    // Positions are measured from the header's lower edge, where a thread lands after scrolling to it.
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0
    const offsets = threads.map((thread) => thread.getBoundingClientRect().top - headerBottom)
    let index = direction === 1 ? offsets.findIndex((offset) => offset > 12) : offsets.flatMap((offset, at) => offset < 4 ? [at] : []).at(-1) ?? -1
    // Past the last thread of the shown file, the diff continues in the next file that has one.
    if (index < 0 && inDiff && stepToUnresolvedFile(unresolvedDiscussions, direction)) return
    if (!threads.length) {
      notify({ message: inDiff ? '差分に未解決のスレッドはありません。' : '表示中の議論に未解決のスレッドはありません。' })
      return
    }
    if (index < 0) index = direction === 1 ? 0 : threads.length - 1
    const thread = threads[index]
    thread.scrollIntoView?.({ behavior: 'auto', block: 'start' })
    const focusTarget = inDiff ? thread : thread.querySelector<HTMLElement>('[data-note-id]') ?? thread
    focusTarget.focus({ preventScroll: true })
  }
  /**
   * Opens the next (or previous) file with unresolved threads on the MR head,
   * in the order the file list shows them, page by page and wrapping around,
   * at its first (or last) thread. Files on diff pages not read yet come last.
   * Returns false when no other file has one.
   */
  const stepToUnresolvedFile = (unresolvedDiscussions: Discussion[], direction: 1 | -1): boolean => {
    if (readOnlyChanges || !session || !mergeRequestHeadSha) return false
    const pages = readLoadedDiffPages(queryClient, session.id, resourceId, iid, mergeRequestHeadSha)
    if (diffsResult.data) pages[changePage] = { data: diffsResult.data, nextPage: diffsResult.snapshot?.nextPage ?? null }
    const files: Array<{ page: number | null; path: string; threads: Discussion[] }> = []
    const placed = new Set<string>()
    for (const page of Object.keys(pages).map(Number).sort((left, right) => left - right)) {
      for (const diff of diffFileOrder(pages[page].data)) {
        const threads = sortByLine(threadsByLine(unresolvedDiscussions, diff, mergeRequestHeadSha).byLine)
        threads.forEach((thread) => placed.add(thread.id))
        files.push({ page, path: diff.newPath || diff.oldPath, threads })
      }
    }
    const unplaced = new Map<string, Map<string, Discussion[]>>()
    for (const discussion of unresolvedDiscussions) {
      const position = discussion.notes.find((note) => !note.system && note.position)?.position
      const key = position ? lineKey(position) : null
      if (placed.has(discussion.id) || !position || !key || position.positionType !== 'text' || position.headSha !== mergeRequestHeadSha) continue
      const path = position.newPath || position.oldPath
      const byLine = unplaced.get(path) ?? new Map<string, Discussion[]>()
      unplaced.set(path, byLine.set(key, [...byLine.get(key) ?? [], discussion]))
    }
    for (const path of [...unplaced.keys()].sort()) files.push({ page: null, path, threads: sortByLine(unplaced.get(path)!) })
    const shownPath = selectedDiff ? selectedDiff.newPath || selectedDiff.oldPath : null
    const current = files.findIndex((file) => file.page === changePage && file.path === shownPath)
    const start = current >= 0 ? current : direction === 1 ? -1 : files.length
    for (let step = 1; step <= files.length; step += 1) {
      const at = ((start + direction * step) % files.length + files.length) % files.length
      // Back at the shown file: no other file has one, so the shown file wraps around itself.
      if (at === current) return false
      const file = files[at]
      const thread = direction === 1 ? file.threads[0] : file.threads.at(-1)
      const position = thread?.notes.find((note) => !note.system && note.position)?.position
      if (!thread || !position) continue
      pendingDiffThread.current = { id: thread.id, path: file.path }
      // The thread's line selects the right part of a long file; a file on an unread page is looked up from the first page.
      setViewPosition(position)
      setPositionError(null)
      setFileView('diff')
      setSelectedFile(file.path)
      if (file.page !== changePage) {
        setChangePage(file.page ?? 1)
        setPendingFileTarget(file.path)
      }
      return true
    }
    return false
  }
  const stepUnresolvedRef = useRef(stepUnresolved)
  useLayoutEffect(() => { stepUnresolvedRef.current = stepUnresolved })
  useEffect(() => {
    if (activeTab === 'overview' || activeTab === 'pipelines') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || (event.key !== 'n' && event.key !== 'p')) return
      if (isEditableTarget(event.target) || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      stepUnresolvedRef.current(event.key === 'n' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab])

  if (!mergeRequest) {
    return <Stack spacing={1.5} sx={{ px: 2, py: 2 }}>{onBack ? <Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />} sx={{ alignSelf: 'flex-start' }}>{backLabel}</Button> : null}<Alert severity="error">このMRは現在の接続先または権限では表示できません。保存済みの内容は表示しません。</Alert></Stack>
  }

  const runAction = async (action: GitLabAction, refresh?: () => void, localDraftKey?: string) => {
    const success = await mutation.run(action, localDraftKey)
    if (success) refresh?.()
    return success
  }

  const commentPosition = position
  const openCommentPosition = (target: Position) => {
    setViewPosition(isPositionCurrent(target, mergeRequest) ? target : undefined)
    setPositionError(isPositionCurrent(target, mergeRequest) ? null : 'このコメントは古い版の行に付いています。最新のファイルを表示します。')
    setSelectedCommit(null); setCompareVersion(null); setFileView('diff'); setChangePage(1)
    setSelectedFile(target.newPath || target.oldPath)
    setPendingFileTarget(target.newPath || target.oldPath)
    setActiveTab('changes')
  }
  const submitComment = async (body: string, thread: boolean, targetPosition?: Position) => {
    if (targetPosition && !isPositionCurrent(targetPosition, mergeRequest)) {
      setPositionError('MRのheadが変わったため、この行位置は古くなっています。差分を更新して行を選び直してください。')
      return false
    }
    setPositionError(null)
    const localDraftKey = createComposerBackendKey(createComposerBufferKey(session, resourceId, iid, 'new', targetPosition))
    const success = await runAction({ body, iid, kind: 'comment', position: targetPosition, projectId: resourceId, thread: thread || Boolean(targetPosition) }, discussionWindow.refreshLatest, localDraftKey)
    // A line comment's editor closes once sent, so the next comment does not go to the same line.
    if (success && targetPosition) setPosition(undefined)
    return success
  }
  const saveDraft = async (body: string, targetPosition?: Position) => {
    if (targetPosition && !isPositionCurrent(targetPosition, mergeRequest)) {
      setPositionError('MRのheadが変わったため、この行位置は古くなっています。差分を更新して行を選び直してください。')
      return false
    }
    setPositionError(null)
    const localDraftKey = createComposerBackendKey(createComposerBufferKey(session, resourceId, iid, 'new', targetPosition))
    const success = await runAction({ body, iid, kind: 'saveDraft', position: targetPosition, projectId: resourceId }, draftsResult.refresh, localDraftKey)
    if (success && targetPosition) setPosition(undefined)
    return success
  }
  // Replies are written in the thread itself, apart from the new-comment composer.
  const replyComposerKey = (discussion: Discussion) => createComposerBufferKey(session, resourceId, iid, discussion.id)
  const submitReply = async (discussion: Discussion, body: string) => {
    const localDraftKey = createComposerBackendKey(replyComposerKey(discussion))
    const success = await runAction({ body, discussionId: discussion.id, iid, kind: 'reply', projectId: resourceId }, () => discussionWindow.refreshDiscussion(discussion.id), localDraftKey)
    if (success) setReplyDiscussion(null)
    return success
  }
  const saveReplyDraft = async (discussion: Discussion, body: string) => {
    const localDraftKey = createComposerBackendKey(replyComposerKey(discussion))
    const success = await runAction({ body, discussionId: discussion.id, iid, kind: 'saveDraft', projectId: resourceId }, draftsResult.refresh, localDraftKey)
    if (success) setReplyDiscussion(null)
    return success
  }

  const discussionIdForNote = (note: Note) => discussions.find((discussion) => discussion.notes.some((item) => item.id === note.id))?.id ?? null
  const noteEditBufferKey = (note: Note) => createComposerBufferKey(session, resourceId, iid, `edit:${note.id}`)
  const editNote = (note: Note, body: string) => runAction({ body, iid, kind: 'editNote', noteId: note.id, projectId: resourceId }, () => discussionWindow.refreshDiscussion(discussionIdForNote(note)))
  const deleteNote = (note: Note) => runAction({ iid, kind: 'deleteNote', noteId: note.id, projectId: resourceId }, () => discussionWindow.refreshDiscussion(discussionIdForNote(note)))
  const resolveDiscussion = (discussion: Discussion, resolved: boolean) => runAction({ discussionId: discussion.id, iid, kind: 'resolve', projectId: resourceId, resolved }, () => discussionWindow.refreshDiscussion(discussion.id))
  const toggleReaction = (name: string, add: boolean, noteId?: string) => runAction({ iid, kind: add ? 'addAward' : 'removeAward', name, projectId: resourceId, ...(noteId ? { noteId } : {}) }, () => {
    // GitLab has accepted the change: show it at once instead of after reading all the reactions back.
    if (session) {
      const change = (awards: AwardEmoji[]) => applyOwnReaction(awards, name, add, session.user)
      if (noteId && noteAwardsQuery) applyConfirmedGitLabChange(queryClient, session.id, noteAwardsQuery, (entries) => entries.some((entry) => entry.noteId === noteId)
        ? entries.map((entry) => entry.noteId === noteId ? { ...entry, awards: change(entry.awards) } : entry)
        : [...entries, { awards: change([]), noteId }])
      if (!noteId && mrAwardsQuery) applyConfirmedGitLabChange(queryClient, session.id, mrAwardsQuery, change)
    }
    if (noteId) noteAwardsResult.refresh()
    else mrAwardsResult.refresh()
  })
  const reactionsDisabled = !session || mutation.isLocked || mutation.isPending
  const noteReactions: NoteReactions = { awardsByNote, disabled: reactionsDisabled, onToggle: (note, name, add) => toggleReaction(name, add, note.id) }
  const renderNoteReactions = (note: Note) => <ReactionBar awards={awardsByNote.get(note.id) ?? []} currentUserId={session?.user.id ?? ''} disabled={reactionsDisabled} label={`${note.author.name}のコメント`} onToggle={(name, add) => toggleReaction(name, add, note.id)} />
  // Applying commits to the source branch, so the MR, its diffs and the threads all change.
  const suggestionActions: SuggestionActions | undefined = session ? {
    currentUserId: session.user.id,
    disabled: mutation.isLocked || mutation.isPending,
    headSha: mergeRequestHeadSha,
    onApply: (suggestionIds, commitMessage) => mergeRequestHeadSha
      ? runAction({ headSha: mergeRequestHeadSha, iid, kind: 'applySuggestions', projectId: resourceId, suggestionIds, ...(commitMessage ? { commitMessage } : {}) }, () => refreshAll())
      : Promise.resolve(false),
    onOpenInGitLab: () => void openInGitLab(),
  } : undefined

  const publishDraftId = async (draftId: string, knownDiscussionId?: string | null) => {
    if (draftStatuses[draftId] === 'unknown' || draftStatuses[draftId] === 'pending') return false
    setDraftStatuses((current) => ({ ...current, [draftId]: 'pending' }))
    const discussionId = knownDiscussionId !== undefined ? knownDiscussionId : drafts.find((draft) => draft.id === draftId)?.discussionId ?? null
    const outcome = await mutation.runDetailed({ draftId, iid, kind: 'publishDraft', projectId: resourceId })
    if (outcome.ok) {
      draftsResult.refresh()
      // The published comment appears in its thread, or as a new thread on the newest page.
      discussionWindow.refreshDiscussion(discussionId)
    }
    setDraftStatuses((current) => ({ ...current, [draftId]: outcome.status }))
    return outcome.ok
  }
  // Publishing shows the comment to everyone on the MR and cannot be taken back as a draft.
  const publishDraft = async (draft: Draft) => {
    if (!await confirm({ confirmLabel: '公開する', message: plainExcerpt(draft.body, 120), title: 'この下書きを公開しますか？' })) return false
    return publishDraftId(draft.id, draft.discussionId)
  }

  const draftEditBufferKey = (draft: Draft) => createComposerBufferKey(session, resourceId, iid, `draft-edit:${draft.id}`)
  const deleteDraft = async (draft: Draft) => {
    const success = await runAction({ draftId: draft.id, iid, kind: 'deleteDraft', projectId: resourceId }, draftsResult.refresh)
    // A deleted draft can no longer be edited, so an edit kept for it is dropped too.
    if (success) { clearComposerBuffer(draftEditBufferKey(draft)); setDraftEditId((current) => current === draft.id ? null : current) }
    return success
  }
  const editDraft = (draft: Draft, body: string) => runAction({ body, draftId: draft.id, iid, kind: 'editDraft', projectId: resourceId }, draftsResult.refresh)
  const publishSelectedDrafts = async () => {
    if (!selectedDrafts.length || !await confirm({ confirmLabel: `${selectedDrafts.length}件を公開する`, message: '一件ずつ公開します。途中で失敗したら残りは公開しません。', title: `選択した下書き${selectedDrafts.length}件を公開しますか？` })) return
    for (const draftId of selectedDrafts) {
      if (!await publishDraftId(draftId)) break
    }
  }
  // Every page of the pending review, read again just before publishing.
  const fetchAllDrafts = async (): Promise<Draft[]> => {
    if (!session) return []
    const all = new Map<string, Draft>()
    let page: number | null = 1
    for (let count = 0; page !== null; count += 1) {
      if (count >= MAX_DRAFT_PAGES) throw new Error('未公開レビューが多すぎるため、まとめて公開できません。GitLabで公開してください。')
      const snapshot: GitLabSnapshot<Draft[]> | null = await queryGitLab<DraftsQuery>({ mode: 'network', query: { iid, kind: 'drafts', page, projectId: resourceId } as DraftsQuery, requestId: createRequestId('drafts-all'), sessionId: session.id })
      if (!snapshot) throw new Error('未公開レビューを取得できませんでした。')
      for (const draft of snapshot.data) all.set(draft.id, draft)
      page = snapshot.nextPage
    }
    return [...all.values()]
  }
  const publishAllDrafts = async () => {
    if (publishingAll) return
    setPublishingAll(true)
    try {
      let all: Draft[]
      try {
        all = await fetchAllDrafts()
      } catch (caught) {
        notify({ message: `未公開レビューを取得できませんでした: ${normalizeGitLabError(caught).message}`, severity: 'error' })
        return
      }
      if (!all.length) { draftsResult.refresh(); return }
      if (!await confirm({ confirmLabel: `${all.length}件を公開する`, message: '一件ずつ公開します。途中で失敗したら残りは公開しません。', title: `未公開レビュー${all.length}件をすべて公開しますか？` })) return
      for (const draft of all) {
        if (!await publishDraftId(draft.id, draft.discussionId)) break
      }
      setDraftPage(1)
    } finally {
      setPublishingAll(false)
    }
  }

  const openInGitLab = async (url = mergeRequest.webUrl) => {
    if (!session) return
    try {
      await openGitLabUrl(session.id, url)
    } catch (caught) {
      // The review page remains usable if an OS/browser open is unavailable.
      notify({ message: `GitLabで開けませんでした: ${normalizeGitLabError(caught).message}`, severity: 'error' })
    }
  }
  const copyHeadSha = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha)
      notify({ message: 'headのSHAをコピーしました', severity: 'success' })
    } catch {
      notify({ message: 'SHAをコピーできませんでした', severity: 'error' })
    }
  }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(mergeRequest.webUrl)
      notify({ message: 'MRのリンクをコピーしました', severity: 'success' })
    } catch {
      notify({ message: 'リンクをコピーできませんでした', severity: 'error' })
    }
  }
  const refetchQuery = async (query: GitLabQuery) => {
    if (session) await queryClient.refetchQueries({ exact: true, queryKey: ['gitlab', session.id, JSON.stringify(query)] })
  }
  const retryApprovals = async () => {
    if (retryingApprovals || !approvalsQuery) return
    setRetryingApprovals(true)
    try {
      await refetchQuery(approvalsQuery)
    } finally {
      setRetryingApprovals(false)
    }
  }
  // The header refresh reloads everything this MR view shows, not only its overview.
  const refreshing = [currentResult, approvalsResult, draftsResult, diffsResult, commitDiffResult, versionCompareResult, versionsResult, commitsResult, fileResult, noteAwardsResult, mrAwardsResult].some((result) => result.refreshing)
  const refreshAll = () => {
    for (const result of [currentResult, approvalsResult, draftsResult, diffsResult, commitDiffResult, versionCompareResult, versionsResult, commitsResult, fileResult, noteAwardsResult, mrAwardsResult]) result.refresh()
    discussionWindow.refreshAll()
  }

  const retryUnknownReceipt = async () => {
    if (verifyingUnknown) return
    setVerifyingUnknown(true)
    try {
      await mutation.retryLookup()
    } finally {
      setVerifyingUnknown(false)
    }
  }

  const acknowledgeVerifiedOutcome = async () => {
    if (verifyingUnknown) return
    setVerifyingUnknown(true)
    try {
      const success = await mutation.reset()
      if (success) setVerificationReady(false)
    } finally {
      setVerifyingUnknown(false)
    }
  }

  const verifyUnknownOutcome = async () => {
    if (!session || !mutation.unknownAction || verifyingUnknown) return
    const unknownAction = mutation.unknownAction
    setVerifyingUnknown(true)
    setVerificationError(null)
    setVerificationReady(false)
    const queries: GitLabQuery[] = [currentQuery]
    switch (unknownAction.kind) {
      case 'comment':
      case 'reply':
      case 'editNote':
      case 'deleteNote':
      case 'resolve':
      case 'applySuggestions':
        // An applied suggestion shows as applied in its thread and moves the MR head above.
        queries.push({ iid, kind: 'discussions', page: discussionWindow.latestPage, projectId: resourceId })
        break
      case 'saveDraft':
      case 'editDraft':
      case 'deleteDraft':
      case 'publishDraft':
        queries.push({ iid, kind: 'drafts', page: 1, projectId: resourceId })
        break
      case 'approve':
      case 'unapprove':
        queries.push({ iid, kind: 'approvals', projectId: resourceId })
        break
      case 'uploadAttachment':
        // Project uploads do not appear in MR discussions until commented.
        // Require the user to inspect the project on GitLab before unlocking.
        if (!await confirm({ cancelLabel: 'まだ確認していない', confirmLabel: '確認した', message: 'アップロードした添付はMRの議論には表示されません。GitLabのプロジェクト側で添付の有無を確認してください。', title: '添付の送信結果を確認しましたか？' })) {
          setVerifyingUnknown(false)
          return
        }
        break
      case 'setAssignees':
      case 'setReviewers':
      case 'setDescription':
      case 'merge':
      case 'cancelAutoMerge':
      case 'rebase':
      case 'setState':
      case 'setTitle':
      case 'setLabels':
      case 'setMilestone':
      case 'requestChanges':
      case 'rerequestReview':
        // The merge request query above shows what these change; a review state
        // (requested changes, re-requested review) is confirmed on GitLab.
        break
      case 'addAward':
      case 'removeAward':
        if (!unknownAction.noteId) queries.push({ iid, kind: 'mrAwards', projectId: resourceId })
        else if (noteAwardsQuery) queries.push(noteAwardsQuery)
        else if (mergeRequest.projectPath) queries.push({ iid, kind: 'noteAwards', projectPath: mergeRequest.projectPath, sinceNoteId: unknownAction.noteId })
        else queries.push({ iid, kind: 'discussions', page: discussionWindow.latestPage, projectId: resourceId })
        break
      case 'markTodoDone':
        queries.push({ kind: 'todos', page: 1 })
        break
      case 'retryJob':
      case 'cancelJob':
      case 'playJob':
      case 'retryPipeline':
      case 'cancelPipeline':
        // The pipelines tab shows the newest pipelines and their states.
        queries.push({ iid, kind: 'mrPipelines', page: 1, projectId: resourceId })
        break
    }
    try {
      const keys = queries.map((query) => ['gitlab', session.id, JSON.stringify(query)] as const)
      await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ exact: true, queryKey })))
      const snapshots = await Promise.all(queries.map((query, index) => queryGitLab({
        mode: 'network',
        query,
        requestId: createRequestId(`verify-${index}`),
        sessionId: session.id,
      })))
      if (snapshots.some((snapshot) => !snapshot)) {
        throw new Error('最新状態を取得できませんでした。')
      }
      // Make the confirmed response visible before enabling acknowledgement;
      // another background refresh must not leave the old snapshot on screen.
      snapshots.forEach((snapshot, index) => queryClient.setQueryData(keys[index], { error: null, snapshot }))
      setVerificationReady(true)
    } catch (caught) {
      setVerificationError(normalizeGitLabError(caught).message)
    } finally {
      setVerifyingUnknown(false)
    }
  }

  const pinnedNow = workspace.isPinned({ projectId: resourceId, iid })
  const approvedBy = approvals && Array.isArray(approvals.approvedBy) ? approvals.approvedBy : []
  const myApproved = approvedBy.some((user) => user.id === session?.user.id)
  const approvalDisabled = mutation.isLocked || mutation.isPending || Boolean(approvalWriting) || !mergeRequest.headSha || approvalsResult.loading || !approvals || Boolean(approvalsResult.error)
  const peopleDisabled = mutation.isLocked || mutation.isPending
  const setPeople = (field: 'assignees' | 'reviewers', users: GitLabUser[]) => runAction({
    expectedUserIds: (mergeRequest[field] ?? []).map((user) => user.id),
    iid,
    kind: field === 'assignees' ? 'setAssignees' : 'setReviewers',
    projectId: resourceId,
    userIds: users.map((user) => user.id),
  }, currentResult.refresh)
  const rerequestReview = async (user: GitLabUser) => {
    const projectPath = mergeRequest.projectPath
    if (!projectPath || !await confirm({ confirmLabel: '再依頼する', message: `${user.name}さんにレビューの依頼が通知されます。`, title: `${user.name}さんにレビューを再依頼しますか？` })) return
    if (await runAction({ iid, kind: 'rerequestReview', projectId: resourceId, projectPath, userId: user.id }, currentResult.refresh)) notify({ message: `${user.name}さんにレビューを再依頼しました`, severity: 'success' })
  }
  // The button stays busy until the approvals are read back, so a second click cannot approve twice.
  const toggleApproval = async () => {
    if (!mergeRequest.headSha || approvalWriting) return false
    const confirmed = await confirm(myApproved
      ? { confirmLabel: '承認を取り消す', destructive: true, message: '必要な承認数を満たさなくなり、マージできなくなる場合があります。', title: `!${mergeRequest.iid} の承認を取り消しますか？` }
      : { confirmLabel: '承認する', message: `表示中のhead ${shortSha(mergeRequest.headSha)} を承認します。承認はMRの参加者に通知されます。`, title: `!${mergeRequest.iid} を承認しますか？` })
    if (!confirmed) return false
    const kind = myApproved ? 'unapprove' : 'approve'
    setApprovalWriting(kind)
    try {
      const success = await mutation.run({ iid, kind, projectId: resourceId, ...(myApproved ? {} : { sha: mergeRequest.headSha }) } as GitLabAction)
      if (success) {
        // List pages group by approval; let them pick up the change.
        void queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[2] === 'string' && query.queryKey[2].includes('"kind":"mrApprovals"') })
        if (approvalsQuery) await refetchQuery(approvalsQuery)
      }
      return success
    } finally {
      setApprovalWriting(null)
    }
  }
  const unresolvedCount = discussions.filter(isUnresolvedDiscussion).length
  // A failed write can be dismissed; an unknown outcome stays until it is verified.
  const visibleMutationError = mutation.error && (mutation.status === 'unknown' || mutation.error !== dismissedError) ? mutation.error : null
  const attachmentScope = JSON.stringify([session?.id, resourceId, iid])
  // The reply editor is the same in the discussion tab and in a diff thread, so its text follows the thread.
  const replyKey = replyDiscussion ? replyComposerKey(replyDiscussion) : null
  const replyComposer = replyDiscussion && replyKey ? (
    <BufferedReviewComposer
      onUploadAttachment={uploadAttachment}
      attachmentTargetKey={`${attachmentScope}:${replyKey}`}
      bufferKey={replyKey}
      disabled={mutation.isLocked}
      enableMentions={Boolean(session)}
      key={replyKey}
      onCancelReply={() => setReplyDiscussion(null)}
      onClearPosition={() => undefined}
      onSaveDraft={(body) => saveReplyDraft(replyDiscussion, body)}
      onSubmitComment={(body) => submitReply(replyDiscussion, body)}
      pending={mutation.isPending}
      replyAuthor={replyDiscussion.notes.find((note) => !note.system)?.author.name}
      replyDiscussionId={replyDiscussion.id}
    />
  ) : null
  const lineComposerKey = commentPosition ? createComposerBufferKey(session, resourceId, iid, 'new', commentPosition) : null
  const lineComposer = commentPosition && lineComposerKey && !readOnlyChanges ? {
    position: commentPosition,
    node: <BufferedReviewComposer attachmentTargetKey={`${attachmentScope}:${lineComposerKey}`} bufferKey={lineComposerKey} disabled={mutation.isLocked} enableMentions={Boolean(session)} inlineTarget key={lineComposerKey} onCancelReply={() => undefined} onClearPosition={() => setPosition(undefined)} onSaveDraft={saveDraft} onSubmitComment={submitComment} onUploadAttachment={uploadAttachment} pending={mutation.isPending} suggestionLines={commentPosition.newLine === undefined ? null : () => suggestionSourceLines(diffs, commentPosition)} targetPosition={commentPosition} />,
  } : undefined
  const commentOnLines = (nextPosition: Position) => {
    const next = normalizePosition(nextPosition, mergeRequest)
    // Choosing more lines can move the comment's last line; what was written moves with it.
    const nextKey = createComposerBufferKey(session, resourceId, iid, 'new', next)
    if (lineComposerKey && commentPosition && next.lineRange && nextKey !== lineComposerKey && commentPosition.newPath === next.newPath) moveComposerBuffer(lineComposerKey, nextKey)
    // The editor opens under the line; the tab stays on the changes.
    setViewPosition(undefined)
    setPosition(next)
    setPositionError(null)
  }
  const saveDescription = async () => {
    if (!descriptionEdit) return
    const success = await runAction({ description: descriptionEdit.body, expectedDescription: descriptionEdit.expected, iid, kind: 'setDescription', projectId: resourceId }, currentResult.refresh)
    if (success) setDescriptionEdit(null)
  }

  return (
    <Box component="section" ref={sectionRef} sx={{ minHeight: '100%', width: '100%' }}>
      <Box component="header" data-sticky-header="true" ref={headerRef} sx={{ bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', position: 'sticky', px: 2, pt: 1.5, top: 0, zIndex: 2 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minHeight: 32 }}>
          {onBack ? <Tooltip title={`${backLabel} (Esc)`}><IconButton aria-label={backLabel} onClick={onBack} sx={{ ml: -1 }}><ArrowBackRoundedIcon /></IconButton></Tooltip> : null}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
            <Tooltip title={mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`}><Button color="inherit" onClick={onOpenProject} sx={{ color: 'text.secondary', fontWeight: 400, minHeight: 24, minWidth: 0, px: 1 }}><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`}</Box></Button></Tooltip>
            <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="body2">!{mergeRequest.iid}</Typography>
            {currentResult.stale ? <Tooltip title="保存済みのMR概要を表示中です。最新の状態を取得しています。"><Typography color="textSecondary" noWrap sx={{ flexShrink: 0, pl: 0.5 }} variant="caption">保存済み · {formatFetchedAt(currentResult.snapshot?.fetchedAt)}</Typography></Tooltip> : null}
          </Stack>
          <Tooltip title={pinnedNow ? '固定を外す' : 'サイドバーに固定'}><IconButton aria-label={pinnedNow ? '固定を外す' : 'サイドバーに固定'} color={pinnedNow ? 'primary' : 'default'} onClick={() => workspace.togglePinned({ projectId: resourceId, iid }, tabMeta ?? undefined)}>{pinnedNow ? <PushPinIcon /> : <PushPinOutlinedIcon />}</IconButton></Tooltip>
          <Tooltip title={refreshing ? '更新中…' : '最新の状態を取得'}><span><IconButton aria-label="更新" disabled={refreshing} onClick={refreshAll}><RefreshRoundedIcon /></IconButton></span></Tooltip>
          <Tooltip title="GitLabで開く"><IconButton aria-label="GitLabで開く" onClick={() => void openInGitLab()}><LaunchRoundedIcon /></IconButton></Tooltip>
          <Tooltip title="リンクをコピー"><IconButton aria-label="リンクをコピー" onClick={() => void copyLink()}><LinkRoundedIcon /></IconButton></Tooltip>
          {session && mergeRequestNotifications[0] ? <Tooltip title={mergeRequestNotifications.length > 1 ? `このMRの未読の通知 ${mergeRequestNotifications.length}件のうち1件を既読にします` : 'このMRの通知を既読にします'}><Box component="span" sx={{ pl: 1 }}><MarkNotificationReadButton sessionId={session.id} todo={mergeRequestNotifications[0]} /></Box></Tooltip> : null}
          <Box sx={{ pl: 1 }}>
            {approvalsResult.error && !approvalWriting ? <Tooltip title={`承認状態を取得できませんでした: ${approvalsResult.error.message}`}><span><Button disabled={retryingApprovals} onClick={() => void retryApprovals()} startIcon={<RefreshRoundedIcon />} variant="outlined">{retryingApprovals ? '再取得中…' : '承認状態を再取得'}</Button></span></Tooltip>
              : <Button disabled={approvalDisabled} onClick={() => void toggleApproval()} startIcon={myApproved ? <UndoRoundedIcon /> : <CheckRoundedIcon />} variant={myApproved ? 'outlined' : 'contained'}>{approvalWriting === 'approve' ? '承認中…' : approvalWriting === 'unapprove' ? '取り消し中…' : approvalsResult.loading && !approvals ? '確認中…' : myApproved ? '自分の承認を取り消す' : '承認する'}</Button>}
          </Box>
          <MergeRequestActions disabled={peopleDisabled} isReviewer={Boolean(mergeRequest.reviewers?.some((user) => user.id === session?.user.id))} mergeRequest={mergeRequest} onRefresh={currentResult.refresh} onRun={(action) => runAction(action, currentResult.refresh)} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mt: 1 }}>
          <Tooltip enterDelay={600} title={mergeRequest.title}><Typography component="h1" sx={{ display: '-webkit-box', flex: 1, minWidth: 0, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: compactHeader ? 1 : 2 }} variant="h1">{mergeRequest.title}</Typography></Tooltip>
        </Stack>
        {compactHeader ? null : <>
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
          <StatusPill icon={<MergeRequestStateGlyph state={mergeRequest.state} />} label={formatMergeRequestState(mergeRequest.state)} size="small" subtle tone={mergeRequestStateTone(mergeRequest.state)} />
          {mergeRequest.draft ? <Chip icon={<EditNoteRoundedIcon />} label="Draft" size="small" variant="outlined" /> : null}
          <Typography color="textSecondary" variant="caption"><Box component="span" sx={{ color: 'text.primary' }}>{mergeRequest.author.name}</Box></Typography>
          <RelativeTime prefix="更新" value={mergeRequest.updatedAt} />
          <Tooltip title={`${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`}><Typography color="textSecondary" noWrap sx={{ fontFamily: 'code.fontFamily', maxWidth: '100%', minWidth: 0 }} variant="caption">{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography></Tooltip>
          {mergeRequest.headSha ? <Tooltip title="headのSHAをコピー"><Chip icon={<ContentCopyRoundedIcon />} label={shortSha(mergeRequest.headSha)} onClick={() => void copyHeadSha(mergeRequest.headSha ?? '')} size="small" sx={{ fontFamily: 'code.fontFamily' }} variant="outlined" /></Tooltip> : null}
          {mergeRequest.pipeline ? <PipelineStatus status={mergeRequest.pipeline.status} /> : null}
          {approvedBy.length ? <StateIcon count={approvedBy.length} icon={myApproved ? <ThumbUpRoundedIcon fontSize="inherit" /> : <ThumbUpOutlinedIcon fontSize="inherit" />} label={`${approvedBy.length}人が承認済み（${approvedBy.map((user) => user.name).join('、')}）`} tone="success" /> : null}
          <MergeStatusText mergeRequest={mergeRequest} />
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', mt: 0.25, rowGap: 0 }}>
          {([['assignees', '担当'], ['reviewers', 'レビュー']] as const).map(([field, label]) => (
            // The label, the names and the pencil are one quiet button, so the edit action reads as part of the line.
            <Tooltip key={field} title={field === 'assignees' ? '担当者を変更' : 'レビュアーを変更'}><span><Button color="inherit" aria-label={`${field === 'assignees' ? '担当者を変更' : 'レビュアーを変更'}（現在: ${mergeRequest[field]?.length ? mergeRequest[field].map((user) => user.name).join('、') : 'なし'}）`} disabled={peopleDisabled} endIcon={<EditOutlinedIcon />} onClick={() => setPeopleEditor(field)} size="small" sx={{ color: 'text.secondary', fontWeight: 400, mx: -0.5, textAlign: 'left', whiteSpace: 'normal', '&.MuiButton-sizeSmall': { fontSize: 'caption.fontSize', minHeight: 24, px: 0.5, py: 0 }, '& .MuiButton-endIcon': { color: 'text.secondary', ml: 0.5, opacity: 0.6 }, '& .MuiButton-endIcon > *:nth-of-type(1)': { fontSize: 14 }, '&:hover': { bgcolor: 'action.hover', color: 'text.primary' }, '&:hover .MuiButton-endIcon': { opacity: 1 } }}>{label}: {mergeRequest[field]?.length ? mergeRequest[field].map((user) => user.name).join('、') : 'なし'}</Button></span></Tooltip>
          ))}
        </Stack>
        </>}
        {peopleEditor ? <MergeRequestPeopleDialog current={mergeRequest[peopleEditor] ?? []} disabled={peopleDisabled} label={peopleEditor === 'assignees' ? '担当者' : 'レビュアー'} onClose={() => setPeopleEditor(null)} onSave={(users) => setPeople(peopleEditor, users)} open /> : null}
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, mb: '-1px', mt: 0.5 }}>
          <Tabs aria-label="MR詳細" onChange={(_, value: ReviewTab) => setActiveTab(value)} sx={{ flex: '0 1 auto', minWidth: 0 }} value={activeTab}>
            <Tab label={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>議論</span>{unresolvedCount > 0 ? <Chip aria-label={`未解決${unresolvedCount}件`} color="warning" label={unresolvedCount} size="small" variant="outlined" /> : null}</Stack>} value="discussion" />
            <Tab label="変更" value="changes" />
            <Tab label="概要" value="overview" />
            <Tab label="パイプライン" value="pipelines" />
          </Tabs>
          {activeTab !== 'overview' && activeTab !== 'pipelines' && unresolvedCount > 0 ? <Box sx={{ ml: 'auto' }}><UnresolvedThreadStepper count={unresolvedCount} onStep={stepUnresolved} /></Box> : null}
        </Stack>
        {/* Write results stay in view under the header, wherever in a long thread the action was taken. */}
        {positionError || visibleMutationError || verificationError ? <Stack aria-live="polite" spacing={1} sx={{ pb: 1, pt: 1.5 }}>
          {positionError ? <Alert onClose={() => setPositionError(null)} severity="warning">{positionError}</Alert> : null}
          {visibleMutationError ? <Alert action={mutation.status === 'unknown' ? <Button color="inherit" disabled={verifyingUnknown} onClick={() => { if (!mutation.unknownAction) void retryUnknownReceipt(); else if (verificationReady) void acknowledgeVerifiedOutcome(); else void verifyUnknownOutcome() }}>{verifyingUnknown ? '確認中…' : !mutation.unknownAction ? '確認記録を再取得' : verificationReady ? '再取得結果を確認した' : 'サーバーから再取得'}</Button> : undefined} onClose={mutation.status === 'unknown' ? undefined : () => setDismissedError(visibleMutationError)} severity={mutation.status === 'unknown' ? 'warning' : 'error'}>{mutation.status === 'unknown' ? verificationReady ? '最新状態を再取得しました。結果を画面で確認してから再送停止を解除してください。' : `${actionLabel(mutation.unknownAction)}の結果を確認できないため、このMRへの再送を停止しています。` : visibleMutationError.message}</Alert> : null}
          {verificationError ? <Alert onClose={() => setVerificationError(null)} severity="error">確認用の再取得に失敗しました: {verificationError}</Alert> : null}
        </Stack> : null}
      </Box>

      <Stack spacing={1} sx={{ px: 2, py: 2 }}>
        {noteAwardsQuery && noteAwardsResult.error ? <Alert action={<Button color="inherit" onClick={noteAwardsResult.refresh}>再試行</Button>} severity="warning">{noteAwardsResult.data ? `保存済みのリアクションを表示中です。更新に失敗しました: ${noteAwardsResult.error.message}` : `コメントのリアクションを取得できませんでした: ${noteAwardsResult.error.message}`}</Alert> : null}
        {noteAwardsQuery && noteAwardsResult.snapshot?.completeness === 'truncated' ? <Alert severity="info">コメントが多いため、古いコメントのリアクションは表示していません。GitLabで確認してください。</Alert> : null}
        {activeTab === 'discussion' ? <Box sx={{ width: '100%' }}><DiscussionTab suggestionActions={suggestionActions} renderCodeContext={renderCodeContext} onUploadAttachment={uploadAttachment} attachmentTargetKey={attachmentScope} composerKey={createComposerBufferKey(session, resourceId, iid, 'new')} replyComposer={replyComposer} currentUserId={session?.user.id ?? ''} discussions={discussions} unreadNoteIds={unreadNoteIds} onMarkRead={(notes) => workspace.markRead({ projectId: resourceId, iid }, notes)} onOpenPosition={openCommentPosition} discussionError={discussionWindow.error} older={{ error: discussionWindow.olderError?.message ?? null, hasOlder: discussionWindow.hasOlder, limitReached: discussionWindow.limitReached, loading: discussionWindow.loadingOlder, onLoad: discussionWindow.loadOlder, onRetry: discussionWindow.retryOlder }} draftEditBufferKey={draftEditBufferKey} draftEditId={draftEditId} draftError={draftsResult.error} draftLoading={draftsResult.loading} draftNextPage={draftsResult.snapshot?.nextPage ?? null} draftPage={draftPage} draftStatuses={draftStatuses} editingNoteId={editingNoteId} noteEditBufferKey={noteEditBufferKey} onEditingNoteChange={setEditingNoteId} onPrevDraftPage={() => setDraftPage((current) => Math.max(1, current - 1))} publishingAll={publishingAll} drafts={drafts} loading={discussionWindow.loading} mutationLocked={mutation.isLocked} mutationPending={mutation.isPending} onDeleteDraft={deleteDraft} onDeleteNote={deleteNote} onEditDraft={editDraft} onEditNote={editNote} onNextDraftPage={() => setDraftPage((current) => current + 1)} onPublishDraft={publishDraft} onPublishAllDrafts={publishAllDrafts} onPublishSelectedDrafts={publishSelectedDrafts} onReply={setReplyDiscussion} onResolve={resolveDiscussion} reactions={noteReactions} onSaveDraft={saveDraft} onSelectDraft={(id) => setSelectedDrafts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSetDraftEdit={setDraftEditId} onSubmitComment={submitComment} onCancelReply={() => setReplyDiscussion(null)} replyDiscussion={replyDiscussion} selectedDrafts={selectedDrafts} /></Box> : null}
        {discussionWindow.observers}
        {activeTab === 'changes' && drafts.length ? <Alert action={<Button color="inherit" onClick={() => setActiveTab('discussion')} size="small">議論タブで公開</Button>} severity="info">未公開レビューが{drafts.length}件あります。公開するまでMRには反映されません。</Alert> : null}
        {activeTab === 'changes' ? <ChangesTab fileSource={session && fileSha ? { projectId: resourceId, sessionId: session.id, sha: fileSha } : undefined} threadActions={readOnlyChanges ? undefined : {
          disabled: mutation.isLocked || mutation.isPending,
          onReply: setReplyDiscussion,
          onResolve: (discussion, resolved) => void resolveDiscussion(discussion, resolved),
          renderReactions: renderNoteReactions,
          replyDiscussionId: replyDiscussion?.id ?? null,
          replyComposer,
        }} pendingDrafts={readOnlyChanges ? undefined : drafts} lineComposer={lineComposer} discussions={readOnlyChanges ? undefined : discussions} compareBaseSha={mergeRequest.diffRefs?.baseSha} discussionHeadSha={mergeRequestHeadSha} discussionsIncomplete={discussionWindow.hasOlder} onOpenDiscussion={(discussionId) => { pendingThread.current = discussionId; setActiveTab('discussion') }} reviewContext={session && !readOnlyChanges && mergeRequestHeadSha ? { instanceUrl: session.instanceUrl, userId: session.user.id, projectId: resourceId, mergeRequestIid: iid, revision: mergeRequestHeadSha } : undefined} allowComments={!readOnlyChanges} changeNextPage={changesResult.snapshot?.nextPage ?? null} changePage={changePage} commitPage={commitPage} changesError={changesResult.error} changesLoading={Boolean(pendingFileTarget) || changesResult.loading} changesTruncated={comparing && changesResult.snapshot?.completeness === 'truncated'} commitNextPage={commitsResult.snapshot?.nextPage ?? null} commits={commits} commitsError={commitsResult.error} local={session && mergeRequestHeadSha ? { active: showingLocal, content: <LocalChanges headSha={mergeRequestHeadSha} onSelectFile={setSelectedFile} projectId={resourceId} projectPath={mergeRequest.projectPath ?? null} selectedFile={selectedFile} sessionId={session.id} />, onSelect: () => { setLocalChanges(!showingLocal); setSelectedCommit(null); setCompareVersion(null); setSelectedFile(null); setFileView('diff'); setChangePage(1) } } : undefined} commitsLoading={commitsResult.loading} diffs={pendingFileTarget ? [] : diffs} fileResult={fileResult} fileView={fileView} onComment={commentOnLines} onNextChangePage={() => setChangePage((current) => current + 1)} onNextCommitPage={() => setCommitPage((current) => current + 1)} onPrevChangePage={() => setChangePage((current) => Math.max(1, current - 1))} onPrevCommitPage={() => setCommitPage((current) => Math.max(1, current - 1))} onSelectCommit={(sha) => { setSelectedCommit(sha); setCompareVersion(null); setLocalChanges(false); setSelectedFile(null); setFileView('diff'); setChangePage(1) }} onSelectFile={setSelectedFile} onViewChange={setFileView} selectedCommit={selectedCommit} selectedFile={selectedFile} selectedPosition={viewPosition ?? commentPosition} suggestionActions={readOnlyChanges ? undefined : suggestionActions} versions={{ compareFrom: comparing ? compareVersion : null, error: versionsResult.error, headSha: mergeRequestHeadSha, items: (versionsResult.data ?? []) as MrVersion[], loading: versionsResult.loading, more: (versionsResult.snapshot?.nextPage ?? null) !== null, onSelect: (sha) => { setCompareVersion(sha); setSelectedCommit(null); setLocalChanges(false); setSelectedFile(null); setFileView('diff'); setChangePage(1) } }} /> : null}
        {activeTab === 'overview' ? <OverviewTab approvedBy={approvedBy} approvalsError={approvalsResult.error} approvalsLoading={approvalsResult.loading} description={mergeRequest.description} descriptionEdit={descriptionEdit} editDisabled={mutation.isLocked || mutation.isPending} mergeRequest={mergeRequest} onRerequestReview={(user) => void rerequestReview(user)} onCancelEdit={() => setDescriptionEdit(null)} onChangeEdit={(body) => setDescriptionEdit((current) => current ? { ...current, body } : current)} onSaveEdit={() => void saveDescription()} onStartEdit={() => setDescriptionEdit({ body: mergeRequest.description ?? '', expected: mergeRequest.description ?? '' })} reactions={<Stack spacing={0.5}>
          <ReactionBar awards={mrAwardsResult.data ?? []} currentUserId={session?.user.id ?? ''} disabled={reactionsDisabled} label="このMR" onToggle={(name, add) => toggleReaction(name, add)} />
          {mrAwardsResult.loading ? <Typography color="textSecondary" role="status" variant="caption">リアクションを読み込み中…</Typography> : null}
          {mrAwardsResult.error ? <Typography color={mrAwardsResult.data ? 'textSecondary' : 'error'} variant="caption">{mrAwardsResult.data ? `保存済みのリアクションを表示中です。更新に失敗しました: ${mrAwardsResult.error.message}` : `リアクションを取得できませんでした: ${mrAwardsResult.error.message}`}</Typography> : null}
        </Stack>} /> : null}
        {activeTab === 'pipelines' ? <PipelinesTab disabled={mutation.isLocked || mutation.isPending} iid={iid} onOpenUrl={(url) => void openInGitLab(url)} onRunAction={(action) => runAction(action)} projectId={resourceId} sessionId={session?.id ?? null} /> : null}
      </Stack>
    </Box>
  )
}

function DiscussionTab({ suggestionActions, renderCodeContext, reactions, onUploadAttachment, attachmentTargetKey, composerKey, replyComposer, currentUserId, unreadNoteIds, onMarkRead, onOpenPosition, discussionError, older, discussions, draftEditBufferKey, draftEditId, draftError, draftLoading, draftNextPage, draftPage, draftStatuses, drafts, editingNoteId, loading, mutationLocked, mutationPending, noteEditBufferKey, onCancelReply, onDeleteDraft, onDeleteNote, onEditDraft, onEditNote, onEditingNoteChange, onNextDraftPage, onPrevDraftPage, onPublishAllDrafts, onPublishDraft, onPublishSelectedDrafts, onReply, onResolve, onSaveDraft, onSelectDraft, onSetDraftEdit, onSubmitComment, publishingAll, replyDiscussion, selectedDrafts }: DiscussionTabProps) {
  const { session } = useConnection()
  const mutationDisabled = mutationLocked || mutationPending
  const openThread = (discussionId: string) => {
    const thread = document.querySelector<HTMLElement>(`[data-discussion-id="${CSS.escape(discussionId)}"]`)
    if (!thread) return
    thread.scrollIntoView?.({ behavior: 'auto', block: 'start' })
    thread.querySelector<HTMLElement>('[data-note-id]')?.focus({ preventScroll: true })
  }
  return (
    <DiscussionLayout
      composer={(
        <BufferedReviewComposer onUploadAttachment={onUploadAttachment} attachmentTargetKey={`${attachmentTargetKey}:${composerKey}`} enableMentions={Boolean(currentUserId)} key={composerKey} bufferKey={composerKey} disabled={mutationLocked} onCancelReply={onCancelReply} onClearPosition={() => undefined} onSaveDraft={onSaveDraft} onSubmitComment={onSubmitComment} pending={mutationPending} />
      )}
      navigator={discussions.length ? <UnresolvedThreadNav discussions={discussions} olderNotLoaded={older.hasOlder} onSelect={openThread} /> : null}
      side={<>
        {draftError && !drafts.length ? <Alert severity="error">下書きを取得できませんでした: {draftError.message}</Alert> : null}
        {draftError && drafts.length ? <Alert severity="warning">保存済みの下書きを表示中です。更新に失敗しました: {draftError.message}</Alert> : null}
        {(!draftLoading || drafts.length) && (!draftError || drafts.length) ? <DraftList disabled={mutationDisabled} draftEditBufferKey={draftEditBufferKey} draftEditId={draftEditId} drafts={drafts} nextPage={draftNextPage} page={draftPage} publishingAll={publishingAll} statuses={draftStatuses} selected={selectedDrafts} onDelete={onDeleteDraft} onEdit={onEditDraft} onNextPage={onNextDraftPage} onOpenPosition={onOpenPosition} onPrevPage={onPrevDraftPage} onPublish={onPublishDraft} onPublishAll={onPublishAllDrafts} onPublishSelected={onPublishSelectedDrafts} onSelect={onSelectDraft} onSetEdit={onSetDraftEdit} sessionId={session?.id ?? null} /> : null}
      </>}
      threads={<>
        {discussionError && !discussions.length ? <Alert severity="error">{discussionError.message}</Alert> : null}
        {discussionError && discussions.length ? <Alert severity="warning">保存済みの議論を表示中です。更新に失敗しました: {discussionError.message}</Alert> : null}
        {loading && !discussions.length ? <LoadingPanel label="議論を読み込み中…" /> : null}
        {(!loading || discussions.length) && (!discussionError || discussions.length) ? <DiscussionList reactions={reactions} editingNoteId={editingNoteId} noteEditBufferKey={noteEditBufferKey} onEditingNoteChange={onEditingNoteChange} older={older} renderCodeContext={renderCodeContext} sessionId={session?.id ?? null} unreadNoteIds={unreadNoteIds} onMarkRead={onMarkRead} onOpenPosition={onOpenPosition} replyComposer={replyComposer} replyDiscussionId={replyDiscussion?.id} currentUserId={currentUserId} disabled={mutationDisabled} discussions={discussions} onDelete={onDeleteNote} onEdit={onEditNote} onReply={onReply} onResolve={onResolve} suggestionActions={suggestionActions} /> : null}
      </>}
    />
  )
}

interface DiscussionTabProps {
  suggestionActions?: SuggestionActions
  renderCodeContext?: (position: Position) => React.ReactNode
  reactions?: NoteReactions
  onUploadAttachment: (file: File) => Promise<string | null>
  attachmentTargetKey: string
  unreadNoteIds: string[]
  onMarkRead: (notes: Note[]) => void
  onOpenPosition: (position: Position) => void
  composerKey: string
  /** The editor of the reply being written in a thread, if any. */
  replyComposer: React.ReactNode
  currentUserId: string
  discussionError: Error | null
  older: OlderDiscussions
  discussions: Discussion[]
  draftEditBufferKey: (draft: Draft) => string
  draftEditId: string | null
  draftError: Error | null
  draftLoading: boolean
  draftNextPage: number | null
  draftPage: number
  draftStatuses: Record<string, DraftStatus>
  drafts: Draft[]
  editingNoteId: string | null
  noteEditBufferKey: (note: Note) => string
  onEditingNoteChange: (noteId: string | null) => void
  onPrevDraftPage: () => void
  publishingAll: boolean
  loading: boolean
  mutationLocked: boolean
  mutationPending: boolean
  onCancelReply: () => void
  onDeleteDraft: (draft: Draft) => Promise<boolean>
  onDeleteNote: (note: Note) => Promise<boolean>
  onEditDraft: (draft: Draft, body: string) => Promise<boolean>
  onEditNote: (note: Note, body: string) => Promise<boolean>
  onNextDraftPage: () => void
  onPublishDraft: (draft: Draft) => Promise<boolean>
  onPublishSelectedDrafts: () => Promise<void>
  onPublishAllDrafts: () => Promise<void>
  onReply: (discussion: Discussion) => void
  onResolve: (discussion: Discussion, resolved: boolean) => Promise<boolean>
  onSaveDraft: (body: string, position?: Position) => Promise<boolean>
  onSelectDraft: (id: string) => void
  onSetDraftEdit: (draftId: string | null) => void
  onSubmitComment: (body: string, thread: boolean, position?: Position) => Promise<boolean>
  replyDiscussion: Discussion | null
  selectedDrafts: string[]
}

export function BufferedReviewComposer(props: Omit<React.ComponentProps<typeof ReviewComposer>, 'onChange' | 'value'> & { bufferKey: string }) {
  const { session } = useConnection()
  const { body, change, discard, error, persistenceStatus } = useComposerBuffer(props.bufferKey, session?.id ?? null)
  const notify = useNotify()
  const discardInput = () => {
    // The text is offered back, so one click never loses it.
    const previous = discard()
    if (previous) notify({ actionLabel: '元に戻す', message: '入力を破棄しました', onAction: () => { restoreComposerBuffer(props.bufferKey, previous) } })
  }
  const [flushError, setFlushError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const persistenceLabel = persistenceStatus === 'hydrating' || persistenceStatus === 'saving'
    ? '保存中…'
    : persistenceStatus === 'saved' && body
      ? 'この端末に保存済み'
      : null
  const flushBeforeSubmit = async (submit: () => Promise<boolean>): Promise<boolean> => {
    setFlushError(null)
    setSubmitting(true)
    try {
      const flushed = await flushComposerBuffers().catch(() => false)
      if (!flushed) {
        setFlushError('入力の保存を確認できないため、投稿を停止しました。')
        return false
      }
      return await submit()
    } finally {
      setSubmitting(false)
    }
  }
  const onSubmitComment = (nextBody: string, thread: boolean, position?: Position) => flushBeforeSubmit(() => props.onSubmitComment(nextBody, thread, position))
  const onSaveDraft = (nextBody: string, position?: Position) => flushBeforeSubmit(() => props.onSaveDraft(nextBody, position))
  return <Stack spacing={0.5}><ReviewComposer {...props} disabled={props.disabled || submitting} onChange={change} onDetachedAttachment={(markdown) => { appendComposerBuffer(props.bufferKey, markdown) }} onSaveDraft={onSaveDraft} onSubmitComment={onSubmitComment} pending={props.pending || submitting} value={body} />{body ? <Button color="inherit" disabled={props.disabled || props.pending || submitting} onClick={discardInput} size="small" sx={{ alignSelf: 'flex-end', color: 'text.secondary' }}>入力を破棄</Button> : null}{persistenceLabel ? <Typography color="textSecondary" variant="caption">{persistenceLabel}</Typography> : null}{error ? <Alert severity="warning">{error}</Alert> : null}{flushError ? <Alert severity="warning">{flushError}</Alert> : null}</Stack>
}

function DraftList({ disabled, drafts, draftEditBufferKey, draftEditId, nextPage, onDelete, onEdit, onNextPage, onOpenPosition, onPrevPage, onPublish, onPublishAll, onPublishSelected, onSelect, onSetEdit, page, publishingAll, selected, sessionId, statuses }: { disabled: boolean; drafts: Draft[]; draftEditBufferKey: (draft: Draft) => string; draftEditId: string | null; nextPage: number | null; onDelete: (draft: Draft) => Promise<boolean>; onEdit: (draft: Draft, body: string) => Promise<boolean>; onNextPage: () => void; onOpenPosition: (position: Position) => void; onPrevPage: () => void; onPublish: (draft: Draft) => Promise<boolean>; onPublishAll: () => Promise<void>; onPublishSelected: () => Promise<void>; onSelect: (id: string) => void; onSetEdit: (draftId: string | null) => void; page: number; publishingAll: boolean; selected: string[]; sessionId: string | null; statuses: Record<string, DraftStatus> }) {
  const confirm = useConfirm()
  if (!drafts.length && page === 1) return null
  const selectedDrafts = drafts.filter((draft) => selected.includes(draft.id))
  const paged = nextPage !== null || page > 1
  return (
    <Paper component="section" aria-labelledby="draft-list-title" sx={{ bgcolor: 'surface.raised', p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><PublishRoundedIcon color="primary" fontSize="small" /><Typography color="textSecondary" component="h2" id="draft-list-title" variant="overline">未公開レビュー</Typography><Chip label={paged ? `このページ ${drafts.length}件` : `${drafts.length}件`} size="small" variant="outlined" /><Tooltip title="全ページの下書きを読み直し、一件ずつ公開します。途中で失敗したら残りは公開しません。"><Box component="span" sx={{ ml: 'auto' }}><Button disabled={disabled || publishingAll} onClick={() => void onPublishAll()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">{publishingAll ? '公開中…' : 'すべて公開'}</Button></Box></Tooltip></Stack>
        <List disablePadding>
          {drafts.map((draft) => {
            const status = statuses[draft.id] ?? 'idle'
            const excerpt = plainExcerpt(draft.body, 80)
            const name = `下書き「${plainExcerpt(draft.body, 20)}」`
            const editing = draftEditId === draft.id
            const place = draft.position ? `${draft.position.newPath}:${draft.position.newLine ?? draft.position.oldLine ?? 'file'}` : null
            const position = draft.position
            const secondary = status === 'unknown' ? '結果不明 · 更新して確認してください' : status === 'success' ? '公開済み' : status === 'error' ? '公開に失敗しました'
              : position && place ? <Tooltip title={place}><Button aria-label={`差分へ移動: ${place}`} disabled={disabled} onClick={() => onOpenPosition(position)} size="small" sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', fontWeight: 400, justifyContent: 'flex-start', maxWidth: '100%', minHeight: 24, minWidth: 0, px: 0.5 }}><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place} への行コメント</Box></Button></Tooltip>
                : draft.discussionId ? '既存スレッドへの返信' : '新規コメント'
            return <ListItem key={draft.id} disableGutters sx={{ alignItems: 'stretch', flexDirection: 'column' }}>
              <Stack direction="row" sx={{ alignItems: 'center', minWidth: 0 }}>
                <Checkbox checked={selected.includes(draft.id)} disabled={disabled} slotProps={{ input: { 'aria-label': `${name}を選択` } }} onChange={() => onSelect(draft.id)} size="small" />
                <ListItemText primary={<Tooltip title={draft.body}><Typography noWrap variant="body2">{excerpt || '（本文なし）'}</Typography></Tooltip>} secondary={secondary} slotProps={{ secondary: { component: 'div', noWrap: true } }} sx={{ minWidth: 0, my: 0 }} />
                <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                  <Tooltip title="下書きを編集"><span><IconButton aria-label={`${name}を編集`} disabled={disabled || editing || status === 'pending' || status === 'unknown' || status === 'success'} onClick={() => onSetEdit(draft.id)} size="small"><EditOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="下書きを公開"><span><IconButton aria-label={`${name}を公開`} disabled={disabled || status === 'pending' || status === 'unknown'} onClick={() => void onPublish(draft)} size="small"><PublishRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="下書きを削除"><span><IconButton aria-label={`${name}を削除`} disabled={disabled || status === 'pending'} onClick={() => void confirm({ cancelLabel: '残す', confirmLabel: '削除する', destructive: true, message: excerpt, title: 'この下書きを削除しますか？' }).then((ok) => { if (ok) void onDelete(draft) })} size="small"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                </Stack>
              </Stack>
              {editing ? <DraftEditor bufferKey={draftEditBufferKey(draft)} disabled={disabled} draft={draft} onClose={() => onSetEdit(null)} onSave={(body) => onEdit(draft, body)} sessionId={sessionId} /> : null}
            </ListItem>
          })}
        </List>
        {selectedDrafts.length > 0 ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">選択中 {selectedDrafts.length}件 · 公開は一件ずつ実行されます</Typography><Button disabled={disabled} onClick={() => void onPublishSelected()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">選択を公開</Button></Stack> : null}
        {paged ? <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}><Button aria-label="下書きの前のページ" disabled={page <= 1} onClick={onPrevPage} size="small">前へ</Button><Typography color="textSecondary" variant="caption">ページ {page}</Typography><Button aria-label="下書きの次のページ" disabled={nextPage === null} onClick={onNextPage} size="small">次へ</Button></Stack> : null}
      </Stack>
    </Paper>
  )
}

/**
 * Edits a pending-review comment in place. Its text is kept in the composer
 * buffer, so closing (Esc) or leaving the tab keeps it; 取消 of a changed text asks first.
 */
function DraftEditor({ bufferKey, disabled, draft, onClose, onSave, sessionId }: { bufferKey: string; disabled: boolean; draft: Draft; onClose: () => void; onSave: (body: string) => Promise<boolean>; sessionId: string | null }) {
  const { body, change, persistenceStatus } = useComposerBuffer(bufferKey, sessionId)
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const seededRef = useRef(false)
  useEffect(() => {
    // Start from the draft, or from the text kept when the edit was last closed.
    if (seededRef.current || persistenceStatus === 'hydrating') return
    seededRef.current = true
    seedComposerBuffer(bufferKey, draft.body)
  }, [bufferKey, draft.body, persistenceStatus])
  const changed = body !== draft.body
  const close = () => {
    // An unchanged copy of the draft is not worth keeping.
    if (!changed) change('')
    onClose()
  }
  const cancel = async () => {
    if (changed && !await confirm({ cancelLabel: '編集を続ける', confirmLabel: '破棄する', destructive: true, title: '下書きの編集を破棄しますか？' })) return
    change('')
    onClose()
  }
  const save = async () => {
    const trimmed = body.trim()
    if (disabled || saving || !changed || !trimmed) return
    setSaving(true)
    try {
      if (await onSave(trimmed)) {
        change('')
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }
  const handleKeyDown = (event: MarkdownEditorKeyEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return true }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return true }
    return false
  }
  return <Stack data-composer="" spacing={1} sx={{ pb: 1, pt: 0.5 }}>
    <MarkdownEditor autoFocus disabled={disabled || saving} label="下書きを編集" onChange={change} onKeyDown={handleKeyDown} value={body} />
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
      <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">Ctrl+Enter: 保存 · Esc: 閉じる（入力は保持）</Typography>
      <Button disabled={saving} onClick={() => void cancel()} size="small">取消</Button>
      <Button disabled={disabled || saving || !changed || !body.trim()} onClick={() => void save()} size="small" variant="contained">{saving ? '保存中…' : '保存'}</Button>
    </Stack>
  </Stack>
}

type DraftStatus = 'idle' | 'pending' | 'success' | 'error' | 'unknown'

/** The MR's versions, and the earlier one the changes tab compares from, if any. */
interface VersionChoice {
  compareFrom: string | null
  error: Error | null
  headSha?: string
  items: MrVersion[]
  loading: boolean
  /** GitLab has older versions than the listed ones. */
  more: boolean
  /** Null returns to the whole MR. */
  onSelect: (headCommitSha: string | null) => void
}

function ChangesTab({ compareBaseSha, local, fileSource, threadActions, pendingDrafts, lineComposer, discussions, discussionHeadSha, discussionsIncomplete, onOpenDiscussion, reviewContext, allowComments, changeNextPage, changePage, changesError, changesLoading, changesTruncated, commitNextPage, commitPage, commits, commitsError, commitsLoading, diffs, fileResult, fileView, onComment, onNextChangePage, onNextCommitPage, onPrevChangePage, onPrevCommitPage, onSelectCommit, onSelectFile, onViewChange, selectedCommit, selectedFile, selectedPosition, suggestionActions, versions }: { compareBaseSha?: string; local?: LocalChoice; fileSource?: { sessionId: string; projectId: string; sha: string }; reviewContext?: ReviewedFileContext; allowComments: boolean; changeNextPage: number | null; changePage: number; changesError: Error | null; changesLoading: boolean; changesTruncated: boolean; commitNextPage: number | null; commitPage: number; commits: Commit[]; commitsError: Error | null; commitsLoading: boolean; diffs: Diff[]; fileResult: { data: { content: string } | null; loading: boolean; error: Error | null }; fileView: 'diff' | 'file'; onComment: (position: Position) => void; onNextChangePage: () => void; onNextCommitPage: () => void; onPrevChangePage: () => void; onPrevCommitPage: () => void; onSelectCommit: (sha: string | null) => void; onSelectFile: (path: string) => void; onViewChange: (view: 'diff' | 'file') => void; selectedCommit: string | null; selectedFile: string | null; selectedPosition?: Position; discussions?: Discussion[]; discussionHeadSha?: string; discussionsIncomplete: boolean; onOpenDiscussion: (discussionId: string) => void; lineComposer?: { position: Position; node: React.ReactNode }; pendingDrafts?: Draft[]; threadActions?: ThreadActions; suggestionActions?: SuggestionActions; versions: VersionChoice }) {
  const compareFrom = versions.compareFrom
  const showingLocal = Boolean(local?.active)
  return (
    <Stack spacing={1.5}>
      {commitsError && !commits.length ? <Alert severity="error">コミットを取得できませんでした: {commitsError.message}</Alert> : null}
      {commitsError && commits.length ? <Alert severity="warning">保存済みのコミットを表示中です。更新に失敗しました: {commitsError.message}</Alert> : null}
      {!commitsError || commits.length ? <CommitTimeline baseSha={compareBaseSha} commits={commits} compareFrom={compareFrom} local={local} headSha={discussionHeadSha} loading={commitsLoading} nextPage={commitNextPage} onNextPage={onNextCommitPage} onPrevPage={onPrevCommitPage} onSelect={onSelectCommit} page={commitPage} selected={selectedCommit} versionPicker={<VersionPicker versions={versions} />} /> : null}
      {showingLocal ? local?.content : <>
      {changesTruncated ? <Alert severity="warning">GitLabがバージョン間の比較を上限で打ち切ったため、一部のファイルが表示されていません。GitLabで確認してください。</Alert> : null}
      {changesError && !diffs.length ? <Alert severity="error">差分を取得できませんでした: {changesError.message}</Alert> : null}
      {changesError && diffs.length ? <Alert severity="warning">保存済みの差分を表示中です。更新に失敗しました: {changesError.message}</Alert> : null}
      {changesLoading && !diffs.length ? <LoadingPanel label="変更を読み込み中…" /> : null}
      {!changesLoading && !changesError && compareFrom && changePage === 1 && !diffs.length ? <Typography color="textSecondary" role="status" variant="body2">このバージョンから最新までの変更はありません。</Typography> : null}
      {(!changesLoading || diffs.length) && (!changesError || diffs.length) ? <DiffViewer threadActions={threadActions} pendingDrafts={pendingDrafts} lineComposer={lineComposer} discussionHeadSha={discussionHeadSha} discussions={discussions} discussionsIncomplete={discussionsIncomplete} onOpenDiscussion={onOpenDiscussion} reviewContext={!changesLoading && !changesError ? reviewContext : undefined} key={selectedCommit ?? (compareFrom ? `version:${compareFrom}` : 'mr')} allowComments={allowComments} diffs={diffs} fileContent={fileResult.data?.content} fileLoading={fileResult.loading} fileSource={fileSource} onComment={onComment} onSelectFile={onSelectFile} onViewChange={onViewChange} selectedFile={selectedFile} selectedPosition={selectedPosition} suggestionActions={suggestionActions} view={fileView} /> : null}
      {fileResult.error ? <Alert severity="error">ファイル全体を取得できませんでした: {fileResult.error.message}</Alert> : null}
      {changeNextPage !== null || changePage > 1 ? <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}><Button aria-label="差分の前のページ" disabled={changePage <= 1} onClick={onPrevChangePage} size="small">前へ</Button><Typography color="textSecondary" variant="caption">差分のページ {changePage}</Typography><Button aria-label="差分の次のページ" disabled={changeNextPage === null} onClick={onNextChangePage} size="small">次へ</Button></Stack> : null}
      </>}
    </Stack>
  )
}

function CommitTimeline({ baseSha, commits, compareFrom, local, headSha, loading, nextPage, onNextPage, onPrevPage, onSelect, page, selected, versionPicker }: { baseSha?: string; commits: Commit[]; compareFrom: string | null; local?: LocalChoice; headSha?: string; loading: boolean; nextPage: number | null; onNextPage: () => void; onPrevPage: () => void; onSelect: (sha: string | null) => void; page: number; selected: string | null; versionPicker: React.ReactNode }) {
  const showingLocal = Boolean(local?.active)
  const wholeMergeRequest = selected === null && !compareFrom && !showingLocal
  const item = (active: boolean) => ({ bgcolor: active ? 'surface.selected' : 'transparent', border: 1, borderColor: active ? 'primary.main' : 'divider', borderRadius: 1, color: active ? 'text.primary' : 'text.secondary', flexShrink: 0, fontWeight: active ? 600 : 400, minHeight: 28, px: 1, '&:hover': { bgcolor: active ? 'surface.selected' : 'action.hover', borderColor: active ? 'primary.main' : 'surface.borderStrong' } })
  // One tab stop for the whole row (the chosen item); ←/→ Home/End move between items.
  const tabStop = selected !== null && commits.some((commit) => commit.id === selected) ? selected : null
  const moveFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-commit-item]'))
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)))
    items[next].focus()
    items[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  // Many commits stay on one line; the arrows scroll it when it is wider than the pane.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return
    const update = () => setOverflow({ left: scroller.scrollLeft > 0, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 })
    // The observer reports the first size as soon as it starts observing.
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
    scroller.addEventListener('scroll', update, { passive: true })
    return () => { observer.disconnect(); scroller.removeEventListener('scroll', update) }
  }, [])
  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    scroller?.scrollBy?.({ behavior: 'smooth', left: direction * scroller.clientWidth * 0.8 })
  }
  const scrollable = overflow.left || overflow.right
  return <Stack spacing={0.5}>
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      {page > 1 ? <Button onClick={onPrevPage} size="small" sx={{ flexShrink: 0 }}>前のコミット</Button> : null}
      {scrollable ? <Tooltip title="左へスクロール"><span><IconButton aria-label="コミットの帯を左へスクロール" disabled={!overflow.left} onClick={() => scrollBy(-1)}><ChevronLeftRoundedIcon /></IconButton></span></Tooltip> : null}
      <Box aria-label="比較対象" onKeyDown={moveFocus} ref={scrollerRef} role="toolbar" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', pb: 0.5 }}><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 'max-content' }}>
        <Button aria-pressed={wholeMergeRequest} color="inherit" data-commit-item onClick={() => onSelect(null)} sx={item(wholeMergeRequest)} tabIndex={tabStop === null ? 0 : -1}>MR全体</Button>
        {loading ? <Typography color="textSecondary" sx={{ px: 1 }} variant="caption">コミットを読み込み中…</Typography> : commits.map((commit) => <Tooltip key={commit.id} title={commit.title}><Button aria-pressed={selected === commit.id} color="inherit" data-commit-item onClick={() => onSelect(commit.id)} sx={{ ...item(selected === commit.id), justifyContent: 'flex-start', maxWidth: 260 }} tabIndex={tabStop === commit.id ? 0 : -1}><Box component="span" sx={{ color: 'primary.main', fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', flexShrink: 0, mr: 1 }}>{shortSha(commit.id)}</Box><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.title}</Box></Button></Tooltip>)}
      </Stack></Box>
      {scrollable ? <Tooltip title="右へスクロール"><span><IconButton aria-label="コミットの帯を右へスクロール" disabled={!overflow.right} onClick={() => scrollBy(1)}><ChevronRightRoundedIcon /></IconButton></span></Tooltip> : null}
      {nextPage !== null ? <Button onClick={onNextPage} size="small" sx={{ flexShrink: 0 }}>次のコミット</Button> : null}
    </Stack>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
      <Typography color="textSecondary" variant="caption">
        比較元 <Box component="span" sx={{ color: 'text.primary', fontFamily: 'code.fontFamily' }}>{showingLocal ? (headSha ? `${shortSha(headSha)}（MRの最新）` : 'MRの最新') : selected ? '親コミット' : compareFrom ? `${shortSha(compareFrom)}（過去のバージョン）` : baseSha ? shortSha(baseSha) : 'ターゲットブランチ'}</Box>
        {' → '}比較先 <Box component="span" sx={{ color: 'text.primary', fontFamily: 'code.fontFamily' }}>{showingLocal ? 'ローカルの作業ツリー' : selected ? shortSha(selected) : headSha ? shortSha(headSha) : 'MRの最新'}</Box>
      </Typography>
      {versionPicker}
      {local ? <Tooltip describeChild title="MRの最新コミットとローカルの作業ツリーの差（未pushのコミット、未コミットの変更、未追跡ファイル）を表示します。"><Button aria-pressed={showingLocal} color="inherit" onClick={local.onSelect} size="small" sx={item(showingLocal)}>ローカルの変更</Button></Tooltip> : null}
    </Stack>
    {selected ? <Typography color="textSecondary" role="note" variant="caption">コミット単位の表示では行コメントできません。MR全体で表示するとコメントできます。</Typography> : null}
    {showingLocal ? <Typography color="textSecondary" role="note" variant="caption">MRの最新からローカルの作業ツリーまでの変更です（未pushのコミット、未コミットの変更、未追跡ファイル）。この表示では行コメントできず、確認済みの記録にも含めません。</Typography> : null}
    {compareFrom && !selected ? <Typography color="textSecondary" role="note" variant="caption">選んだバージョンから最新までの変更です（GitLabのバージョン比較と同じく、その間にリベースがあればターゲットブランチ由来の変更も含まれます）。この表示では行コメントできず、確認済みの記録にも含めません。</Typography> : null}
  </Stack>
}

/** The linked local clone as a comparison target, with the view that shows it. */
interface LocalChoice {
  active: boolean
  content: React.ReactNode
  onSelect: () => void
}

/** Chooses an earlier version (push) of the MR to show the changes since. */
function VersionPicker({ versions }: { versions: VersionChoice }) {
  // The latest version is the MR head itself, so only earlier ones are offered.
  const earlier = versions.items.filter((version) => version.headCommitSha !== versions.headSha)
  // Numbered as GitLab does (oldest is 1) when every version is listed.
  const number = (index: number) => versions.more ? null : versions.items.length - versions.items.indexOf(earlier[index])
  if (versions.error && !versions.items.length) return <Typography color="error" variant="caption">バージョンを取得できませんでした: {versions.error.message}</Typography>
  return <TextField
    disabled={versions.loading || !versions.headSha || earlier.length === 0}
    onChange={(event) => versions.onSelect(event.target.value || null)}
    select
    size="small"
    slotProps={{ htmlInput: { 'aria-label': '比較元バージョン' }, select: { displayEmpty: true } }}
    sx={{ minWidth: 220, '& .MuiSelect-select': { py: 0.5 } }}
    value={versions.compareFrom ?? ''}
  >
    <MenuItem value="">{versions.loading ? 'バージョンを読み込み中…' : earlier.length === 0 ? '比較できる過去のバージョンはありません' : versions.compareFrom ? 'バージョン比較をやめる（MR全体）' : '過去のバージョンと比較…'}</MenuItem>
    {earlier.map((version, index) => {
      const at = number(index)
      return <MenuItem key={version.id} value={version.headCommitSha}>{at ? `バージョン${at} · ` : ''}{shortSha(version.headCommitSha)} · {formatVersionTime(version.createdAt)} から最新まで</MenuItem>
    })}
    {versions.more ? <MenuItem disabled value="__older">さらに古いバージョンはGitLabで確認してください</MenuItem> : null}
  </TextField>
}

function formatVersionTime(value: string): string {
  const time = Date.parse(value)
  return Number.isNaN(time) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'numeric' }).format(time)
}

function OverviewTab({ approvedBy, approvalsError, approvalsLoading, description, descriptionEdit, editDisabled, mergeRequest, onCancelEdit, onChangeEdit, onRerequestReview, onSaveEdit, onStartEdit, reactions }: { approvedBy: GitLabUser[]; approvalsError: Error | null; approvalsLoading: boolean; description: string; descriptionEdit: { body: string; expected: string } | null; editDisabled: boolean; mergeRequest: MergeRequest; onCancelEdit: () => void; onChangeEdit: (body: string) => void; onRerequestReview: (user: GitLabUser) => void; onSaveEdit: () => void; onStartEdit: () => void; reactions?: React.ReactNode }) {
  const confirm = useConfirm()
  const { session } = useConnection()
  // Label colours come from the project's first page of labels; a label not on it shows without one.
  const labelsQuery = useMemo<LabelsQuery | null>(() => mergeRequest.labels?.length ? { kind: 'labels', page: 1, projectId: mergeRequest.projectId, search: '' } : null, [mergeRequest.labels?.length, mergeRequest.projectId])
  const labelColors = useGitLabQuery<LabelsQuery>(session?.id ?? null, labelsQuery)
  const canRerequest = mergeRequest.state === 'opened' && Boolean(mergeRequest.projectPath)
  const rows: Array<[string, React.ReactNode]> = [
    ['作成者', `${mergeRequest.author.name} @${mergeRequest.author.username}`],
    ['ブランチ', <Box component="span" key="branch" sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize' }}>{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Box>],
    ['担当', mergeRequest.assignees?.length ? mergeRequest.assignees.map((user) => user.name).join('、') : 'なし'],
    ['レビュアー', mergeRequest.reviewers?.length ? <Stack component="span" key="reviewers" sx={{ alignItems: 'flex-start' }}>{mergeRequest.reviewers.map((user) => (
      <Stack component="span" direction="row" key={user.id} sx={{ alignItems: 'center', minHeight: 28 }}>
        <span>{user.name}</span>
        {canRerequest && user.id !== session?.user.id ? <Tooltip title="レビューを再依頼"><span><IconButton aria-label={`${user.name}さんにレビューを再依頼`} disabled={editDisabled} onClick={() => onRerequestReview(user)} size="small"><ReplayRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Stack>
    ))}</Stack> : 'なし'],
    ['承認', approvalsLoading ? '承認状態を確認中…' : approvalsError ? `承認状態を利用できません: ${approvalsError.message}` : approvedBy.length ? `${approvedBy.length}人が承認済み（${approvedBy.map((user) => user.name).join('、')}）` : '未承認'],
    ['ラベル', mergeRequest.labels?.length ? <Stack direction="row" key="labels" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>{mergeRequest.labels.map((label) => <LabelChip color={labelColors.data?.find((item) => item.name === label)?.color} key={label} name={label} />)}</Stack> : 'なし'],
    ['マイルストーン', mergeRequest.milestone ? `${mergeRequest.milestone.title}${mergeRequest.milestone.dueDate ? `（期限 ${mergeRequest.milestone.dueDate}）` : ''}` : 'なし'],
  ]
  return <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { lg: 'minmax(0, 1fr) 280px', xs: '1fr' }, maxWidth: 1200 }}>
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
        <Typography color="textSecondary" sx={{ flex: 1 }} variant="overline">説明</Typography>
        {descriptionEdit ? null : <Button disabled={editDisabled} onClick={onStartEdit} size="small" startIcon={<EditOutlinedIcon />}>説明を編集</Button>}
      </Stack>
      {descriptionEdit ? <Stack spacing={1}>
        <MarkdownEditor autoFocus disabled={editDisabled} label="説明を編集" onChange={onChangeEdit} value={descriptionEdit.body} />
        {descriptionEdit.expected !== (description ?? '') ? <Alert severity="warning">編集中にGitLabの説明が更新されました。保存すると拒否されるので、内容を控えてから取消して開き直してください。</Alert> : null}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => void (async () => { if (descriptionEdit.body === descriptionEdit.expected || await confirm({ cancelLabel: '編集を続ける', confirmLabel: '破棄する', destructive: true, title: '編集中の説明を破棄しますか？' })) onCancelEdit() })()}>取消</Button>
          <Button disabled={editDisabled || descriptionEdit.body === descriptionEdit.expected} onClick={onSaveEdit} variant="contained">保存</Button>
        </Stack>
      </Stack> : <MockMarkdown body={description || '説明はありません。'} />}
      {reactions ? <Box sx={{ mt: 1.5 }}>{reactions}</Box> : null}
    </Box>
    <Box component="dl" sx={{ alignContent: 'start', display: 'grid', gap: 1.5, m: 0 }}>
      {rows.map(([label, value]) => <Box key={label}><Typography color="textSecondary" component="dt" variant="caption">{label}</Typography><Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }} variant="body2">{value}</Typography></Box>)}
    </Box>
  </Box>
}

function LoadingPanel({ label }: { label: string }) { return <Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, py: 2 }} variant="body2">{label}</Typography> }

function normalizePosition(position: Position, mergeRequest: MergeRequest): Position {
  return { ...position, baseSha: mergeRequest.diffRefs?.baseSha ?? position.baseSha, headSha: mergeRequest.diffRefs?.headSha ?? position.headSha, startSha: mergeRequest.diffRefs?.startSha ?? position.startSha }
}

function isPositionCurrent(position: Position, mergeRequest: MergeRequest): boolean {
  const currentHead = mergeRequest.diffRefs?.headSha ?? mergeRequest.headSha
  return Boolean(currentHead && position.headSha && currentHead === position.headSha)
}

/** The oldest comment shown: the lowest GitLab note ID, or the earliest one when IDs are not numeric (fixtures). */
function oldestNoteId(notes: Note[]): string | null {
  if (!notes.length) return null
  if (notes.every((note) => /^\d+$/u.test(note.id))) return notes.reduce((oldest, note) => Number(note.id) < Number(oldest) ? note.id : oldest, notes[0].id)
  return [...notes].sort(compareNotesByTime)[0].id
}

function formatFetchedAt(timestamp?: number): string { if (!timestamp) return '時刻不明'; return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp) }
function compareNotesByTime(left: Note, right: Note): number {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  return (Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime) - (Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime) || left.id.localeCompare(right.id)
}

/** Names the write whose result is unknown, for the notice that stops resending. */
function actionLabel(action: GitLabAction | null): string {
  switch (action?.kind) {
    case 'comment': return 'コメントの投稿'
    case 'reply': return '返信の投稿'
    case 'editNote': return 'コメントの編集'
    case 'deleteNote': return 'コメントの削除'
    case 'resolve': return 'スレッドの解決状態の変更'
    case 'saveDraft': return 'レビューへの追加'
    case 'editDraft': return '下書きの編集'
    case 'deleteDraft': return '下書きの削除'
    case 'publishDraft': return '下書きの公開'
    case 'approve': return '承認'
    case 'unapprove': return '承認の取り消し'
    case 'setAssignees': return '担当者の変更'
    case 'setReviewers': return 'レビュアーの変更'
    case 'setDescription': return '説明の編集'
    case 'merge': return action.autoMerge ? '自動マージの設定' : 'マージ'
    case 'cancelAutoMerge': return '自動マージの取り消し'
    case 'rebase': return 'リベース'
    case 'setState': return action.stateEvent === 'close' ? 'MRのクローズ' : 'MRの再オープン'
    case 'setTitle': return 'タイトルの変更'
    case 'setLabels': return 'ラベルの変更'
    case 'setMilestone': return 'マイルストーンの変更'
    case 'requestChanges': return '変更の要求'
    case 'rerequestReview': return 'レビューの再依頼'
    case 'uploadAttachment': return '添付ファイルのアップロード'
    case 'addAward': return 'リアクションの追加'
    case 'removeAward': return 'リアクションの取り消し'
    case 'markTodoDone': return '通知の既読'
    case 'retryJob': return 'ジョブの再実行'
    case 'cancelJob': return 'ジョブのキャンセル'
    case 'playJob': return '手動ジョブの実行'
    case 'retryPipeline': return 'パイプラインの再実行'
    case 'cancelPipeline': return 'パイプラインのキャンセル'
    case 'applySuggestions': return '提案の適用'
    default: return '直前の操作'
  }
}

/** Threads placed by line (`n:12`, `o:4`), in the order of their line numbers. */
function sortByLine(byLine: Map<string, Discussion[]>): Discussion[] {
  return [...byLine.entries()].sort(([left], [right]) => Number(left.slice(2)) - Number(right.slice(2))).flatMap(([, threads]) => threads)
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}
