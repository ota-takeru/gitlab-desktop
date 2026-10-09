import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import PublishRoundedIcon from '@mui/icons-material/PublishRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined'
import WidthFullOutlinedIcon from '@mui/icons-material/WidthFullOutlined'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { PipelineStatus } from '../../components/PipelineStatus'
import { RelativeTime } from '../../components/RelativeTime'
import { StatusPill } from '../../components/StatusPill'
import { formatMergeRequestState, mergeRequestStateTone, shortSha } from '../../lib/format'
import { createRequestId, normalizeGitLabError, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import type {
  Approvals,
  Commit,
  DiffsQuery,
  Diff,
  Discussion,
  Draft,
  FileQuery,
  GitLabUser,
  GitLabAction,
  GitLabQuery,
  ApprovalsQuery,
  CommitDiffQuery,
  MergeRequest,
  MergeRequestQuery,
  Note,
  Position,
  ReviewResourceQuery,
} from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { usePersonalWorkspace } from '../shared/personalWorkspace'
import { notifyWorkspace } from '../../lib/notifications'
import { useDiscussionWindow } from './useDiscussionWindow'
import { positionAtLatest } from './discussionScroll'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { clearGitLabMutationStates, useGitLabMutation } from '../shared/useGitLabMutation'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { DiscussionList, type OlderDiscussions } from './DiscussionList'
import { DiffViewer } from './DiffViewer'
import { ReviewComposer } from './ReviewComposer'
import { clearComposerBufferStore, createComposerBackendKey, createComposerBufferKey, useComposerBuffer, flushComposerBuffers } from './useComposerBuffer'

type ReviewTab = 'discussion' | 'changes' | 'overview'
type CommitsQuery = ReviewResourceQuery & { kind: 'commits' }
type DraftsQuery = ReviewResourceQuery & { kind: 'drafts' }
const commentScrollPositions = new Map<string, number>()

/** Clear in-memory composer text when a workspace/session is disposed. */
export function clearComposerBuffers(): void {
  commentScrollPositions.clear()
  clearComposerBufferStore()
  clearGitLabMutationStates()
}

export interface MergeRequestDetailProps {
  initialMergeRequest: MergeRequest
  /** Shown only when the list is hidden (narrow windows). */
  onBack?: () => void
  onOpenProject?: () => void
  /** Wide windows: hide or show the list pane to give the review more room. */
  onToggleList?: () => void
  listHidden?: boolean
}

export function MergeRequestDetail({ initialMergeRequest, listHidden, onBack, onOpenProject, onToggleList }: MergeRequestDetailProps) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const sectionRef = useRef<HTMLElement | null>(null)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<ReviewTab>('discussion')
  const [viewPosition, setViewPosition] = useState<Position | undefined>()
  const [pendingFileTarget, setPendingFileTarget] = useState<string | null>(null)
  const [draftPage, setDraftPage] = useState(1)
  const [commitPage, setCommitPage] = useState(1)
  const [changePage, setChangePage] = useState(1)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [fileView, setFileView] = useState<'diff' | 'file'>('diff')
  const [replyDiscussion, setReplyDiscussion] = useState<Discussion | null>(null)
  const [position, setPosition] = useState<Position | undefined>()
  const [positionError, setPositionError] = useState<string | null>(null)
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([])
  const [draftStatuses, setDraftStatuses] = useState<Record<string, DraftStatus>>({})
  const [draftEdit, setDraftEdit] = useState<{ id: string; body: string } | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [verificationReady, setVerificationReady] = useState(false)
  const [verifyingUnknown, setVerifyingUnknown] = useState(false)
  const resourceId = initialMergeRequest.projectId
  const iid = initialMergeRequest.iid
  const mutationInstanceId = useId()
  // Scroll positions are remembered per opened view, so reopening an MR starts at the latest comment again.
  const scrollPositionScope = useId()
  const { setUnsafe: setReviewUnsafe } = useAutoUpdateSafety(`review:${session?.id ?? 'none'}:${resourceId}:${iid}:${mutationInstanceId}`, { persistOnUnmount: true })
  const { setUnsafe: setDraftEditUnsafe } = useAutoUpdateSafety(`draft-edit:${session?.id ?? 'none'}:${resourceId}:${iid}`)
  const mutationResourceKey = useMemo(() => JSON.stringify({ iid, projectId: resourceId }), [iid, resourceId])
  const mutation = useGitLabMutation(session?.id ?? null, mutationResourceKey, setReviewUnsafe)

  useEffect(() => {
    setDraftEditUnsafe(Boolean(draftEdit))
  }, [draftEdit, setDraftEditUnsafe])

  const currentQuery = useMemo(() => ({ iid, kind: 'mr' as const, projectId: resourceId }), [iid, resourceId])
  const currentResult = useGitLabQuery<MergeRequestQuery>(session?.id ?? null, currentQuery)
  const accessDenied = currentResult.error?.code === 'AUTH_REQUIRED' || currentResult.error?.code === 'FORBIDDEN' || currentResult.error?.code === 'NOT_FOUND'
  const mergeRequest = accessDenied ? null : currentResult.data ?? initialMergeRequest
  const mergeRequestHeadSha = mergeRequest?.diffRefs?.headSha

  const diffsQuery = useMemo<DiffsQuery | null>(() => activeTab === 'changes' && !selectedCommit && mergeRequestHeadSha ? ({ headSha: mergeRequestHeadSha, iid, kind: 'diffs', page: changePage, projectId: resourceId } as DiffsQuery) : null, [activeTab, changePage, iid, resourceId, selectedCommit, mergeRequestHeadSha])
  const commitDiffQuery = useMemo<CommitDiffQuery | null>(() => activeTab === 'changes' && selectedCommit ? ({ iid, kind: 'commitDiff', page: changePage, projectId: resourceId, sha: selectedCommit } as CommitDiffQuery) : null, [activeTab, changePage, iid, resourceId, selectedCommit])
  const commitsQuery = useMemo<CommitsQuery | null>(() => activeTab === 'changes' ? ({ iid, kind: 'commits', page: commitPage, projectId: resourceId } as CommitsQuery) : null, [activeTab, commitPage, iid, resourceId])
  const draftQuery = useMemo<DraftsQuery | null>(() => activeTab === 'discussion' ? ({ iid, kind: 'drafts', page: draftPage, projectId: resourceId } as DraftsQuery) : null, [activeTab, draftPage, iid, resourceId])
  const approvalsQuery = useMemo<ApprovalsQuery | null>(() => ({ iid, kind: 'approvals', projectId: resourceId } as ApprovalsQuery), [iid, resourceId])

  const discussionWindow = useDiscussionWindow(session?.id ?? null, resourceId, iid, activeTab === 'discussion')
  const diffsResult = useGitLabQuery<DiffsQuery>(session?.id ?? null, diffsQuery)
  const commitDiffResult = useGitLabQuery<CommitDiffQuery>(session?.id ?? null, commitDiffQuery)
  const commitsResult = useGitLabQuery<CommitsQuery>(session?.id ?? null, commitsQuery)
  const draftsResult = useGitLabQuery<DraftsQuery>(session?.id ?? null, draftQuery)
  const approvalsResult = useGitLabQuery<ApprovalsQuery>(session?.id ?? null, approvalsQuery)

  const diffs = (selectedCommit ? (commitDiffResult.data ?? []) : (diffsResult.data ?? [])) as Diff[]
  const commits = (commitsResult.data ?? []) as Commit[]
  const discussionAccessDenied = ['AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND'].includes(discussionWindow.error?.code ?? '')
  const discussions = useMemo(() => discussionAccessDenied || accessDenied ? [] : discussionWindow.discussions, [accessDenied, discussionAccessDenied, discussionWindow.discussions])
  const drafts = (draftsResult.data ?? []) as Draft[]
  const approvals = approvalsResult.data as Approvals | null
  const selectedDiff = diffs.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? diffs[0]
  const fileSha = selectedCommit ?? mergeRequest?.headSha
  const fileQuery = useMemo<FileQuery | null>(() => activeTab === 'changes' && fileView === 'file' && selectedDiff && fileSha ? ({ kind: 'file', path: selectedDiff.newPath || selectedDiff.oldPath, projectId: resourceId, sha: fileSha }) : null, [activeTab, fileSha, fileView, resourceId, selectedDiff])
  const fileResult = useGitLabQuery<FileQuery>(session?.id ?? null, fileQuery)
  const previousCommentIds = useRef<{ sessionId: string; notes: Map<string, string> } | null>(null)
  const commentNotes = useMemo(() => discussions.flatMap((discussion) => discussion.notes).filter((note) => !note.system), [discussions])
  const unreadNoteIds = workspace.unreadIds({ projectId: resourceId, iid }, commentNotes)
  useEffect(() => { if (session && mergeRequest) workspace.recordRecent({ projectId: resourceId, iid }) }, [session?.id, resourceId, iid, Boolean(mergeRequest)]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || accessDenied) return
    workspace.observe({ projectId: resourceId, iid }, commentNotes)
  }, [commentNotes, session, accessDenied, workspace, resourceId, iid])
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

  if (!mergeRequest) {
    return <Stack spacing={1.5} sx={{ p: 3 }}>{onBack ? <Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />} sx={{ alignSelf: 'flex-start' }}>一覧に戻る</Button> : null}<Alert severity="error">このMRは現在の接続先または権限では表示できません。保存済みの内容は表示しません。</Alert></Stack>
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
    setSelectedCommit(null); setFileView('diff'); setChangePage(1)
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
    const localDraftKey = createComposerBackendKey(createComposerBufferKey(session, resourceId, iid, replyDiscussion?.id ?? 'new', commentPosition))
    if (replyDiscussion) {
      const repliedDiscussionId = replyDiscussion.id
      const success = await runAction({ body, discussionId: repliedDiscussionId, iid, kind: 'reply', projectId: resourceId }, () => discussionWindow.refreshDiscussion(repliedDiscussionId), localDraftKey)
      if (success) setReplyDiscussion(null)
      return success
    }
    return runAction({ body, iid, kind: 'comment', position: targetPosition, projectId: resourceId, thread: thread || Boolean(targetPosition) }, discussionWindow.refreshLatest, localDraftKey)
  }
  const saveDraft = async (body: string, targetPosition?: Position) => {
    if (targetPosition && !isPositionCurrent(targetPosition, mergeRequest)) {
      setPositionError('MRのheadが変わったため、この行位置は古くなっています。差分を更新して行を選び直してください。')
      return false
    }
    setPositionError(null)
    const localDraftKey = createComposerBackendKey(createComposerBufferKey(session, resourceId, iid, replyDiscussion?.id ?? 'new', commentPosition))
    const action = { body, discussionId: replyDiscussion?.id, iid, kind: 'saveDraft' as const, position: targetPosition, projectId: resourceId }
    const success = await runAction(action, draftsResult.refresh, localDraftKey)
    if (success) setReplyDiscussion(null)
    return success
  }

  const discussionIdForNote = (note: Note) => discussions.find((discussion) => discussion.notes.some((item) => item.id === note.id))?.id ?? null
  const editNote = (note: Note, body: string) => runAction({ body, iid, kind: 'editNote', noteId: note.id, projectId: resourceId }, () => discussionWindow.refreshDiscussion(discussionIdForNote(note)))
  const deleteNote = (note: Note) => runAction({ iid, kind: 'deleteNote', noteId: note.id, projectId: resourceId }, () => discussionWindow.refreshDiscussion(discussionIdForNote(note)))
  const resolveDiscussion = (discussion: Discussion, resolved: boolean) => runAction({ discussionId: discussion.id, iid, kind: 'resolve', projectId: resourceId, resolved }, () => discussionWindow.refreshDiscussion(discussion.id))

  const publishDraftId = async (draftId: string) => {
    if (draftStatuses[draftId] === 'unknown' || draftStatuses[draftId] === 'pending') return false
    setDraftStatuses((current) => ({ ...current, [draftId]: 'pending' }))
    const outcome = await mutation.runDetailed({ draftId, iid, kind: 'publishDraft', projectId: resourceId })
    if (outcome.ok) draftsResult.refresh()
    setDraftStatuses((current) => ({ ...current, [draftId]: outcome.status }))
    return outcome.ok
  }
  const publishDraft = (draft: Draft) => publishDraftId(draft.id)

  const deleteDraft = (draft: Draft) => runAction({ draftId: draft.id, iid, kind: 'deleteDraft', projectId: resourceId }, draftsResult.refresh)
  const editDraft = async (draft: Draft, body: string) => {
    const success = await runAction({ body, draftId: draft.id, iid, kind: 'editDraft', projectId: resourceId }, draftsResult.refresh)
    if (success) setDraftEdit(null)
    return success
  }
  const publishSelectedDrafts = async () => {
    for (const draftId of selectedDrafts) {
      if (!await publishDraftId(draftId)) break
    }
  }

  const openInGitLab = async () => {
    if (!session) return
    try {
      await openGitLabUrl(session.id, mergeRequest.webUrl)
    } catch (caught) {
      // The review page remains usable if an OS/browser open is unavailable.
      void caught
    }
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
  const approvalDisabled = mutation.isLocked || mutation.isPending || !mergeRequest.headSha || approvalsResult.loading || !approvals || Boolean(approvalsResult.error)
  const toggleApproval = () => mergeRequest.headSha ? runAction({ iid, kind: myApproved ? 'unapprove' : 'approve', projectId: resourceId, ...(myApproved ? {} : { sha: mergeRequest.headSha }) } as GitLabAction, approvalsResult.refresh) : Promise.resolve(false)
  const unresolvedCount = discussions.filter((discussion) => {
    const resolvable = discussion.notes.filter((note) => note.resolvable && !note.system)
    return resolvable.length > 0 && !resolvable.every((note) => note.resolved)
  }).length

  return (
    <Box component="section" ref={sectionRef} sx={{ minHeight: '100%', width: '100%' }}>
      <Box component="header" data-sticky-header="true" sx={{ bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', position: 'sticky', px: { md: 3, xs: 2 }, pt: 1.25, top: 0, zIndex: 2 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minHeight: 32 }}>
          {onBack ? <Tooltip title="一覧に戻る (Esc)"><IconButton aria-label="一覧に戻る" onClick={onBack} sx={{ ml: -0.75 }}><ArrowBackRoundedIcon /></IconButton></Tooltip> : null}
          {onToggleList ? <Tooltip title={listHidden ? '一覧を表示' : '一覧を隠して広く表示'}><IconButton aria-label={listHidden ? '一覧を表示' : '一覧を隠す'} aria-pressed={Boolean(listHidden)} onClick={onToggleList} sx={{ ml: -0.75 }}>{listHidden ? <ViewSidebarOutlinedIcon /> : <WidthFullOutlinedIcon />}</IconButton></Tooltip> : null}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
            <Button color="inherit" onClick={onOpenProject} sx={{ color: 'text.secondary', fontWeight: 400, minHeight: 24, minWidth: 0, overflow: 'hidden', px: 0.75, textOverflow: 'ellipsis' }}>{mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`}</Button>
            <Typography color="text.secondary" sx={{ flexShrink: 0 }} variant="body2">!{mergeRequest.iid}</Typography>
          </Stack>
          <Tooltip title={pinnedNow ? 'MRの固定を解除' : 'MRを固定'}><IconButton aria-label={pinnedNow ? 'MRの固定を解除' : 'MRを固定'} color={pinnedNow ? 'primary' : 'default'} onClick={() => workspace.togglePinned({ projectId: resourceId, iid })}>{pinnedNow ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}</IconButton></Tooltip>
          <Tooltip title={currentResult.refreshing ? '更新中…' : '最新の状態を取得'}><span><IconButton aria-label="更新" disabled={currentResult.refreshing} onClick={() => currentResult.refresh()}><RefreshRoundedIcon /></IconButton></span></Tooltip>
          <Tooltip title="GitLabで開く"><IconButton aria-label="GitLabで開く" onClick={() => void openInGitLab()}><LaunchRoundedIcon /></IconButton></Tooltip>
          <Box sx={{ pl: 0.75 }}>
            {approvalsResult.error ? <Tooltip title={`承認状態を取得できませんでした: ${approvalsResult.error.message}`}><span><Button disabled variant="outlined">承認不可</Button></span></Tooltip>
              : <Button disabled={approvalDisabled} onClick={() => void toggleApproval()} startIcon={myApproved ? <UndoRoundedIcon /> : <CheckRoundedIcon />} variant={myApproved ? 'outlined' : 'contained'}>{approvalsResult.loading && !approvals ? '承認状態を確認中…' : myApproved ? '自分の承認を取り消す' : '承認する'}</Button>}
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mt: 0.75 }}>
          <Typography component="h1" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }} variant="h1">{mergeRequest.title}</Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.25, flexWrap: 'wrap', mt: 0.75, rowGap: 0.5 }}>
          <StatusPill label={formatMergeRequestState(mergeRequest.state)} size="small" tone={mergeRequestStateTone(mergeRequest.state)} />
          {mergeRequest.draft ? <Chip label="Draft" size="small" variant="outlined" /> : null}
          <Typography color="text.secondary" variant="caption"><Box component="span" sx={{ color: 'text.primary' }}>{mergeRequest.author.name}</Box></Typography>
          <RelativeTime prefix="更新" value={mergeRequest.updatedAt} />
          <Typography color="text.secondary" sx={{ fontFamily: 'typography.code.fontFamily', fontSize: 12, overflowWrap: 'anywhere' }} variant="caption">{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography>
          {mergeRequest.headSha ? <Tooltip title="headのSHAをコピー"><Chip icon={<ContentCopyRoundedIcon />} label={shortSha(mergeRequest.headSha)} onClick={() => void navigator.clipboard?.writeText(mergeRequest.headSha ?? '')} size="small" sx={{ fontFamily: 'typography.code.fontFamily' }} variant="outlined" /></Tooltip> : null}
          {mergeRequest.pipeline ? <PipelineStatus status={mergeRequest.pipeline.status} /> : null}
          {approvedBy.length ? <Tooltip title={approvedBy.map((user) => user.name).join('、')}><Typography color="success.main" variant="caption">{approvedBy.length}人が承認済み</Typography></Tooltip> : null}
        </Stack>
        {mergeRequest.assignees?.length || mergeRequest.reviewers?.length ? <Typography color="text.secondary" component="div" sx={{ mt: 0.5 }} variant="caption">
          {mergeRequest.assignees?.length ? `担当: ${mergeRequest.assignees.map((user) => user.name).join('、')}` : ''}{mergeRequest.assignees?.length && mergeRequest.reviewers?.length ? '　' : ''}{mergeRequest.reviewers?.length ? `レビュー: ${mergeRequest.reviewers.map((user) => user.name).join('、')}` : ''}
        </Typography> : null}
        {currentResult.stale ? <Typography color="text.secondary" component="div" variant="caption">保存済みのMR概要を表示中 · {formatFetchedAt(currentResult.snapshot?.fetchedAt)}</Typography> : null}
        <Tabs aria-label="MR詳細" onChange={(_, value: ReviewTab) => { setActiveTab(value); setReplyDiscussion(null) }} sx={{ mb: '-1px', mt: 0.5 }} value={activeTab}>
          <Tab label={<Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><span>議論</span>{unresolvedCount > 0 ? <Chip aria-label={`未解決${unresolvedCount}件`} color="warning" label={unresolvedCount} size="small" sx={{ height: 18, minWidth: 18 }} variant="outlined" /> : null}</Stack>} value="discussion" />
          <Tab label="変更" value="changes" />
          <Tab label="概要" value="overview" />
        </Tabs>
      </Box>

      <Stack spacing={1} sx={{ px: { md: 3, xs: 2 }, py: 2 }}>
        {positionError ? <Alert severity="warning">{positionError}</Alert> : null}
        {mutation.error ? <Alert action={mutation.status === 'unknown' ? <Button color="inherit" disabled={verifyingUnknown} onClick={() => { if (!mutation.unknownAction) void retryUnknownReceipt(); else if (verificationReady) void acknowledgeVerifiedOutcome(); else void verifyUnknownOutcome() }}>{verifyingUnknown ? '確認中…' : !mutation.unknownAction ? '確認記録を再取得' : verificationReady ? '再取得結果を確認した' : 'サーバーから再取得'}</Button> : undefined} severity={mutation.status === 'unknown' ? 'warning' : 'error'}>{mutation.status === 'unknown' ? verificationReady ? '最新状態を再取得しました。結果を画面で確認してから再送停止を解除してください。' : '投稿結果を確認できないため、このMRへの再送を停止しています。' : mutation.error.message}</Alert> : null}
        {verificationError ? <Alert severity="error">確認用の再取得に失敗しました: {verificationError}</Alert> : null}
        {activeTab === 'discussion' ? <Box sx={{ maxWidth: 960, width: '100%' }}><DiscussionTab composerKey={createComposerBufferKey(session, resourceId, iid, replyDiscussion?.id ?? 'new', commentPosition)} currentUserId={session?.user.id ?? ''} discussions={discussions} unreadNoteIds={unreadNoteIds} onMarkRead={(notes) => workspace.markRead({ projectId: resourceId, iid }, notes)} onOpenPosition={openCommentPosition} discussionError={discussionWindow.error} older={{ error: discussionWindow.olderError?.message ?? null, hasOlder: discussionWindow.hasOlder, limitReached: discussionWindow.limitReached, loading: discussionWindow.loadingOlder, onLoad: discussionWindow.loadOlder, onRetry: discussionWindow.retryOlder }} draftEdit={draftEdit} draftError={draftsResult.error} draftLoading={draftsResult.loading} draftNextPage={draftsResult.snapshot?.nextPage ?? null} draftStatuses={draftStatuses} drafts={drafts} loading={discussionWindow.loading} mutationLocked={mutation.isLocked} mutationPending={mutation.isPending} onDeleteDraft={deleteDraft} onDeleteNote={deleteNote} onEditDraft={editDraft} onEditNote={editNote} onNextDraftPage={() => setDraftPage((current) => current + 1)} onPublishDraft={publishDraft} onPublishSelectedDrafts={publishSelectedDrafts} onReply={setReplyDiscussion} onResolve={resolveDiscussion} onSaveDraft={saveDraft} onSelectDraft={(id) => setSelectedDrafts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSetDraftEdit={setDraftEdit} onSubmitComment={submitComment} onCancelReply={() => setReplyDiscussion(null)} onClearPosition={() => setPosition(undefined)} position={commentPosition} replyDiscussion={replyDiscussion} selectedDrafts={selectedDrafts} /></Box> : null}
        {discussionWindow.observers}
        {activeTab === 'changes' ? <ChangesTab allowComments={!selectedCommit} changeNextPage={selectedCommit ? commitDiffResult.snapshot?.nextPage ?? null : diffsResult.snapshot?.nextPage ?? null} changePage={changePage} changesError={selectedCommit ? commitDiffResult.error : diffsResult.error} changesLoading={Boolean(pendingFileTarget) || (selectedCommit ? commitDiffResult.loading : diffsResult.loading)} commitNextPage={commitsResult.snapshot?.nextPage ?? null} commits={commits} commitsError={commitsResult.error} commitsLoading={commitsResult.loading} diffs={pendingFileTarget ? [] : diffs} fileResult={fileResult} fileView={fileView} onComment={(nextPosition) => { setViewPosition(undefined); setPosition(normalizePosition(nextPosition, mergeRequest)); setPositionError(null); setActiveTab('discussion') }} onNextChangePage={() => setChangePage((current) => current + 1)} onNextCommitPage={() => setCommitPage((current) => current + 1)} onSelectCommit={(sha) => { setSelectedCommit(sha); setSelectedFile(null); setFileView('diff'); setChangePage(1); setCommitPage(1) }} onSelectFile={setSelectedFile} onViewChange={setFileView} selectedCommit={selectedCommit} selectedFile={selectedFile} selectedPosition={viewPosition ?? commentPosition} /> : null}
        {activeTab === 'overview' ? <OverviewTab approvedBy={approvedBy} approvalsError={approvalsResult.error} approvalsLoading={approvalsResult.loading} description={mergeRequest.description} mergeRequest={mergeRequest} /> : null}
      </Stack>
    </Box>
  )
}

function DiscussionTab({ composerKey, currentUserId, unreadNoteIds, onMarkRead, onOpenPosition, discussionError, older, discussions, draftEdit, draftError, draftLoading, draftNextPage, draftStatuses, drafts, loading, mutationLocked, mutationPending, onCancelReply, onClearPosition, onDeleteDraft, onDeleteNote, onEditDraft, onEditNote, onNextDraftPage, onPublishDraft, onPublishSelectedDrafts, onReply, onResolve, onSaveDraft, onSelectDraft, onSetDraftEdit, onSubmitComment, position, replyDiscussion, selectedDrafts }: DiscussionTabProps) {
  const { session } = useConnection()
  const mutationDisabled = mutationLocked || mutationPending
  return (
    <Stack spacing={0.75}>
      {discussionError && !discussions.length ? <Alert severity="error">{discussionError.message}</Alert> : null}
      {discussionError && discussions.length ? <Alert severity="warning">保存済みの議論を表示中です。更新に失敗しました: {discussionError.message}</Alert> : null}
      {loading && !discussions.length ? <LoadingPanel label="議論を読み込み中…" /> : null}
      {(!loading || discussions.length) && (!discussionError || discussions.length) ? <DiscussionList older={older} sessionId={session?.id ?? null} unreadNoteIds={unreadNoteIds} onMarkRead={onMarkRead} onOpenPosition={onOpenPosition} replyDiscussionId={replyDiscussion?.id} currentUserId={currentUserId} disabled={mutationDisabled} discussions={discussions} onDelete={onDeleteNote} onEdit={onEditNote} onReply={onReply} onResolve={onResolve} /> : null}
      {draftError && !drafts.length ? <Alert severity="error">下書きを取得できませんでした: {draftError.message}</Alert> : null}
      {draftError && drafts.length ? <Alert severity="warning">保存済みの下書きを表示中です。更新に失敗しました: {draftError.message}</Alert> : null}
      {draftLoading && !drafts.length ? <LoadingPanel label="下書きを読み込み中…" /> : null}
      {(!draftLoading || drafts.length) && (!draftError || drafts.length) ? <DraftList disabled={mutationDisabled} draftEdit={draftEdit} drafts={drafts} nextPage={draftNextPage} statuses={draftStatuses} selected={selectedDrafts} onDelete={onDeleteDraft} onEdit={onEditDraft} onNextPage={onNextDraftPage} onPublish={onPublishDraft} onPublishSelected={onPublishSelectedDrafts} onSelect={onSelectDraft} onSetEdit={onSetDraftEdit} /> : null}
      <BufferedReviewComposer enableMentions={Boolean(currentUserId)} key={composerKey} bufferKey={composerKey} disabled={mutationLocked} onCancelReply={onCancelReply} onClearPosition={onClearPosition} onSaveDraft={onSaveDraft} onSubmitComment={onSubmitComment} pending={mutationPending} replyAuthor={replyDiscussion?.notes.find((note) => !note.system)?.author.name} replyDiscussionId={replyDiscussion?.id} targetPosition={position} />
    </Stack>
  )
}

interface DiscussionTabProps {
  unreadNoteIds: string[]
  onMarkRead: (notes: Note[]) => void
  onOpenPosition: (position: Position) => void
  composerKey: string
  currentUserId: string
  discussionError: Error | null
  older: OlderDiscussions
  discussions: Discussion[]
  draftEdit: { id: string; body: string } | null
  draftError: Error | null
  draftLoading: boolean
  draftNextPage: number | null
  draftStatuses: Record<string, DraftStatus>
  drafts: Draft[]
  loading: boolean
  mutationLocked: boolean
  mutationPending: boolean
  onCancelReply: () => void
  onClearPosition: () => void
  onDeleteDraft: (draft: Draft) => Promise<boolean>
  onDeleteNote: (note: Note) => Promise<boolean>
  onEditDraft: (draft: Draft, body: string) => Promise<boolean>
  onEditNote: (note: Note, body: string) => Promise<boolean>
  onNextDraftPage: () => void
  onPublishDraft: (draft: Draft) => Promise<boolean>
  onPublishSelectedDrafts: () => Promise<void>
  onReply: (discussion: Discussion) => void
  onResolve: (discussion: Discussion, resolved: boolean) => Promise<boolean>
  onSaveDraft: (body: string, position?: Position) => Promise<boolean>
  onSelectDraft: (id: string) => void
  onSetDraftEdit: (value: { id: string; body: string } | null) => void
  onSubmitComment: (body: string, thread: boolean, position?: Position) => Promise<boolean>
  position?: Position
  replyDiscussion: Discussion | null
  selectedDrafts: string[]
}

export function BufferedReviewComposer(props: Omit<React.ComponentProps<typeof ReviewComposer>, 'onChange' | 'value'> & { bufferKey: string }) {
  const { session } = useConnection()
  const { body, change, discard, error, persistenceStatus } = useComposerBuffer(props.bufferKey, session?.id ?? null)
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
  return <Stack spacing={0.5}><ReviewComposer {...props} disabled={props.disabled || submitting} onChange={change} onSaveDraft={onSaveDraft} onSubmitComment={onSubmitComment} pending={props.pending || submitting} value={body} />{body ? <Button color="inherit" disabled={props.disabled || props.pending || submitting} onClick={discard} size="small" sx={{ alignSelf: 'flex-end' }}>入力を破棄</Button> : null}{persistenceLabel ? <Typography color="text.secondary" variant="caption">{persistenceLabel}</Typography> : null}{error ? <Alert severity="warning">{error}</Alert> : null}{flushError ? <Alert severity="warning">{flushError}</Alert> : null}</Stack>
}

function DraftList({ disabled, drafts, draftEdit, nextPage, onDelete, onEdit, onNextPage, onPublish, onPublishSelected, onSelect, onSetEdit, selected, statuses }: { disabled: boolean; drafts: Draft[]; draftEdit: { id: string; body: string } | null; nextPage: number | null; onDelete: (draft: Draft) => Promise<boolean>; onEdit: (draft: Draft, body: string) => Promise<boolean>; onNextPage: () => void; onPublish: (draft: Draft) => Promise<boolean>; onPublishSelected: () => Promise<void>; onSelect: (id: string) => void; onSetEdit: (value: { id: string; body: string } | null) => void; selected: string[]; statuses: Record<string, DraftStatus> }) {
  if (!drafts.length) return null
  const selectedDrafts = drafts.filter((draft) => selected.includes(draft.id))
  return (
    <Paper component="section" aria-labelledby="draft-list-title" sx={{ p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><PublishRoundedIcon color="primary" fontSize="small" /><Typography component="h2" id="draft-list-title" sx={{ fontWeight: 700 }} variant="body2">未公開レビュー</Typography><Chip label={`${drafts.length}件`} size="small" variant="outlined" /><Typography color="text.secondary" sx={{ ml: 'auto' }} variant="caption">Webで作成された下書きを暗黙に公開しません</Typography></Stack>
        <List disablePadding>
          {drafts.map((draft) => {
            const status = statuses[draft.id] ?? 'idle'
            return <ListItem key={draft.id} disableGutters secondaryAction={<Stack direction="row" spacing={0.25}><Tooltip title="下書きを公開"><IconButton aria-label={`${draft.id}を公開`} disabled={disabled || status === 'pending' || status === 'unknown'} onClick={() => void onPublish(draft)} size="small"><PublishRoundedIcon fontSize="small" /></IconButton></Tooltip><Tooltip title="下書きを削除"><IconButton aria-label={`${draft.id}を削除`} disabled={disabled || status === 'pending'} onClick={() => { if (globalThis.confirm('この下書きを削除しますか？')) void onDelete(draft) }} size="small"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip></Stack>}><Checkbox checked={selected.includes(draft.id)} disabled={disabled} onChange={() => onSelect(draft.id)} size="small" /><ListItemText primary={draftEdit?.id === draft.id ? <Stack direction="row" spacing={0.75}><TextField autoFocus disabled={disabled} fullWidth multiline minRows={2} onChange={(event) => onSetEdit({ body: event.target.value, id: draft.id })} value={draftEdit.body} /><Button disabled={disabled || !draftEdit.body.trim()} onClick={() => void onEdit(draft, draftEdit.body.trim())} size="small" variant="contained">保存</Button></Stack> : <Button disabled={disabled} onClick={() => onSetEdit({ body: draft.body, id: draft.id })} sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none' }} fullWidth>{draft.body}</Button>} secondary={status === 'unknown' ? '結果不明 · 更新して確認してください' : status === 'success' ? '公開済み' : status === 'error' ? '公開に失敗しました' : draft.discussionId ? '既存スレッドへの下書き' : '新規コメント'} /></ListItem>
          })}
        </List>
        {selectedDrafts.length > 0 ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography color="text.secondary" sx={{ mr: 'auto' }} variant="caption">選択中 {selectedDrafts.length}件 · 公開は一件ずつ実行されます</Typography><Button disabled={disabled} onClick={() => void onPublishSelected()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">選択を公開</Button></Stack> : null}
        {nextPage !== null ? <Button onClick={onNextPage} size="small" sx={{ alignSelf: 'flex-start' }} variant="outlined">下書きの次ページ</Button> : null}
      </Stack>
    </Paper>
  )
}

type DraftStatus = 'idle' | 'pending' | 'success' | 'error' | 'unknown'

function ChangesTab({ allowComments, changeNextPage, changePage, changesError, changesLoading, commitNextPage, commits, commitsError, commitsLoading, diffs, fileResult, fileView, onComment, onNextChangePage, onNextCommitPage, onSelectCommit, onSelectFile, onViewChange, selectedCommit, selectedFile, selectedPosition }: { allowComments: boolean; changeNextPage: number | null; changePage: number; changesError: Error | null; changesLoading: boolean; commitNextPage: number | null; commits: Commit[]; commitsError: Error | null; commitsLoading: boolean; diffs: Diff[]; fileResult: { data: { content: string } | null; loading: boolean; error: Error | null }; fileView: 'diff' | 'file'; onComment: (position: Position) => void; onNextChangePage: () => void; onNextCommitPage: () => void; onSelectCommit: (sha: string | null) => void; onSelectFile: (path: string) => void; onViewChange: (view: 'diff' | 'file') => void; selectedCommit: string | null; selectedFile: string | null; selectedPosition?: Position }) {
  return (
    <Stack spacing={1.25}>
      {commitsError && !commits.length ? <Alert severity="error">コミットを取得できませんでした: {commitsError.message}</Alert> : null}
      {commitsError && commits.length ? <Alert severity="warning">保存済みのコミットを表示中です。更新に失敗しました: {commitsError.message}</Alert> : null}
      {!commitsError || commits.length ? <CommitTimeline commits={commits} loading={commitsLoading} nextPage={commitNextPage} onNextPage={onNextCommitPage} onSelect={onSelectCommit} selected={selectedCommit} /> : null}
      {changesError && !diffs.length ? <Alert severity="error">差分を取得できませんでした: {changesError.message}</Alert> : null}
      {changesError && diffs.length ? <Alert severity="warning">保存済みの差分を表示中です。更新に失敗しました: {changesError.message}</Alert> : null}
      {changesLoading && !diffs.length ? <LoadingPanel label="変更を読み込み中…" /> : null}
      {(!changesLoading || diffs.length) && (!changesError || diffs.length) ? <DiffViewer key={`${selectedCommit ?? 'mr'}:${selectedFile ?? ''}`} allowComments={allowComments} diffs={diffs} fileContent={fileResult.data?.content} fileLoading={fileResult.loading} onComment={onComment} onSelectFile={onSelectFile} onViewChange={onViewChange} selectedFile={selectedFile} selectedPosition={selectedPosition} view={fileView} /> : null}
      {fileResult.error ? <Alert severity="error">ファイル全体を取得できませんでした: {fileResult.error.message}</Alert> : null}
      {changeNextPage !== null || changePage > 1 ? <Stack direction="row" sx={{ justifyContent: 'flex-end' }}><Button disabled={changeNextPage === null} onClick={onNextChangePage} size="small">差分の次ページ</Button><Typography color="text.secondary" sx={{ alignSelf: 'center', ml: 1 }} variant="caption">ページ {changePage}</Typography></Stack> : null}
    </Stack>
  )
}

function CommitTimeline({ commits, loading, nextPage, onNextPage, onSelect, selected }: { commits: Commit[]; loading: boolean; nextPage: number | null; onNextPage: () => void; onSelect: (sha: string | null) => void; selected: string | null }) {
  const item = (active: boolean) => ({ bgcolor: active ? 'surface.selected' : 'transparent', border: 1, borderColor: active ? 'primary.main' : 'divider', borderRadius: 1, color: active ? 'text.primary' : 'text.secondary', flexShrink: 0, fontWeight: active ? 600 : 400, minHeight: 28, px: 1, '&:hover': { bgcolor: active ? 'surface.selected' : 'action.hover', borderColor: active ? 'primary.main' : 'surface.borderStrong' } })
  return <Box aria-label="比較対象" role="group" sx={{ overflowX: 'auto', pb: 0.5 }}><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 'max-content' }}>
    <Button aria-pressed={selected === null} color="inherit" onClick={() => onSelect(null)} sx={item(selected === null)}>MR全体</Button>
    {loading ? <Typography color="text.secondary" sx={{ px: 1 }} variant="caption">コミットを読み込み中…</Typography> : commits.map((commit) => <Tooltip key={commit.id} title={commit.title}><Button aria-pressed={selected === commit.id} color="inherit" onClick={() => onSelect(commit.id)} sx={{ ...item(selected === commit.id), justifyContent: 'flex-start', maxWidth: 260 }}><Box component="span" sx={{ color: 'primary.main', fontFamily: 'typography.code.fontFamily', fontSize: 12, flexShrink: 0, mr: 0.75 }}>{shortSha(commit.id)}</Box><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.title}</Box></Button></Tooltip>)}
    {nextPage !== null ? <Button onClick={onNextPage}>次のコミット</Button> : null}
  </Stack></Box>
}

function OverviewTab({ approvedBy, approvalsError, approvalsLoading, description, mergeRequest }: { approvedBy: GitLabUser[]; approvalsError: Error | null; approvalsLoading: boolean; description: string; mergeRequest: MergeRequest }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['作成者', `${mergeRequest.author.name} @${mergeRequest.author.username}`],
    ['ブランチ', <Box component="span" key="branch" sx={{ fontFamily: 'typography.code.fontFamily', fontSize: 12 }}>{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Box>],
    ['担当', mergeRequest.assignees?.length ? mergeRequest.assignees.map((user) => user.name).join('、') : 'なし'],
    ['レビュアー', mergeRequest.reviewers?.length ? mergeRequest.reviewers.map((user) => user.name).join('、') : 'なし'],
    ['承認', approvalsLoading ? '承認状態を確認中…' : approvalsError ? `承認状態を利用できません: ${approvalsError.message}` : approvedBy.length ? `${approvedBy.length}人が承認済み（${approvedBy.map((user) => user.name).join('、')}）` : '未承認'],
    ['ラベル', mergeRequest.labels?.length ? <Stack direction="row" key="labels" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>{mergeRequest.labels.map((label) => <Chip key={label} label={label} size="small" variant="outlined" />)}</Stack> : 'なし'],
  ]
  return <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { lg: 'minmax(0, 1fr) 280px', xs: '1fr' }, maxWidth: 1200 }}>
    <Box sx={{ minWidth: 0 }}>
      <Typography color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="overline">説明</Typography>
      <MockMarkdown body={description || '説明はありません。'} />
    </Box>
    <Box component="dl" sx={{ alignContent: 'start', display: 'grid', gap: 1.25, m: 0 }}>
      {rows.map(([label, value]) => <Box key={label}><Typography color="text.secondary" component="dt" variant="caption">{label}</Typography><Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }} variant="body2">{value}</Typography></Box>)}
    </Box>
  </Box>
}

function LoadingPanel({ label }: { label: string }) { return <Typography color="text.secondary" role="status" sx={{ py: 2 }} variant="body2">{label}</Typography> }

function normalizePosition(position: Position, mergeRequest: MergeRequest): Position {
  return { ...position, baseSha: mergeRequest.diffRefs?.baseSha ?? position.baseSha, headSha: mergeRequest.diffRefs?.headSha ?? position.headSha, startSha: mergeRequest.diffRefs?.startSha ?? position.startSha }
}

function isPositionCurrent(position: Position, mergeRequest: MergeRequest): boolean {
  const currentHead = mergeRequest.diffRefs?.headSha ?? mergeRequest.headSha
  return Boolean(currentHead && position.headSha && currentHead === position.headSha)
}

function formatFetchedAt(timestamp?: number): string { if (!timestamp) return '時刻不明'; return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp) }
function compareNotesByTime(left: Note, right: Note): number {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  return (Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime) - (Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime) || left.id.localeCompare(right.id)
}
