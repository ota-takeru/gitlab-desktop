import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined'
import ThumbUpRoundedIcon from '@mui/icons-material/ThumbUpRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { memo, useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmScope, type ConfirmOptions } from '../../components/Feedback'
import { hairline } from '../../components/hairline'
import { useConfirm, useNotify } from '../../components/feedbackContext'
import { KeepAlive } from '../../components/KeepAlive'
import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { GitLabUserLink } from '../../components/GitLabUserLink'
import { MergeRequestStateGlyph } from '../../components/MergeRequestStateIcon'
import { PipelineStatus } from '../../components/PipelineStatus'
import { ReactionBar } from '../../components/ReactionBar'
import { applyOwnReaction } from '../../lib/awardEmoji'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon } from '../../components/StateIcon'
import { StatusPill } from '../../components/StatusPill'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { formatFetchedAt, formatMergeRequestState, mergeRequestStateTone, shortSha } from '../../lib/format'
import { uploadGitLabAttachment } from '../../lib/attachments'
import { createRequestId, normalizeGitLabError, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import { projectUrlOf } from '../../lib/markdownLinks'
import type { Approvals, AwardEmoji, Commit, DiffsQuery, Diff, Discussion, Draft, FileQuery, GitLabUser, GitLabAction, GitLabQuery, GitLabSnapshot, ApprovalsQuery, CommitDiffQuery, MergeRequest, MergeRequestQuery, MrAwardsQuery, MrVersion, MrVersionsQuery, Note, NoteAwardsQuery, Position, ReviewResourceQuery, VersionCompareQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { usePersonalWorkspace } from '../shared/personalWorkspace'
import { notifyWorkspace } from '../../lib/notifications'
import { useDiscussionWindow } from './useDiscussionWindow'
import { formatNames } from './mergeActions'
import { findScrollContainer, positionAtLatest } from './discussionScroll'
import { useAutoUpdateSafety } from '../shared/autoUpdateSafetyContext'
import { useGitLabMutation } from '../shared/useGitLabMutation'
import { applyConfirmedGitLabChange, useGitLabQuery } from '../shared/useGitLabQuery'
import { readLoadedDiffPages, useDiscussionCode } from './useDiscussionCode'
import { DiscussionList, type NoteReactions, type OlderDiscussions } from './DiscussionList'
import { commentScrollPositions } from './composerBuffers'
import { diffFileOrder } from './diffFileOrder'
import { LocalChanges, LocalStatusBadge } from './LocalChanges'
import { DiscussionLayout } from './DiscussionLayout'
import { lineKey, threadsByLine } from './diffLineThreads'
import { isUnresolvedDiscussion } from './discussionStatus'
import { UnresolvedThreadNav, UnresolvedThreadStepper } from './UnresolvedThreadNav'
import { plainExcerpt } from './discussionText'
import { MergeRequestPeopleDialog } from './MergeRequestPeopleDialog'
import { PipelinesTab } from './PipelinesTab'
import { MergeRequestActions, MergeStatusText } from './MergeRequestActions'
import { ReviewComposer } from './ReviewComposer'
import type { SuggestionActions } from './SuggestionBlock'
import { suggestionSourceLines } from './suggestions'
import { MarkNotificationReadButton } from './NotificationPanel'
import { useLoadedMergeRequestNotifications } from './todoCache'
import { appendComposerBuffer, clearComposerBuffer, createComposerBackendKey, createComposerBufferKey, moveComposerBuffer, rememberComposerTarget, restoreComposerBuffer, useComposerBuffer, flushComposerBuffers } from './useComposerBuffer'
import { ChangesTab } from './MergeRequestChangesTab'
import { DraftList, type DraftStatus } from './DraftList'
import { LoadingPanel } from './LoadingPanel'
import { DescriptionPanel, OverviewTab } from './MergeRequestOverviewTab'
import { Bar, Row } from '../../components/Row'

export type ReviewTab = 'discussion' | 'changes' | 'overview' | 'pipelines'
type CommitsQuery = ReviewResourceQuery & { kind: 'commits' }
type DraftsQuery = ReviewResourceQuery & { kind: 'drafts' }
/** 「すべて公開」 reads at most this many pages of drafts before publishing. */
const MAX_DRAFT_PAGES = 50


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
  /** A comment a link named, shown on the discussion tab once its threads have loaded. */
  focusNote?: { noteId: string } | null
  /** The named comment was shown, or is not among the comments. */
  onNoteFocused?: () => void
}

export function MergeRequestDetail({ backLabel = translate('mergeRequest.detail.back'), focusNote, initialMergeRequest, onBack, onNoteFocused, onOpenProject, onTabChange, tab }: MergeRequestDetailProps) {
  const t = useT()
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const sectionRef = useRef<HTMLElement | null>(null)
  const headerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    // Sticky content below the sticky header starts at its current height, set before the first paint.
    const header = headerRef.current
    const section = sectionRef.current
    if (!header || !section) return
    const update = () => section.style.setProperty('--detail-header-height', `${header.offsetHeight}px`)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  const queryClient = useQueryClient()
  const [localTab, setLocalTab] = useState<ReviewTab>('overview')
  const activeTab = tab ?? localTab
  const setActiveTab = (next: ReviewTab) => { if (onTabChange) onTabChange(next); else setLocalTab(next) }
  // A thread opened from the diff, shown once the discussion tab has settled.
  const pendingThread = useRef<string | null>(null)
  // The diff line button that opened the line comment editor.
  const lineOpenerRef = useRef<HTMLElement | null>(null)
  // A diff thread in another file reached with N / P, focused once its file is shown.
  const pendingDiffThread = useRef<{ id: string; path: string } | null>(null)
  const [descriptionEdit, setDescriptionEdit] = useState<{ body: string; expected: string } | null>(null)
  const [replyDiscussion, setReplyDiscussion] = useState<Discussion | null>(null)
  // The description shown beside the discussion (D); leaving the discussion closes it.
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const closeDescription = useCallback(() => setDescriptionOpen(false), [])
  // Any tab change, including Back, closes the reply; its text stays in the composer buffer.
  const [replyTab, setReplyTab] = useState(activeTab)
  if (replyTab !== activeTab) { setReplyTab(activeTab); setReplyDiscussion(null); setDescriptionOpen(false) }
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
  const [fileView, setFileView] = useState<'diff' | 'file' | null>(null)
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
  // Set when a dialog that already carried the outside-MR warning was accepted, so the write it leads to is not asked again.
  const outsideAcknowledged = useRef(false)
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
    if (!await confirmOutsideWrite()) return null
    const flushed = await flushComposerBuffers().catch(() => false)
    if (!flushed) throw normalizeGitLabError({ code: 'STORAGE', message: t('mergeRequest.detail.attachmentStopped') })
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
  const resolvedFileView = fileView ?? 'diff'
  const fileSha = selectedCommit ?? mergeRequest?.headSha
  const beforeFileSha = selectedCommit
    ? commits.find((commit) => commit.id === selectedCommit)?.parentIds?.[0]
    : comparing ? compareVersion ?? undefined : mergeRequest?.diffRefs?.baseSha
  const fileQuery = useMemo<FileQuery | null>(() => activeTab === 'changes' && resolvedFileView === 'file' && selectedDiff && fileSha ? ({ kind: 'file', path: selectedDiff.newPath || selectedDiff.oldPath, projectId: resourceId, sha: fileSha }) : null, [activeTab, fileSha, resolvedFileView, resourceId, selectedDiff])
  const fileResult = useGitLabQuery<FileQuery>(session?.id ?? null, fileQuery)
  const previousCommentIds = useRef<{ sessionId: string; notes: Map<string, string> } | null>(null)
  const commentNotes = useMemo(() => discussions.flatMap((discussion) => discussion.notes).filter((note) => !note.system), [discussions])
  const mentionParticipants = useMemo(() => mergeRequestParticipants(mergeRequest, commentNotes, session?.user.id), [commentNotes, mergeRequest, session?.user.id])
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
  // These record what is shown when the MR, the account or what is known of the MR changes, reading the latest workspace.
  const recordRecent = useEffectEvent(() => { if (session && mergeRequest) workspace.recordRecent({ projectId: resourceId, iid }) })
  const mergeRequestLoaded = Boolean(mergeRequest)
  useEffect(() => { recordRecent() }, [session?.id, resourceId, iid, mergeRequestLoaded])
  // The sidebar tab shows the title and state as last seen here.
  const tabMeta = mergeRequest ? { projectPath: mergeRequest.projectPath ?? '', state: mergeRequest.state, title: mergeRequest.title } : null
  const rememberTab = useEffectEvent(() => { if (session && tabMeta) workspace.rememberTab({ projectId: resourceId, iid }, tabMeta) })
  useEffect(() => { rememberTab() }, [session?.id, resourceId, iid, tabMeta?.title, tabMeta?.state, tabMeta?.projectPath])
  // The close confirmation names this MR if it holds unsent input.
  const rememberTarget = useEffectEvent(() => { if (tabMeta) rememberComposerTarget(session, resourceId, iid, { projectPath: tabMeta.projectPath, title: tabMeta.title }) })
  useEffect(() => { rememberTarget() }, [session, resourceId, iid, tabMeta?.title, tabMeta?.projectPath])
  useEffect(() => {
    if (!session || accessDenied) return
    workspace.observe({ projectId: resourceId, iid }, commentNotes, discussionWindow.ready && !discussionWindow.error)
  }, [commentNotes, session, accessDenied, workspace, resourceId, iid, discussionWindow.ready, discussionWindow.error])
  // Pushes, approvals and state changes are on the MR's page, so they are read while it is shown.
  useEffect(() => {
    if (!session || accessDenied || !mergeRequest?.updatedAt) return
    workspace.markActivityRead({ projectId: resourceId, iid }, mergeRequest.updatedAt)
  }, [session, accessDenied, workspace, resourceId, iid, mergeRequest?.updatedAt])
  const latestDiscussions = discussionWindow.latest
  useEffect(() => {
    if (!session || !latestDiscussions?.data || latestDiscussions.source !== 'network' || discussionWindow.error) return
    const currentNotes = latestDiscussions.data.flatMap((discussion) => discussion.notes).filter((note) => !note.system && note.author.id !== session.user.id)
    const previous = previousCommentIds.current
    if (previous?.sessionId === session.id && workspace.settings.notifyComments) {
      const added = currentNotes.filter((note) => previous.notes.has(note.id) && previous.notes.get(note.id) !== (note.updatedAt || note.createdAt) || !previous.notes.has(note.id) && Date.parse(note.createdAt) > Math.max(0, ...Array.from(previous.notes.values(), (date) => Date.parse(date))))
      if (added.length) void notifyWorkspace(t('mergeRequest.detail.newComments', { count: added.length })).catch(() => undefined)
    }
    previousCommentIds.current = { sessionId: session.id, notes: new Map([...(previous?.sessionId === session.id ? previous.notes : []), ...currentNotes.map((note) => [note.id, note.updatedAt || note.createdAt] as const)]) }
  }, [discussionWindow.error, latestDiscussions, session, t, workspace.settings.notifyComments])
  // The other tabs keep their own scroll, from the top at first: the page's one scroll would
  // otherwise open a tab where the previous one was read and move its content as it loads.
  // A place is kept with the header's height then and restored for its height now: the header
  // shrinks once scrolled and the browser moves scrollTop to keep the content still, so a bare
  // scrollTop shown under the full header would land the reader higher on every return.
  const scrollPlace = useCallback((host: HTMLElement) => ({ header: headerRef.current?.offsetHeight ?? 0, top: host.scrollTop }), [])
  const restoreScrollPlace = useCallback((host: HTMLElement, place: { header: number; top: number }) => { host.scrollTop = place.top + (headerRef.current?.offsetHeight ?? 0) - place.header }, [])
  const tabScrollPositions = useRef(new Map<ReviewTab, { header: number; top: number }>())
  useLayoutEffect(() => {
    const host = sectionRef.current?.closest('main')
    if (!host) return
    if (activeTab !== 'discussion') restoreScrollPlace(host, tabScrollPositions.current.get(activeTab) ?? { header: 0, top: 0 })
    const remember = () => { tabScrollPositions.current.set(activeTab, scrollPlace(host)) }
    host.addEventListener('scroll', remember, { passive: true })
    return () => host.removeEventListener('scroll', remember)
  }, [activeTab, restoreScrollPlace, scrollPlace])
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
  // The place is set once the discussion settles; later unread changes must not move it.
  const sessionId = session?.id
  const scrollKey = useEffectEvent(() => `${scrollPositionScope}:${sessionId}:${resourceId}:${iid}`)
  const placeAtLatest = useEffectEvent((host: HTMLElement, section: HTMLElement) => positionAtLatest(host, section, earliestUnreadNoteId, latestNoteId))
  useLayoutEffect(() => {
    const host = sectionRef.current?.closest('main')
    if (!host || !sessionId || !discussionViewSettled || !sectionRef.current) return
    const key = scrollKey()
    const saved = commentScrollPositions.get(key)
    if (saved !== undefined) restoreScrollPlace(host, saved)
    else placeAtLatest(host, sectionRef.current)
    const remember = () => { commentScrollPositions.set(key, scrollPlace(host)); if (commentScrollPositions.size > 100) commentScrollPositions.delete(commentScrollPositions.keys().next().value!) }
    remember()
    host.addEventListener('scroll', remember, { passive: true })
    // Nothing is recorded on leaving: by then the tab is hidden, and the page's scroll fits another tab (or none).
    return () => host.removeEventListener('scroll', remember)
  }, [discussionViewSettled, iid, resourceId, restoreScrollPlace, scrollPlace, sessionId])
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
      else { setPendingFileTarget(null); setViewPosition(undefined); setPositionError(t('mergeRequest.position.fileNotFound')) }
    }, 0)
    return () => globalThis.clearTimeout(timer)
  }, [activeTab, diffsResult.data, diffsResult.loading, diffsResult.refreshing, diffsResult.snapshot?.nextPage, pendingFileTarget, t])

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
      notify({ message: inDiff ? t('mergeRequest.detail.noUnresolvedInDiff') : t('mergeRequest.detail.noUnresolvedInDiscussion') })
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
      if (isEditableTarget(event.target) || isInsideMenu(event.target) || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      stepUnresolvedRef.current(event.key === 'n' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab])
  useEffect(() => {
    if (activeTab !== 'discussion') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key !== 'd') return
      if (isEditableTarget(event.target) || isInsideMenu(event.target) || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      setDescriptionOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab])

  // Writes to an MR you neither wrote, are assigned to nor review are asked once more, so a wrong MR is not changed by mistake.
  const outsider = Boolean(session && mergeRequest && !isInvolved(mergeRequest, session.user.id))
  const withOutsideNote = useCallback((options: ConfirmOptions): ConfirmOptions => outsider
    ? { ...options, message: <><Box component="span" sx={{ color: 'warning.main', display: 'block', mb: options.message ? 1 : 0 }}>{t('mergeRequest.outsider.note')}</Box>{options.message}</> }
    : options, [outsider, t])
  // Stable: it is the confirm of the ConfirmScope around the memoized header actions.
  const confirmWithOutsideNote = useCallback(async (options: ConfirmOptions) => {
    const ok = await confirm(withOutsideNote(options))
    outsideAcknowledged.current = ok && outsider
    return ok
  }, [confirm, outsider, withOutsideNote])
  const copyHeadSha = useCallback(async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha)
      notify({ message: t('mergeRequest.detail.headShaCopied'), severity: 'success' })
    } catch {
      notify({ message: t('mergeRequest.detail.headShaCopyFailed'), severity: 'error' })
    }
  }, [notify, t])

  const confirmOutsideWrite = useCallback(async () => {
    if (!outsider) return true
    if (outsideAcknowledged.current) {
      outsideAcknowledged.current = false
      return true
    }
    return confirm({ confirmLabel: t('mergeRequest.outsider.confirm'), message: t('mergeRequest.outsider.message'), title: t('mergeRequest.outsider.title') })
  }, [confirm, outsider, t])

  const runMutation = mutation.run
  // A refresh that resolves (the newest discussions page) is waited for, so what was written shows before the action ends.
  const runAction = useCallback(async (action: GitLabAction, refresh?: () => void | Promise<void>, localDraftKey?: string) => {
    if (!await confirmOutsideWrite()) return false
    const success = await runMutation(action, localDraftKey)
    if (success) await refresh?.()
    return success
  }, [confirmOutsideWrite, runMutation])
  // Stable, so the memoized header actions render only when the MR or the lock changes.
  const refreshCurrent = currentResult.refresh
  const runHeaderAction = useCallback((action: GitLabAction) => runAction(action, refreshCurrent), [refreshCurrent, runAction])

  if (!mergeRequest) {
    return <Stack spacing={1.5} sx={{ px: 2, py: 2 }}>{onBack ? <Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />} sx={{ alignSelf: 'flex-start' }}>{backLabel}</Button> : null}<Alert severity="error">{t('mergeRequest.detail.accessDenied')}</Alert></Stack>
  }


  const commentPosition = position
  const openCommentPosition = (target: Position) => {
    setViewPosition(isPositionCurrent(target, mergeRequest) ? target : undefined)
    setPositionError(isPositionCurrent(target, mergeRequest) ? null : t('mergeRequest.position.outdatedComment'))
    setSelectedCommit(null); setCompareVersion(null); setFileView('diff'); setChangePage(1)
    setSelectedFile(target.newPath || target.oldPath)
    setPendingFileTarget(target.newPath || target.oldPath)
    setActiveTab('changes')
  }
  const submitComment = async (body: string, thread: boolean, targetPosition?: Position) => {
    if (targetPosition && !isPositionCurrent(targetPosition, mergeRequest)) {
      setPositionError(t('mergeRequest.position.headChanged'))
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
      setPositionError(t('mergeRequest.position.headChanged'))
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
  const renderNoteReactions = (note: Note) => <ReactionBar awards={awardsByNote.get(note.id) ?? []} currentUserId={session?.user.id ?? ''} disabled={reactionsDisabled} label={t('mergeRequest.reactions.noteLabel', { name: note.author.name })} onToggle={(name, add) => toggleReaction(name, add, note.id)} />
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
    if (!await confirm(withOutsideNote({ confirmLabel: t('mergeRequest.drafts.publishConfirm'), message: plainExcerpt(draft.body, 120), title: t('mergeRequest.drafts.publishTitle') }))) return false
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
    if (!selectedDrafts.length || !await confirm(withOutsideNote({ confirmLabel: t('mergeRequest.drafts.publishCount', { count: selectedDrafts.length }), message: t('mergeRequest.drafts.publishManyMessage'), title: t('mergeRequest.drafts.publishSelectedTitle', { count: selectedDrafts.length }) }))) return
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
      if (count >= MAX_DRAFT_PAGES) throw new Error(t('mergeRequest.drafts.tooMany'))
      const snapshot: GitLabSnapshot<Draft[]> | null = await queryGitLab<DraftsQuery>({ mode: 'network', query: { iid, kind: 'drafts', page, projectId: resourceId } as DraftsQuery, requestId: createRequestId('drafts-all'), sessionId: session.id })
      if (!snapshot) throw new Error(t('mergeRequest.drafts.fetchFailed'))
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
        notify({ message: t('mergeRequest.drafts.fetchFailedWithError', { error: normalizeGitLabError(caught).message }), severity: 'error' })
        return
      }
      if (!all.length) { draftsResult.refresh(); return }
      if (!await confirm(withOutsideNote({ confirmLabel: t('mergeRequest.drafts.publishCount', { count: all.length }), message: t('mergeRequest.drafts.publishManyMessage'), title: t('mergeRequest.drafts.publishAllTitle', { count: all.length }) }))) return
      let published = 0
      for (const draft of all) {
        if (!await publishDraftId(draft.id, draft.discussionId)) break
        published += 1
      }
      if (published === all.length) notify({ celebrate: true, message: t('mergeRequest.drafts.published', { count: published }), severity: 'success' })
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
      notify({ message: t('mergeRequest.detail.openFailed', { error: normalizeGitLabError(caught).message }), severity: 'error' })
    }
  }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(mergeRequest.webUrl)
      notify({ message: t('mergeRequest.detail.linkCopied'), severity: 'success' })
    } catch {
      notify({ message: t('mergeRequest.detail.linkCopyFailed'), severity: 'error' })
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
        if (!await confirm({ cancelLabel: t('mergeRequest.unknownWrite.attachmentNotChecked'), confirmLabel: t('mergeRequest.unknownWrite.attachmentChecked'), message: t('mergeRequest.unknownWrite.attachmentMessage'), title: t('mergeRequest.unknownWrite.attachmentTitle') })) {
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
        throw new Error(t('mergeRequest.unknownWrite.refetchFailed'))
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
  const approvedBy = approvals && Array.isArray(approvals.approvedBy) ? approvals.approvedBy : noUsers
  const myApproved = approvedBy.some((user) => user.id === session?.user.id)
  const approvalDisabled = mutation.isLocked || mutation.isPending || Boolean(approvalWriting) || !mergeRequest.headSha || approvalsResult.loading || !approvals || Boolean(approvalsResult.error)
  const peopleDisabled = mutation.isLocked || mutation.isPending
  const missingReviewers = Boolean(mergeRequest && !mergeRequest.reviewers?.length)
  const setReviewers = missingReviewers ? () => setPeopleEditor('reviewers') : undefined
  const addReviewers = missingReviewers ? (users: GitLabUser[]) => { void setPeople('reviewers', users) } : undefined
  const setPeople = (field: 'assignees' | 'reviewers', users: GitLabUser[]) => runAction({
    expectedUserIds: (mergeRequest[field] ?? []).map((user) => user.id),
    iid,
    kind: field === 'assignees' ? 'setAssignees' : 'setReviewers',
    projectId: resourceId,
    userIds: users.map((user) => user.id),
  }, currentResult.refresh)
  const rerequestReview = async (user: GitLabUser) => {
    const projectPath = mergeRequest.projectPath
    if (!projectPath || !await confirmWithOutsideNote({ confirmLabel: t('mergeRequest.rerequest.confirm'), message: t('mergeRequest.rerequest.message', { name: user.name }), title: t('mergeRequest.rerequest.title', { name: user.name }) })) return
    if (await runAction({ iid, kind: 'rerequestReview', projectId: resourceId, projectPath, userId: user.id }, currentResult.refresh)) notify({ message: t('mergeRequest.rerequest.done', { name: user.name }), severity: 'success' })
  }
  // The button stays busy until the approvals are read back, so a second click cannot approve twice.
  const toggleApproval = async () => {
    if (!mergeRequest.headSha || approvalWriting) return false
    const confirmed = await confirm(withOutsideNote(myApproved
      ? { confirmLabel: t('mergeRequest.approval.revokeConfirm'), destructive: true, message: t('mergeRequest.approval.revokeMessage'), title: t('mergeRequest.approval.revokeTitle', { iid: mergeRequest.iid }) }
      : { confirmLabel: t('mergeRequest.approval.approve'), message: t('mergeRequest.approval.approveMessage', { sha: shortSha(mergeRequest.headSha) }), title: t('mergeRequest.approval.approveTitle', { iid: mergeRequest.iid }) }))
    if (!confirmed) return false
    const kind = myApproved ? 'unapprove' : 'approve'
    setApprovalWriting(kind)
    try {
      const success = await mutation.run({ iid, kind, projectId: resourceId, ...(myApproved ? {} : { sha: mergeRequest.headSha }) } as GitLabAction)
      if (success) {
        // List pages group by approval; let them pick up the change.
        void queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[2] === 'string' && query.queryKey[2].includes('"kind":"mrApprovals"') })
        if (approvalsQuery) await refetchQuery(approvalsQuery)
        if (kind === 'approve') notify({ celebrate: true, message: t('mergeRequest.approval.approved', { iid: mergeRequest.iid }), severity: 'success' })
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
      mentionParticipants={mentionParticipants}
      templateProjectPath={projectPath ?? undefined}
      onCancelReply={() => setReplyDiscussion(null)}
      onClearPosition={() => undefined}
      onSaveDraft={(body) => saveReplyDraft(replyDiscussion, body)}
      onAddReviewers={addReviewers}
      onSetReviewers={setReviewers}
      onSubmitComment={(body) => submitReply(replyDiscussion, body)}
      pending={mutation.isPending}
      replyAuthor={replyDiscussion.notes.find((note) => !note.system)?.author.name}
      replyDiscussionId={replyDiscussion.id}
    />
  ) : null
  const closeLineComposer = () => {
    const opener = lineOpenerRef.current
    lineOpenerRef.current = null
    setPosition(undefined)
    // Focus left with the closed editor goes back to the line button that opened it, without scrolling to it.
    requestAnimationFrame(() => { if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true }) })
  }
  const lineComposerKey = commentPosition ? createComposerBufferKey(session, resourceId, iid, 'new', commentPosition) : null
  const lineComposer = commentPosition && lineComposerKey && !readOnlyChanges ? {
    position: commentPosition,
    node: <BufferedReviewComposer attachmentTargetKey={`${attachmentScope}:${lineComposerKey}`} bufferKey={lineComposerKey} disabled={mutation.isLocked} enableMentions={Boolean(session)} inlineTarget key={lineComposerKey} mentionParticipants={mentionParticipants} templateProjectPath={projectPath ?? undefined} onCancelReply={() => undefined} onClearPosition={closeLineComposer} onAddReviewers={addReviewers} onSaveDraft={saveDraft} onSetReviewers={setReviewers} onSubmitComment={submitComment} onUploadAttachment={uploadAttachment} pending={mutation.isPending} suggestionLines={commentPosition.newLine === undefined ? null : () => suggestionSourceLines(diffs, commentPosition)} targetPosition={commentPosition} />,
  } : undefined
  const commentOnLines = (nextPosition: Position) => {
    const next = normalizePosition(nextPosition, mergeRequest)
    // Choosing more lines can move the comment's last line; what was written moves with it.
    const nextKey = createComposerBufferKey(session, resourceId, iid, 'new', next)
    if (lineComposerKey && commentPosition && next.lineRange && nextKey !== lineComposerKey && commentPosition.newPath === next.newPath) moveComposerBuffer(lineComposerKey, nextKey)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-line-action]') : null
    lineOpenerRef.current = opener
    // The editor opens under the line; the tab stays on the changes.
    setViewPosition(undefined)
    setPosition(next)
    setPositionError(null)
  }
  const saveDescription = async () => {
    if (!descriptionEdit) return
    const { body } = descriptionEdit
    const success = await runAction({ description: body, expectedDescription: descriptionEdit.expected, iid, kind: 'setDescription', projectId: resourceId }, () => {
      // The closed editor shows the saved text at once instead of the old one until GitLab is read again.
      if (session) applyConfirmedGitLabChange(queryClient, session.id, currentQuery, (current) => ({ ...current, description: body }))
      currentResult.refresh()
    })
    if (success) setDescriptionEdit(null)
  }

  return (
    <MarkdownLinkProvider projectUrl={projectUrlOf(mergeRequest.webUrl)} sessionId={session?.id}>
    <Box component="section" ref={sectionRef} sx={{ minHeight: '100%', width: '100%' }}>
      <Box component="header" data-sticky-header="true" ref={headerRef} sx={{ bgcolor: 'background.default', ...hairline('bottom', { position: false }), position: 'sticky', px: 2, pt: 1.5, top: 0, zIndex: 2 }}>
        <Bar spacing={0.5} sx={{ minHeight: 32 }}>
          {onBack ? <Tooltip title={`${backLabel} (Esc)`}><IconButton aria-label={backLabel} onClick={onBack}><ArrowBackRoundedIcon /></IconButton></Tooltip> : null}
          <Row spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Tooltip title={mergeRequest.projectPath || t('mergeRequest.common.projectFallback', { id: mergeRequest.projectId })}><Button color="inherit" onClick={onOpenProject} sx={{ color: 'text.secondary', fontWeight: 400, minHeight: 24, minWidth: 0, px: 1 }}><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mergeRequest.projectPath || t('mergeRequest.common.projectFallback', { id: mergeRequest.projectId })}</Box></Button></Tooltip>
            <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="body2">!{mergeRequest.iid}</Typography>
            {currentResult.stale ? <Tooltip title={t('mergeRequest.detail.staleTooltip')}><Typography color="textSecondary" noWrap sx={{ flexShrink: 0, pl: 0.5 }} variant="caption">{t('mergeRequest.common.savedAt', { time: formatFetchedAt(currentResult.snapshot?.fetchedAt) })}</Typography></Tooltip> : null}
          </Row>
          <Tooltip title={pinnedNow ? t('mergeRequest.common.unpin') : t('mergeRequest.common.pin')}><IconButton aria-label={pinnedNow ? t('mergeRequest.common.unpin') : t('mergeRequest.common.pin')} color={pinnedNow ? 'primary' : 'default'} onClick={() => workspace.togglePinned({ projectId: resourceId, iid }, tabMeta ?? undefined)}>{pinnedNow ? <PushPinIcon /> : <PushPinOutlinedIcon />}</IconButton></Tooltip>
          <Tooltip title={refreshing ? t('mergeRequest.common.refreshing') : t('mergeRequest.detail.refreshTooltip')}><span><IconButton aria-label={t('mergeRequest.detail.refresh')} disabled={refreshing} onClick={refreshAll}><RefreshRoundedIcon /></IconButton></span></Tooltip>
          <Tooltip title={t('mergeRequest.common.openInGitLab')}><IconButton aria-label={t('mergeRequest.common.openInGitLab')} onClick={() => void openInGitLab()}><LaunchRoundedIcon /></IconButton></Tooltip>
          <Tooltip title={t('mergeRequest.detail.copyLink')}><IconButton aria-label={t('mergeRequest.detail.copyLink')} onClick={() => void copyLink()}><LinkRoundedIcon /></IconButton></Tooltip>
          {session && mergeRequestNotifications[0] ? <Tooltip title={mergeRequestNotifications.length > 1 ? t('mergeRequest.detail.markOneRead', { count: mergeRequestNotifications.length }) : t('mergeRequest.detail.markRead')}><Box component="span" sx={{ pl: 1 }}><MarkNotificationReadButton sessionId={session.id} todo={mergeRequestNotifications[0]} /></Box></Tooltip> : null}
          <Box sx={{ pl: 1 }}>
            {approvalsResult.error && !approvalWriting ? <Tooltip title={t('mergeRequest.approval.loadFailed', { error: approvalsResult.error.message })}><span><Button disabled={retryingApprovals} onClick={() => void retryApprovals()} startIcon={<RefreshRoundedIcon />} variant="outlined">{retryingApprovals ? t('mergeRequest.approval.retrying') : t('mergeRequest.approval.retry')}</Button></span></Tooltip>
              : <Button disabled={approvalDisabled} onClick={() => void toggleApproval()} startIcon={myApproved ? <UndoRoundedIcon /> : <CheckRoundedIcon />} variant={myApproved ? 'outlined' : 'contained'}>{approvalWriting === 'approve' ? t('mergeRequest.approval.approving') : approvalWriting === 'unapprove' ? t('mergeRequest.approval.revoking') : approvalsResult.loading && !approvals ? t('mergeRequest.common.checking') : myApproved ? t('mergeRequest.approval.revoke') : t('mergeRequest.approval.approve')}</Button>}
          </Box>
          <ConfirmScope confirm={confirmWithOutsideNote}><MergeRequestActions disabled={peopleDisabled} isReviewer={Boolean(mergeRequest.reviewers?.some((user) => user.id === session?.user.id))} mergeRequest={mergeRequest} onRefresh={refreshCurrent} onRun={runHeaderAction} /></ConfirmScope>
        </Bar>
        <MergeRequestSummary approvedBy={approvedBy} mergeRequest={mergeRequest} myApproved={myApproved} onCopyHeadSha={copyHeadSha} onEditPeople={setPeopleEditor} peopleDisabled={peopleDisabled} />
        {peopleEditor ? <MergeRequestPeopleDialog current={mergeRequest[peopleEditor] ?? []} disabled={peopleDisabled} label={peopleEditor === 'assignees' ? t('mergeRequest.people.assignees') : t('mergeRequest.people.reviewers')} onClose={() => setPeopleEditor(null)} onSave={(users) => setPeople(peopleEditor, users)} open participants={mentionParticipants} /> : null}
        <Bar sx={{ columnGap: 1, mt: 0.5 }}>
          <Tabs aria-label={t('mergeRequest.detail.tabs')} onChange={(_, value: ReviewTab) => setActiveTab(value)} sx={{ flex: '0 1 auto', minWidth: 0 }} value={activeTab}>
            <Tab label={t('mergeRequest.detail.tabOverview')} value="overview" />
            <Tab label={<Row spacing={1}><span>{t('mergeRequest.detail.tabDiscussion')}</span>{unresolvedCount > 0 ? <Chip aria-label={t('mergeRequest.detail.unresolvedCount', { count: unresolvedCount })} color="warning" label={unresolvedCount} size="small" variant="outlined" /> : null}</Row>} value="discussion" />
            <Tab label={t('mergeRequest.detail.tabChanges')} value="changes" />
            <Tab label={t('mergeRequest.detail.tabPipelines')} value="pipelines" />
          </Tabs>
          {activeTab === 'discussion' ? <Tooltip describeChild title={descriptionOpen ? t('mergeRequest.detail.hideDescription') : t('mergeRequest.detail.showDescription')}><Button aria-keyshortcuts="D" aria-pressed={descriptionOpen} color={descriptionOpen ? 'primary' : 'inherit'} onClick={() => setDescriptionOpen((open) => !open)} size="small" startIcon={<DescriptionOutlinedIcon />} sx={{ flexShrink: 0, ml: 'auto' }}>{t('mergeRequest.overview.description')}</Button></Tooltip> : null}
          {activeTab !== 'overview' && activeTab !== 'pipelines' && unresolvedCount > 0 ? <Box sx={{ ml: activeTab === 'discussion' ? 0 : 'auto' }}><UnresolvedThreadStepper count={unresolvedCount} onStep={stepUnresolved} /></Box> : null}
        </Bar>
        {/* Write results stay in view under the header, wherever in a long thread the action was taken. */}
        {positionError || visibleMutationError || verificationError ? <Stack aria-live="polite" spacing={1} sx={{ pb: 1, pt: 1.5 }}>
          {positionError ? <Alert onClose={() => setPositionError(null)} severity="warning">{positionError}</Alert> : null}
          {visibleMutationError ? <Alert action={mutation.status === 'unknown' ? <Button color="inherit" disabled={verifyingUnknown} onClick={() => { if (!mutation.unknownAction) void retryUnknownReceipt(); else if (verificationReady) void acknowledgeVerifiedOutcome(); else void verifyUnknownOutcome() }}>{verifyingUnknown ? t('mergeRequest.common.checking') : !mutation.unknownAction ? t('mergeRequest.unknownWrite.reloadReceipt') : verificationReady ? t('mergeRequest.unknownWrite.acknowledge') : t('mergeRequest.unknownWrite.refetch')}</Button> : undefined} onClose={mutation.status === 'unknown' ? undefined : () => setDismissedError(visibleMutationError)} severity={mutation.status === 'unknown' ? 'warning' : 'error'}>{mutation.status === 'unknown' ? verificationReady ? t('mergeRequest.unknownWrite.refetched') : t('mergeRequest.unknownWrite.locked', { action: actionLabel(mutation.unknownAction) }) : visibleMutationError.message}</Alert> : null}
          {verificationError ? <Alert onClose={() => setVerificationError(null)} severity="error">{t('mergeRequest.unknownWrite.verifyFailed', { error: verificationError })}</Alert> : null}
        </Stack> : null}
      </Box>

      <Stack spacing={1} sx={{ px: 2, py: 2 }}>
        {noteAwardsQuery && noteAwardsResult.error ? <Alert action={<Button color="inherit" onClick={noteAwardsResult.refresh}>{t('mergeRequest.reactions.retry')}</Button>} severity="warning">{noteAwardsResult.data ? t('mergeRequest.reactions.refreshFailed', { error: noteAwardsResult.error.message }) : t('mergeRequest.reactions.noteLoadFailed', { error: noteAwardsResult.error.message })}</Alert> : null}
        {noteAwardsQuery && noteAwardsResult.snapshot?.completeness === 'truncated' ? <Alert severity="info">{t('mergeRequest.reactions.truncated')}</Alert> : null}
        {/* Visited tabs stay mounted, hidden, so switching back shows them at once with their scroll, input and highlighted code. */}
        <Box><KeepAlive activeKey={activeTab} max={4}>
        {activeTab === 'discussion' ? <Box sx={{ width: '100%' }}><DiscussionTab focusNoteId={discussionViewSettled ? focusNote?.noteId : undefined} onFocusNoteDone={onNoteFocused} projectId={resourceId} templateProjectPath={projectPath ?? undefined} iid={iid} headSha={mergeRequestHeadSha} suggestionActions={suggestionActions} renderCodeContext={renderCodeContext} onUploadAttachment={uploadAttachment} attachmentTargetKey={attachmentScope} composerKey={createComposerBufferKey(session, resourceId, iid, 'new')} replyComposer={replyComposer} currentUserId={session?.user.id ?? ''} discussions={discussions} mentionParticipants={mentionParticipants} unreadNoteIds={unreadNoteIds} onMarkRead={(notes) => workspace.markRead({ projectId: resourceId, iid }, notes)} onOpenPosition={openCommentPosition} discussionError={discussionWindow.error} older={{ error: discussionWindow.olderError?.message ?? null, hasOlder: discussionWindow.hasOlder, limitReached: discussionWindow.limitReached, loading: discussionWindow.loadingOlder, onLoad: discussionWindow.loadOlder, onRetry: discussionWindow.retryOlder }} draftEditBufferKey={draftEditBufferKey} draftEditId={draftEditId} draftError={draftsResult.error} draftLoading={draftsResult.loading} draftNextPage={draftsResult.snapshot?.nextPage ?? null} draftPage={draftPage} draftStatuses={draftStatuses} editingNoteId={editingNoteId} noteEditBufferKey={noteEditBufferKey} onEditingNoteChange={setEditingNoteId} onPrevDraftPage={() => setDraftPage((current) => Math.max(1, current - 1))} publishingAll={publishingAll} drafts={drafts} loading={discussionWindow.loading} mutationLocked={mutation.isLocked} mutationPending={mutation.isPending} onDeleteDraft={deleteDraft} onDeleteNote={deleteNote} onEditDraft={editDraft} onEditNote={editNote} onNextDraftPage={() => setDraftPage((current) => current + 1)} onPublishDraft={publishDraft} onPublishAllDrafts={publishAllDrafts} onPublishSelectedDrafts={publishSelectedDrafts} onReply={setReplyDiscussion} onResolve={resolveDiscussion} reactions={noteReactions} onAddReviewers={addReviewers} onSaveDraft={saveDraft} onSetReviewers={setReviewers} onSelectDraft={(id) => setSelectedDrafts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSetDraftEdit={setDraftEditId} onSubmitComment={submitComment} onCancelReply={() => setReplyDiscussion(null)} replyDiscussion={replyDiscussion} selectedDrafts={selectedDrafts} /></Box> : null}
        {activeTab === 'changes' ? <Stack spacing={1}>
        {drafts.length ? <Alert action={<Button color="inherit" onClick={() => setActiveTab('discussion')} size="small">{t('mergeRequest.drafts.publishInDiscussion')}</Button>} severity="info">{t('mergeRequest.drafts.pending', { count: drafts.length })}</Alert> : null}
        <ChangesTab fileSource={session && fileSha ? { projectId: resourceId, sessionId: session.id, sha: fileSha, beforeSha: beforeFileSha, iid } : undefined} threadActions={readOnlyChanges ? undefined : {
          disabled: mutation.isLocked || mutation.isPending,
          onReply: setReplyDiscussion,
          onResolve: (discussion, resolved) => void resolveDiscussion(discussion, resolved),
          renderReactions: renderNoteReactions,
          replyDiscussionId: replyDiscussion?.id ?? null,
          replyComposer,
        }} pendingDrafts={readOnlyChanges ? undefined : drafts} lineComposer={lineComposer} discussions={readOnlyChanges ? undefined : discussions} compareBaseSha={mergeRequest.diffRefs?.baseSha} discussionHeadSha={mergeRequestHeadSha} discussionsIncomplete={discussionWindow.hasOlder} onOpenDiscussion={(discussionId) => { pendingThread.current = discussionId; setActiveTab('discussion') }} reviewContext={session && !readOnlyChanges && mergeRequestHeadSha ? { instanceUrl: session.instanceUrl, userId: session.user.id, projectId: resourceId, mergeRequestIid: iid, revision: mergeRequestHeadSha } : undefined} allowComments={!readOnlyChanges} changeNextPage={changesResult.snapshot?.nextPage ?? null} changePage={changePage} commitPage={commitPage} changesError={changesResult.error} changesLoading={Boolean(pendingFileTarget) || changesResult.loading} changesTruncated={comparing && changesResult.snapshot?.completeness === 'truncated'} commitNextPage={commitsResult.snapshot?.nextPage ?? null} commits={commits} commitsError={commitsResult.error} local={session && mergeRequestHeadSha ? { active: showingLocal, badge: <LocalStatusBadge headSha={mergeRequestHeadSha} projectId={resourceId} projectPath={mergeRequest.projectPath ?? null} sessionId={session.id} sourceBranch={mergeRequest.sourceBranch} />, content: <LocalChanges headSha={mergeRequestHeadSha} onSelectFile={setSelectedFile} projectId={resourceId} projectPath={mergeRequest.projectPath ?? null} selectedFile={selectedFile} sessionId={session.id} userId={session.user.id} />, onSelect: () => { setLocalChanges(!showingLocal); setSelectedCommit(null); setCompareVersion(null); setSelectedFile(null); setFileView(null); setChangePage(1) } } : undefined} commitsLoading={commitsResult.loading} diffs={pendingFileTarget ? [] : diffs} fileResult={fileResult} fileView={resolvedFileView} onComment={commentOnLines} onNextChangePage={() => setChangePage((current) => current + 1)} onNextCommitPage={() => setCommitPage((current) => current + 1)} onPrevChangePage={() => setChangePage((current) => Math.max(1, current - 1))} onPrevCommitPage={() => setCommitPage((current) => Math.max(1, current - 1))} onSelectCommit={(sha) => { setSelectedCommit(sha); setCompareVersion(null); setLocalChanges(false); setSelectedFile(null); setFileView(null); setChangePage(1) }} onSelectFile={(path) => { setSelectedFile(path); setFileView(null) }} onViewChange={setFileView} selectedCommit={selectedCommit} selectedFile={selectedFile} selectedPosition={viewPosition ?? commentPosition} suggestionActions={readOnlyChanges ? undefined : suggestionActions} versions={{ compareFrom: comparing ? compareVersion : null, error: versionsResult.error, headSha: mergeRequestHeadSha, items: (versionsResult.data ?? []) as MrVersion[], loading: versionsResult.loading, more: (versionsResult.snapshot?.nextPage ?? null) !== null, onSelect: (sha) => { setCompareVersion(sha); setSelectedCommit(null); setLocalChanges(false); setSelectedFile(null); setFileView(null); setChangePage(1) } }} /></Stack> : null}
        {activeTab === 'overview' ? <OverviewTab approvedBy={approvedBy} approvalsError={approvalsResult.error} approvalsLoading={approvalsResult.loading} description={mergeRequest.description} descriptionEdit={descriptionEdit} editDisabled={mutation.isLocked || mutation.isPending} mergeRequest={mergeRequest} onRerequestReview={(user) => void rerequestReview(user)} onCancelEdit={() => setDescriptionEdit(null)} onUploadAttachment={uploadAttachment} onChangeEdit={(body) => setDescriptionEdit((current) => current ? { ...current, body } : current)} onSaveEdit={() => void saveDescription()} onStartEdit={() => setDescriptionEdit({ body: mergeRequest.description ?? '', expected: mergeRequest.description ?? '' })} reactions={<Stack spacing={0.5}>
          <ReactionBar awards={mrAwardsResult.data ?? []} currentUserId={session?.user.id ?? ''} disabled={reactionsDisabled} label={t('mergeRequest.reactions.mrLabel')} onToggle={(name, add) => toggleReaction(name, add)} />
          {mrAwardsResult.loading ? <Typography color="textSecondary" role="status" variant="caption">{t('mergeRequest.reactions.loading')}</Typography> : null}
          {mrAwardsResult.error ? <Typography color={mrAwardsResult.data ? 'textSecondary' : 'error'} variant="caption">{mrAwardsResult.data ? t('mergeRequest.reactions.refreshFailed', { error: mrAwardsResult.error.message }) : t('mergeRequest.reactions.loadFailed', { error: mrAwardsResult.error.message })}</Typography> : null}
        </Stack>} /> : null}
        {activeTab === 'pipelines' ? <ConfirmScope confirm={confirmWithOutsideNote}><PipelinesTab disabled={mutation.isLocked || mutation.isPending} iid={iid} onOpenUrl={(url) => void openInGitLab(url)} onRunAction={(action) => runAction(action)} projectId={resourceId} sessionId={session?.id ?? null} /></ConfirmScope> : null}
        </KeepAlive></Box>
        {activeTab === 'discussion' && descriptionOpen ? <DescriptionPanel description={mergeRequest.description} mergeRequest={mergeRequest} onClose={closeDescription} onEdit={() => { setActiveTab('overview'); if (!mutation.isLocked && !mutation.isPending) setDescriptionEdit({ body: mergeRequest.description ?? '', expected: mergeRequest.description ?? '' }) }} /> : null}
        {discussionWindow.observers}
      </Stack>
    </Box>
    </MarkdownLinkProvider>
  )
}

function DiscussionTab({ focusNoteId, onFocusNoteDone, projectId, iid, headSha, suggestionActions, renderCodeContext, reactions, onUploadAttachment, attachmentTargetKey, composerKey, replyComposer, currentUserId, mentionParticipants, templateProjectPath, unreadNoteIds, onMarkRead, onOpenPosition, discussionError, older, discussions, draftEditBufferKey, draftEditId, draftError, draftLoading, draftNextPage, draftPage, draftStatuses, drafts, editingNoteId, loading, mutationLocked, mutationPending, noteEditBufferKey, onCancelReply, onDeleteDraft, onDeleteNote, onEditDraft, onEditNote, onEditingNoteChange, onNextDraftPage, onPrevDraftPage, onPublishAllDrafts, onPublishDraft, onPublishSelectedDrafts, onReply, onResolve, onSaveDraft, onSelectDraft, onAddReviewers, onSetReviewers, onSetDraftEdit, onSubmitComment, publishingAll, replyDiscussion, selectedDrafts }: DiscussionTabProps) {
  const t = useT()
  const { session } = useConnection()
  const mutationDisabled = mutationLocked || mutationPending
  // While a new comment is sent, the composer keeps its place on screen and the comment appears above it,
  // instead of pushing the composer down. The place is released once React has shown the refreshed threads.
  const composerRef = useRef<HTMLDivElement | null>(null)
  const composerPinRef = useRef<number | null>(null)
  const submitFromComposer: typeof onSubmitComment = async (...args) => {
    composerPinRef.current = composerRef.current?.getBoundingClientRect().top ?? null
    try {
      return await onSubmitComment(...args)
    } finally {
      globalThis.setTimeout(() => { composerPinRef.current = null }, 0)
    }
  }
  useLayoutEffect(() => {
    const pinned = composerPinRef.current
    const composer = composerRef.current
    const host = composer ? findScrollContainer(composer) : null
    if (pinned === null || !composer || !host) return
    host.scrollTop += composer.getBoundingClientRect().top - pinned
  }, [discussions])
  const openThread = (discussionId: string) => {
    const thread = document.querySelector<HTMLElement>(`[data-discussion-id="${CSS.escape(discussionId)}"]`)
    if (!thread) return
    thread.scrollIntoView?.({ behavior: 'auto', block: 'start' })
    thread.querySelector<HTMLElement>('[data-note-id]')?.focus({ preventScroll: true })
  }
  return (
    <DiscussionLayout
      composer={(
        <Box ref={composerRef}><BufferedReviewComposer onUploadAttachment={onUploadAttachment} attachmentTargetKey={`${attachmentTargetKey}:${composerKey}`} enableMentions={Boolean(currentUserId)} key={composerKey} mentionParticipants={mentionParticipants} templateProjectPath={templateProjectPath} bufferKey={composerKey} disabled={mutationLocked} onCancelReply={onCancelReply} onClearPosition={() => undefined} onAddReviewers={onAddReviewers} onSaveDraft={onSaveDraft} onSetReviewers={onSetReviewers} onSubmitComment={submitFromComposer} pending={mutationPending} /></Box>
      )}
      navigator={discussions.length ? <UnresolvedThreadNav discussions={discussions} olderNotLoaded={older.hasOlder} onSelect={openThread} /> : null}
      side={<>
        {draftError && !drafts.length ? <Alert severity="error">{t('mergeRequest.drafts.loadFailed', { error: draftError.message })}</Alert> : null}
        {draftError && drafts.length ? <Alert severity="warning">{t('mergeRequest.drafts.refreshFailed', { error: draftError.message })}</Alert> : null}
        {(!draftLoading || drafts.length) && (!draftError || drafts.length) ? <DraftList disabled={mutationDisabled} onUploadAttachment={onUploadAttachment} draftEditBufferKey={draftEditBufferKey} draftEditId={draftEditId} mentionParticipants={mentionParticipants} drafts={drafts} nextPage={draftNextPage} page={draftPage} publishingAll={publishingAll} statuses={draftStatuses} selected={selectedDrafts} onDelete={onDeleteDraft} onEdit={onEditDraft} onNextPage={onNextDraftPage} onOpenPosition={onOpenPosition} onPrevPage={onPrevDraftPage} onPublish={onPublishDraft} onPublishAll={onPublishAllDrafts} onPublishSelected={onPublishSelectedDrafts} onSelect={onSelectDraft} onSetEdit={onSetDraftEdit} sessionId={session?.id ?? null} /> : null}
      </>}
      threads={<>
        {discussionError && !discussions.length ? <Alert severity="error">{discussionError.message}</Alert> : null}
        {discussionError && discussions.length ? <Alert severity="warning">{t('mergeRequest.detail.discussionRefreshFailed', { error: discussionError.message })}</Alert> : null}
        {loading && !discussions.length ? <LoadingPanel label={t('mergeRequest.detail.discussionLoading')} /> : null}
        {(!loading || discussions.length) && (!discussionError || discussions.length) ? <DiscussionList focusNoteId={focusNoteId} onFocusNoteDone={onFocusNoteDone} onUploadAttachment={onUploadAttachment} projectId={projectId} iid={iid} headSha={headSha} reactions={reactions} editingNoteId={editingNoteId} mentionParticipants={mentionParticipants} noteEditBufferKey={noteEditBufferKey} onEditingNoteChange={onEditingNoteChange} older={older} renderCodeContext={renderCodeContext} sessionId={session?.id ?? null} unreadNoteIds={unreadNoteIds} onMarkRead={onMarkRead} onOpenPosition={onOpenPosition} replyComposer={replyComposer} replyDiscussionId={replyDiscussion?.id} currentUserId={currentUserId} disabled={mutationDisabled} discussions={discussions} onDelete={onDeleteNote} onEdit={onEditNote} onReply={onReply} onResolve={onResolve} suggestionActions={suggestionActions} /> : null}
      </>}
    />
  )
}

interface DiscussionTabProps {
  iid: string
  projectId: string
  headSha?: string
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
  focusNoteId?: string
  onFocusNoteDone?: () => void
  mentionParticipants: GitLabUser[]
  /** Sets these people as the reviewers; set while the MR has no reviewers. */
  onAddReviewers?: (users: GitLabUser[]) => void
  /** Opens the reviewer editor; set while the MR has no reviewers. */
  onSetReviewers?: () => void
  /** The project whose comment templates the composer offers. */
  templateProjectPath?: string
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

export function BufferedReviewComposer({ onAddReviewers, onSetReviewers, ...props }: Omit<React.ComponentProps<typeof ReviewComposer>, 'onChange' | 'value'> & {
  bufferKey: string
  /** Set while the MR has no reviewers: mentioned participants can then be set as reviewers at once. */
  onAddReviewers?: (users: GitLabUser[]) => void
  /** Set while the MR has no reviewers: a mention then suggests adding them. */
  onSetReviewers?: () => void
}) {
  const t = useT()
  const { session } = useConnection()
  const { body, change, discard, error, persistenceStatus } = useComposerBuffer(props.bufferKey, session?.id ?? null)
  const notify = useNotify()
  const discardInput = () => {
    // The text is offered back, so one click never loses it.
    const previous = discard()
    if (previous) notify({ actionLabel: t('mergeRequest.composer.undo'), message: t('mergeRequest.composer.discarded'), onAction: () => { restoreComposerBuffer(props.bufferKey, previous) } })
  }
  const [flushError, setFlushError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const persistenceLabel = persistenceStatus === 'hydrating' || persistenceStatus === 'saving'
    ? t('mergeRequest.common.saving')
    : persistenceStatus === 'saved' && body
      ? t('mergeRequest.composer.savedLocally')
      : null
  const flushBeforeSubmit = async (submit: () => Promise<boolean>): Promise<boolean> => {
    setFlushError(null)
    setSubmitting(true)
    try {
      const flushed = await flushComposerBuffers().catch(() => false)
      if (!flushed) {
        setFlushError(t('mergeRequest.composer.submitStopped'))
        return false
      }
      return await submit()
    } finally {
      setSubmitting(false)
    }
  }
  const mentionedNames = onSetReviewers ? mentionedUsernames(body) : []
  const mentionedParticipants = (props.mentionParticipants ?? []).filter((user) => mentionedNames.includes(user.username.toLocaleLowerCase()))
  const onSubmitComment = (nextBody: string, thread: boolean, position?: Position) => flushBeforeSubmit(() => props.onSubmitComment(nextBody, thread, position))
  const onSaveDraft = (nextBody: string, position?: Position) => flushBeforeSubmit(() => props.onSaveDraft(nextBody, position))
  return <Stack spacing={0.5}><ReviewComposer {...props} disabled={props.disabled || submitting} onChange={change} onDetachedAttachment={(markdown) => { appendComposerBuffer(props.bufferKey, markdown) }} onSaveDraft={onSaveDraft} onSubmitComment={onSubmitComment} pending={props.pending || submitting} value={body} />{body ? <Button color="inherit" disabled={props.disabled || props.pending || submitting} onClick={discardInput} size="small" sx={{ alignSelf: 'flex-end', color: 'text.secondary' }}>{t('mergeRequest.composer.discard')}</Button> : null}{persistenceLabel ? <Typography color="textSecondary" variant="caption">{persistenceLabel}</Typography> : null}{onSetReviewers && mentionedNames.length ? <Alert action={<Row spacing={0.5}>{onAddReviewers && mentionedParticipants.length ? <Button color="inherit" disabled={props.disabled || props.pending} onClick={() => onAddReviewers(mentionedParticipants)} size="small">{t('mergeRequest.composer.addMentionedReviewers', { count: mentionedParticipants.length, name: `@${mentionedParticipants[0].username}` })}</Button> : null}<Button color="inherit" onClick={onSetReviewers} size="small">{mentionedParticipants.length ? t('mergeRequest.composer.chooseReviewers') : t('mergeRequest.composer.setReviewers')}</Button></Row>} severity="info">{t('mergeRequest.composer.noReviewers')}</Alert> : null}{error ? <Alert severity="warning">{error}</Alert> : null}{flushError ? <Alert severity="warning">{flushError}</Alert> : null}</Stack>
}



const noUsers: GitLabUser[] = []

/** The title, state and people lines of the header, memoized: they change with the MR, not with what the reader does below. */
const MergeRequestSummary = memo(function MergeRequestSummary({ approvedBy, mergeRequest, myApproved, onCopyHeadSha, onEditPeople, peopleDisabled }: { approvedBy: GitLabUser[]; mergeRequest: MergeRequest; myApproved: boolean; onCopyHeadSha: (sha: string) => Promise<void>; onEditPeople: (field: 'assignees' | 'reviewers') => void; peopleDisabled: boolean }) {
  const t = useT()
  return <>
    <Row align="top" spacing={1} sx={{ mt: 1 }}>
      <Tooltip enterDelay={600} title={mergeRequest.title}><Typography component="h1" sx={{ display: '-webkit-box', flex: 1, minWidth: 0, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="h1">{mergeRequest.title}</Typography></Tooltip>
    </Row>
    <Row sx={{ columnGap: 1.5, flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
      <StatusPill icon={<MergeRequestStateGlyph state={mergeRequest.state} />} label={formatMergeRequestState(mergeRequest.state)} size="small" subtle tone={mergeRequestStateTone(mergeRequest.state)} />
      {mergeRequest.draft ? <Chip icon={<EditNoteRoundedIcon />} label={t('mergeRequest.summary.draft')} size="small" variant="outlined" /> : null}
      <Typography color="textSecondary" variant="caption"><Box component="span" sx={{ color: 'text.primary' }}><GitLabUserLink user={mergeRequest.author} /></Box></Typography>
      <RelativeTime prefix={t('mergeRequest.common.updated')} value={mergeRequest.updatedAt} />
      <Tooltip title={`${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`}><Typography color="textSecondary" noWrap sx={{ fontFamily: 'code.fontFamily', maxWidth: '100%', minWidth: 0 }} variant="caption">{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography></Tooltip>
      {mergeRequest.headSha ? <Tooltip describeChild title={t('mergeRequest.summary.copyHeadSha')}><Chip icon={<ContentCopyRoundedIcon />} label={shortSha(mergeRequest.headSha)} onClick={() => void onCopyHeadSha(mergeRequest.headSha ?? '')} size="small" sx={{ fontFamily: 'code.fontFamily' }} variant="outlined" /></Tooltip> : null}
      {mergeRequest.pipeline ? <PipelineStatus status={mergeRequest.pipeline.status} /> : null}
      {approvedBy.length ? <StateIcon count={approvedBy.length} icon={myApproved ? <ThumbUpRoundedIcon fontSize="inherit" /> : <ThumbUpOutlinedIcon fontSize="inherit" />} label={t('mergeRequest.common.approvedBy', { count: approvedBy.length, names: formatNames(approvedBy.map((user) => user.name)) })} tone="success" /> : null}
      <MergeStatusText mergeRequest={mergeRequest} />
    </Row>
    <Row sx={{ columnGap: 1.5, flexWrap: 'wrap', mt: 0.5, rowGap: 0 }}>
      {([['assignees', 'mergeRequest.people.assigneesList'], ['reviewers', 'mergeRequest.people.reviewersList']] as const).map(([field, label]) => (
        // The label, the names and the pencil are one quiet button, so the edit action reads as part of the line.
        <Tooltip key={field} title={field === 'assignees' ? t('mergeRequest.summary.changeAssignees') : t('mergeRequest.summary.changeReviewers')}><span><Button aria-label={t(field === 'assignees' ? 'mergeRequest.summary.editAssignees' : 'mergeRequest.summary.editReviewers', { names: mergeRequest[field]?.length ? formatNames(mergeRequest[field].map((user) => user.name)) : t('mergeRequest.common.none') })} disabled={peopleDisabled} endIcon={<EditOutlinedIcon />} onClick={() => onEditPeople(field)} variant="quiet">{t(label, { names: mergeRequest[field]?.length ? formatNames(mergeRequest[field].map((user) => user.name)) : t('mergeRequest.common.none') })}</Button></span></Tooltip>
      ))}
    </Row>
  </>
})

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

function compareNotesByTime(left: Note, right: Note): number {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  return (Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime) - (Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime) || left.id.localeCompare(right.id)
}

/** The lowercased `@username`s in the text (not inside a word, as in an email address). */
function mentionedUsernames(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s([{])@([A-Za-z0-9_][A-Za-z0-9_.-]*)/gu)].map((match) => match[1].replace(/[.-]+$/u, '').toLocaleLowerCase())
}

/** The MR's people for mention candidates: author, reviewers, assignees, then the latest commenters; not the current user. */
function mergeRequestParticipants(mergeRequest: MergeRequest | null, notes: Note[], currentUserId: string | undefined): GitLabUser[] {
  const commenters = [...notes].sort(compareNotesByTime).reverse().map((note) => note.author)
  const people = mergeRequest ? [mergeRequest.author, ...(mergeRequest.reviewers ?? []), ...(mergeRequest.assignees ?? []), ...commenters] : commenters
  const byId = new Map<string, GitLabUser>()
  for (const user of people) if (user.id !== currentUserId && !byId.has(user.id)) byId.set(user.id, user)
  return [...byId.values()]
}

/** Names the write whose result is unknown, for the notice that stops resending. */
function actionLabel(action: GitLabAction | null): string {
  switch (action?.kind) {
    case 'comment': return translate('mergeRequest.writeAction.comment')
    case 'reply': return translate('mergeRequest.writeAction.reply')
    case 'editNote': return translate('mergeRequest.writeAction.editNote')
    case 'deleteNote': return translate('mergeRequest.writeAction.deleteNote')
    case 'resolve': return translate('mergeRequest.writeAction.resolve')
    case 'saveDraft': return translate('mergeRequest.writeAction.saveDraft')
    case 'editDraft': return translate('mergeRequest.writeAction.editDraft')
    case 'deleteDraft': return translate('mergeRequest.writeAction.deleteDraft')
    case 'publishDraft': return translate('mergeRequest.writeAction.publishDraft')
    case 'approve': return translate('mergeRequest.writeAction.approve')
    case 'unapprove': return translate('mergeRequest.writeAction.unapprove')
    case 'setAssignees': return translate('mergeRequest.writeAction.setAssignees')
    case 'setReviewers': return translate('mergeRequest.writeAction.setReviewers')
    case 'setDescription': return translate('mergeRequest.writeAction.setDescription')
    case 'merge': return action.autoMerge ? translate('mergeRequest.writeAction.setAutoMerge') : translate('mergeRequest.writeAction.merge')
    case 'cancelAutoMerge': return translate('mergeRequest.writeAction.cancelAutoMerge')
    case 'rebase': return translate('mergeRequest.writeAction.rebase')
    case 'setState': return action.stateEvent === 'close' ? translate('mergeRequest.writeAction.close') : translate('mergeRequest.writeAction.reopen')
    case 'setTitle': return translate('mergeRequest.writeAction.setTitle')
    case 'setLabels': return translate('mergeRequest.writeAction.setLabels')
    case 'setMilestone': return translate('mergeRequest.writeAction.setMilestone')
    case 'requestChanges': return translate('mergeRequest.writeAction.requestChanges')
    case 'rerequestReview': return translate('mergeRequest.writeAction.rerequestReview')
    case 'uploadAttachment': return translate('mergeRequest.writeAction.uploadAttachment')
    case 'addAward': return translate('mergeRequest.writeAction.addAward')
    case 'removeAward': return translate('mergeRequest.writeAction.removeAward')
    case 'markTodoDone': return translate('mergeRequest.writeAction.markTodoDone')
    case 'retryJob': return translate('mergeRequest.writeAction.retryJob')
    case 'cancelJob': return translate('mergeRequest.writeAction.cancelJob')
    case 'playJob': return translate('mergeRequest.writeAction.playJob')
    case 'retryPipeline': return translate('mergeRequest.writeAction.retryPipeline')
    case 'cancelPipeline': return translate('mergeRequest.writeAction.cancelPipeline')
    case 'applySuggestions': return translate('mergeRequest.writeAction.applySuggestions')
    default: return translate('mergeRequest.writeAction.unknown')
  }
}

function isInvolved(mergeRequest: MergeRequest, userId: string): boolean {
  return mergeRequest.author.id === userId || Boolean(mergeRequest.assignees?.some((user) => user.id === userId) || mergeRequest.reviewers?.some((user) => user.id === userId))
}

/** Threads placed by line (`n:12`, `o:4`), in the order of their line numbers. */
function sortByLine(byLine: Map<string, Discussion[]>): Discussion[] {
  return [...byLine.entries()].sort(([left], [right]) => Number(left.slice(2)) - Number(right.slice(2))).flatMap(([, threads]) => threads)
}

/** An open menu or listbox owns letter keys (MUI only consumes letters that match an item). */
function isInsideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"], [role="menubar"], [role="listbox"]') !== null
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}
