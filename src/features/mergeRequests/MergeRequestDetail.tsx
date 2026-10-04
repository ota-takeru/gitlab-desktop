import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import MoreTimeRoundedIcon from '@mui/icons-material/MoreTimeRounded'
import PublishRoundedIcon from '@mui/icons-material/PublishRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
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
import { useEffect, useId, useMemo, useState } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { createRequestId, normalizeGitLabError, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import type {
  Approvals,
  Commit,
  DiffsQuery,
  Diff,
  Discussion,
  Draft,
  FileQuery,
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
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { clearGitLabMutationStates, useGitLabMutation } from '../shared/useGitLabMutation'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { DiscussionList } from './DiscussionList'
import { DiffViewer } from './DiffViewer'
import { ReviewComposer } from './ReviewComposer'
import { clearComposerBufferStore, createComposerBufferKey, useComposerBuffer } from './useComposerBuffer'

type ReviewTab = 'discussion' | 'changes' | 'overview'
type DiscussionsQuery = ReviewResourceQuery & { kind: 'discussions' }
type CommitsQuery = ReviewResourceQuery & { kind: 'commits' }
type DraftsQuery = ReviewResourceQuery & { kind: 'drafts' }

/** Clear in-memory composer text when a workspace/session is disposed. */
export function clearComposerBuffers(): void {
  clearComposerBufferStore()
  clearGitLabMutationStates()
}

export interface MergeRequestDetailProps {
  initialMergeRequest: MergeRequest
  onBack: () => void
  onOpenProject?: () => void
}

export function MergeRequestDetail({ initialMergeRequest, onBack, onOpenProject }: MergeRequestDetailProps) {
  const { session } = useConnection()
  const [activeTab, setActiveTab] = useState<ReviewTab>('discussion')
  const [discussionPage, setDiscussionPage] = useState(1)
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

  const discussionsQuery = useMemo<DiscussionsQuery | null>(() => activeTab === 'discussion' ? ({ iid, kind: 'discussions', page: discussionPage, projectId: resourceId } as DiscussionsQuery) : null, [activeTab, discussionPage, iid, resourceId])
  const diffsQuery = useMemo<DiffsQuery | null>(() => activeTab === 'changes' && !selectedCommit && mergeRequestHeadSha ? ({ headSha: mergeRequestHeadSha, iid, kind: 'diffs', page: changePage, projectId: resourceId } as DiffsQuery) : null, [activeTab, changePage, iid, resourceId, selectedCommit, mergeRequestHeadSha])
  const commitDiffQuery = useMemo<CommitDiffQuery | null>(() => activeTab === 'changes' && selectedCommit ? ({ iid, kind: 'commitDiff', page: changePage, projectId: resourceId, sha: selectedCommit } as CommitDiffQuery) : null, [activeTab, changePage, iid, resourceId, selectedCommit])
  const commitsQuery = useMemo<CommitsQuery | null>(() => activeTab === 'changes' ? ({ iid, kind: 'commits', page: commitPage, projectId: resourceId } as CommitsQuery) : null, [activeTab, commitPage, iid, resourceId])
  const draftQuery = useMemo<DraftsQuery | null>(() => activeTab === 'discussion' ? ({ iid, kind: 'drafts', page: draftPage, projectId: resourceId } as DraftsQuery) : null, [activeTab, draftPage, iid, resourceId])
  const approvalsQuery = useMemo<ApprovalsQuery | null>(() => activeTab === 'overview' ? ({ iid, kind: 'approvals', projectId: resourceId } as ApprovalsQuery) : null, [activeTab, iid, resourceId])

  const discussionsResult = useGitLabQuery<DiscussionsQuery>(session?.id ?? null, discussionsQuery)
  const diffsResult = useGitLabQuery<DiffsQuery>(session?.id ?? null, diffsQuery)
  const commitDiffResult = useGitLabQuery<CommitDiffQuery>(session?.id ?? null, commitDiffQuery)
  const commitsResult = useGitLabQuery<CommitsQuery>(session?.id ?? null, commitsQuery)
  const draftsResult = useGitLabQuery<DraftsQuery>(session?.id ?? null, draftQuery)
  const approvalsResult = useGitLabQuery<ApprovalsQuery>(session?.id ?? null, approvalsQuery)

  const diffs = (selectedCommit ? (commitDiffResult.data ?? []) : (diffsResult.data ?? [])) as Diff[]
  const commits = (commitsResult.data ?? []) as Commit[]
  const discussions = (discussionsResult.data ?? []) as Discussion[]
  const drafts = (draftsResult.data ?? []) as Draft[]
  const approvals = approvalsResult.data as Approvals | null
  const selectedDiff = diffs.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? diffs[0]
  const fileSha = selectedCommit ?? mergeRequest?.headSha
  const fileQuery = useMemo<FileQuery | null>(() => activeTab === 'changes' && fileView === 'file' && selectedDiff && fileSha ? ({ kind: 'file', path: selectedDiff.newPath || selectedDiff.oldPath, projectId: resourceId, sha: fileSha }) : null, [activeTab, fileSha, fileView, resourceId, selectedDiff])
  const fileResult = useGitLabQuery<FileQuery>(session?.id ?? null, fileQuery)

  if (!mergeRequest) {
    return <Stack spacing={1.5}><Button onClick={onBack} size="small" startIcon={<ArrowBackRoundedIcon />}>一覧に戻る</Button><Alert severity="error">このMRは現在の接続先または権限では表示できません。保存済みの内容は表示しません。</Alert></Stack>
  }

  const runAction = async (action: GitLabAction, refresh?: () => void) => {
    const success = await mutation.run(action)
    if (success) refresh?.()
    return success
  }

  const commentPosition = position
  const submitComment = async (body: string, thread: boolean, targetPosition?: Position) => {
    if (targetPosition && !isPositionCurrent(targetPosition, mergeRequest)) {
      setPositionError('MRのheadが変わったため、この行位置は古くなっています。差分を更新して行を選び直してください。')
      return false
    }
    setPositionError(null)
    if (replyDiscussion) {
      const success = await runAction({ body, discussionId: replyDiscussion.id, iid, kind: 'reply', projectId: resourceId }, discussionsResult.refresh)
      if (success) setReplyDiscussion(null)
      return success
    }
    return runAction({ body, iid, kind: 'comment', position: targetPosition, projectId: resourceId, thread: thread || Boolean(targetPosition) }, discussionsResult.refresh)
  }
  const saveDraft = async (body: string, targetPosition?: Position) => {
    if (targetPosition && !isPositionCurrent(targetPosition, mergeRequest)) {
      setPositionError('MRのheadが変わったため、この行位置は古くなっています。差分を更新して行を選び直してください。')
      return false
    }
    setPositionError(null)
    const action = { body, discussionId: replyDiscussion?.id, iid, kind: 'saveDraft' as const, position: targetPosition, projectId: resourceId }
    const success = await runAction(action, draftsResult.refresh)
    if (success) setReplyDiscussion(null)
    return success
  }

  const editNote = (note: Note, body: string) => runAction({ body, iid, kind: 'editNote', noteId: note.id, projectId: resourceId }, discussionsResult.refresh)
  const deleteNote = (note: Note) => runAction({ iid, kind: 'deleteNote', noteId: note.id, projectId: resourceId }, discussionsResult.refresh)
  const resolveDiscussion = (discussion: Discussion, resolved: boolean) => runAction({ discussionId: discussion.id, iid, kind: 'resolve', projectId: resourceId, resolved }, discussionsResult.refresh)

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
        queries.push({ iid, kind: 'discussions', page: 1, projectId: resourceId })
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
      await Promise.all(queries.map((query, index) => queryGitLab({
        mode: 'network',
        query,
        requestId: createRequestId(`verify-${index}`),
        sessionId: session.id,
      })))
      currentResult.refresh()
      switch (unknownAction.kind) {
        case 'comment':
        case 'reply':
        case 'editNote':
        case 'deleteNote':
        case 'resolve':
          discussionsResult.refresh()
          break
        case 'saveDraft':
        case 'editDraft':
        case 'deleteDraft':
        case 'publishDraft':
          draftsResult.refresh()
          break
        case 'approve':
        case 'unapprove':
          approvalsResult.refresh()
          break
      }
      setVerificationReady(true)
    } catch (caught) {
      setVerificationError(normalizeGitLabError(caught).message)
    } finally {
      setVerifyingUnknown(false)
    }
  }

  return (
    <Box component="main" sx={{ minHeight: '100%', maxWidth: 1240, mx: 'auto' }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Button onClick={onBack} size="small" startIcon={<ArrowBackRoundedIcon />}>一覧に戻る</Button>
          <Stack direction="row" spacing={0.75}>
            <Button onClick={() => currentResult.refresh()} size="small" startIcon={<RefreshRoundedIcon />} variant="outlined">更新</Button>
            <Button onClick={() => void openInGitLab()} size="small" startIcon={<LaunchRoundedIcon />} variant="outlined">GitLabで開く</Button>
          </Stack>
        </Stack>
        <Paper component="header" sx={{ p: { md: 2, xs: 1.5 } }} variant="outlined">
          <Stack spacing={1}>
            <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
              <Typography component="h1" sx={{ flex: 1, minWidth: 0 }} variant="h2">{mergeRequest.title}</Typography>
              <Chip color={mergeRequest.state === 'merged' ? 'info' : mergeRequest.state === 'opened' || mergeRequest.state === 'open' ? 'success' : 'default'} label={formatState(mergeRequest.state)} size="small" />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Button onClick={onOpenProject} size="small" variant="text">プロジェクト {mergeRequest.projectId}</Button>
              <Typography color="text.secondary" variant="caption">!{mergeRequest.iid} · {mergeRequest.sourceBranch} → {mergeRequest.targetBranch} · {mergeRequest.author.name}</Typography>
              {mergeRequest.headSha ? <Chip icon={<ContentCopyRoundedIcon />} label={`head ${shortSha(mergeRequest.headSha)}`} onClick={() => void navigator.clipboard?.writeText(mergeRequest.headSha ?? '')} size="small" variant="outlined" /> : null}
            </Stack>
            {currentResult.stale ? <Typography color="text.secondary" variant="caption">保存済みのMR概要を表示中 · {formatFetchedAt(currentResult.snapshot?.fetchedAt)}</Typography> : null}
          </Stack>
        </Paper>

        <Tabs aria-label="MR詳細" onChange={(_, value: ReviewTab) => { setActiveTab(value); setReplyDiscussion(null) }} value={activeTab}>
          <Tab icon={<CommentOutlinedIcon fontSize="small" />} iconPosition="start" label="議論" value="discussion" />
          <Tab icon={<MoreTimeRoundedIcon fontSize="small" />} iconPosition="start" label="変更" value="changes" />
          <Tab icon={<CheckCircleOutlineRoundedIcon fontSize="small" />} iconPosition="start" label="概要" value="overview" />
        </Tabs>

        {activeTab === 'discussion' ? <DiscussionTab composerKey={createComposerBufferKey(session, resourceId, iid, replyDiscussion?.id ?? 'new', commentPosition)} currentUserId={session?.user.id ?? ''} discussions={discussions} discussionError={discussionsResult.error} discussionNextPage={discussionsResult.snapshot?.nextPage ?? null} draftEdit={draftEdit} draftError={draftsResult.error} draftLoading={draftsResult.loading} draftNextPage={draftsResult.snapshot?.nextPage ?? null} draftStatuses={draftStatuses} drafts={drafts} loading={discussionsResult.loading} mutationLocked={mutation.isLocked} mutationPending={mutation.isPending} onDeleteDraft={deleteDraft} onDeleteNote={deleteNote} onEditDraft={editDraft} onEditNote={editNote} onNextDiscussionPage={() => setDiscussionPage((current) => current + 1)} onNextDraftPage={() => setDraftPage((current) => current + 1)} onPublishDraft={publishDraft} onPublishSelectedDrafts={publishSelectedDrafts} onReply={setReplyDiscussion} onResolve={resolveDiscussion} onSaveDraft={saveDraft} onSelectDraft={(id) => setSelectedDrafts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSetDraftEdit={setDraftEdit} onSubmitComment={submitComment} onCancelReply={() => setReplyDiscussion(null)} onClearPosition={() => setPosition(undefined)} position={commentPosition} replyDiscussion={replyDiscussion} selectedDrafts={selectedDrafts} /> : null}
        {activeTab === 'changes' ? <ChangesTab allowComments={!selectedCommit} changeNextPage={selectedCommit ? commitDiffResult.snapshot?.nextPage ?? null : diffsResult.snapshot?.nextPage ?? null} changePage={changePage} changesError={selectedCommit ? commitDiffResult.error : diffsResult.error} changesLoading={selectedCommit ? commitDiffResult.loading : diffsResult.loading} commitNextPage={commitsResult.snapshot?.nextPage ?? null} commits={commits} commitsError={commitsResult.error} commitsLoading={commitsResult.loading} diffs={diffs} fileResult={fileResult} fileView={fileView} onComment={(nextPosition) => { setPosition(normalizePosition(nextPosition, mergeRequest)); setPositionError(null); setActiveTab('discussion') }} onNextChangePage={() => setChangePage((current) => current + 1)} onNextCommitPage={() => setCommitPage((current) => current + 1)} onSelectCommit={(sha) => { setSelectedCommit(sha); setSelectedFile(null); setFileView('diff'); setChangePage(1); setCommitPage(1) }} onSelectFile={setSelectedFile} onViewChange={setFileView} selectedCommit={selectedCommit} selectedFile={selectedFile} selectedPosition={commentPosition} /> : null}
        {activeTab === 'overview' ? <OverviewTab approvals={approvals} approvalsError={approvalsResult.error} approvalsLoading={approvalsResult.loading} currentUserId={session?.user.id ?? ''} description={mergeRequest.description} disabled={mutation.isLocked || mutation.isPending || !mergeRequest.headSha} onApprove={(myApproved) => mergeRequest.headSha ? runAction({ iid, kind: myApproved ? 'unapprove' : 'approve', projectId: resourceId, ...(myApproved ? {} : { sha: mergeRequest.headSha }) } as GitLabAction, approvalsResult.refresh) : Promise.resolve(false)} /> : null}
        {positionError ? <Alert severity="warning">{positionError}</Alert> : null}
        {mutation.error ? <Alert action={mutation.status === 'unknown' ? <Button disabled={verifyingUnknown} onClick={() => { if (verificationReady) { mutation.reset(); setVerificationReady(false) } else void verifyUnknownOutcome() }} size="small">{verifyingUnknown ? '確認中…' : verificationReady ? '再取得結果を確認した' : 'サーバーから再取得'}</Button> : undefined} severity={mutation.status === 'unknown' ? 'warning' : 'error'}>{mutation.status === 'unknown' ? verificationReady ? '最新状態を再取得しました。結果を画面で確認してから再送停止を解除してください。' : '投稿結果を確認できないため、このMRへの再送を停止しています。' : mutation.error.message}</Alert> : null}
        {verificationError ? <Alert severity="error">確認用の再取得に失敗しました: {verificationError}</Alert> : null}
      </Stack>
    </Box>
  )
}

function DiscussionTab({ composerKey, currentUserId, discussionError, discussionNextPage, discussions, draftEdit, draftError, draftLoading, draftNextPage, draftStatuses, drafts, loading, mutationLocked, mutationPending, onCancelReply, onClearPosition, onDeleteDraft, onDeleteNote, onEditDraft, onEditNote, onNextDiscussionPage, onNextDraftPage, onPublishDraft, onPublishSelectedDrafts, onReply, onResolve, onSaveDraft, onSelectDraft, onSetDraftEdit, onSubmitComment, position, replyDiscussion, selectedDrafts }: DiscussionTabProps) {
  const mutationDisabled = mutationLocked || mutationPending
  return (
    <Stack spacing={1.5}>
      {discussionError && !discussions.length ? <Alert severity="error">{discussionError.message}</Alert> : null}
      {discussionError && discussions.length ? <Alert severity="warning">保存済みの議論を表示中です。更新に失敗しました: {discussionError.message}</Alert> : null}
      {loading && !discussions.length ? <LoadingPanel label="議論を読み込み中…" /> : null}
      {(!loading || discussions.length) && (!discussionError || discussions.length) ? <DiscussionList currentUserId={currentUserId} disabled={mutationDisabled} discussions={discussions} onDelete={onDeleteNote} onEdit={onEditNote} onReply={onReply} onResolve={onResolve} /> : null}
      {discussionNextPage !== null ? <Button onClick={onNextDiscussionPage} size="small" sx={{ alignSelf: 'flex-start' }} variant="outlined">議論の次ページ</Button> : null}
      {draftError && !drafts.length ? <Alert severity="error">下書きを取得できませんでした: {draftError.message}</Alert> : null}
      {draftError && drafts.length ? <Alert severity="warning">保存済みの下書きを表示中です。更新に失敗しました: {draftError.message}</Alert> : null}
      {draftLoading && !drafts.length ? <LoadingPanel label="下書きを読み込み中…" /> : null}
      {(!draftLoading || drafts.length) && (!draftError || drafts.length) ? <DraftList disabled={mutationDisabled} draftEdit={draftEdit} drafts={drafts} nextPage={draftNextPage} statuses={draftStatuses} selected={selectedDrafts} onDelete={onDeleteDraft} onEdit={onEditDraft} onNextPage={onNextDraftPage} onPublish={onPublishDraft} onPublishSelected={onPublishSelectedDrafts} onSelect={onSelectDraft} onSetEdit={onSetDraftEdit} /> : null}
      <BufferedReviewComposer key={composerKey} bufferKey={composerKey} disabled={mutationLocked} onCancelReply={onCancelReply} onClearPosition={onClearPosition} onSaveDraft={onSaveDraft} onSubmitComment={onSubmitComment} pending={mutationPending} replyAuthor={replyDiscussion?.notes[0]?.author.name} replyDiscussionId={replyDiscussion?.id} targetPosition={position} />
    </Stack>
  )
}

interface DiscussionTabProps {
  composerKey: string
  currentUserId: string
  discussionError: Error | null
  discussionNextPage: number | null
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
  onNextDiscussionPage: () => void
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

function BufferedReviewComposer(props: Omit<React.ComponentProps<typeof ReviewComposer>, 'onChange' | 'value'> & { bufferKey: string }) {
  const { body, change, discard, error } = useComposerBuffer(props.bufferKey)
  return <Stack spacing={0.5}><ReviewComposer {...props} onChange={change} value={body} />{body ? <Button color="inherit" disabled={props.pending} onClick={discard} size="small" sx={{ alignSelf: 'flex-end' }}>入力を破棄</Button> : null}{error ? <Alert severity="warning">{error}</Alert> : null}</Stack>
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
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}><Button disabled={changeNextPage === null} onClick={onNextChangePage} size="small">差分の次ページ</Button><Typography color="text.secondary" sx={{ alignSelf: 'center', ml: 1 }} variant="caption">ページ {changePage}</Typography></Stack>
    </Stack>
  )
}

function CommitTimeline({ commits, loading, nextPage, onNextPage, onSelect, selected }: { commits: Commit[]; loading: boolean; nextPage: number | null; onNextPage: () => void; onSelect: (sha: string | null) => void; selected: string | null }) {
  return <Paper sx={{ overflowX: 'auto', p: 1 }} variant="outlined"><Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 'max-content' }}><Button onClick={() => onSelect(null)} size="small" variant={selected === null ? 'contained' : 'outlined'}>MR全体</Button>{loading ? <Typography color="text.secondary" variant="caption">コミットを読み込み中…</Typography> : commits.map((commit) => <Button key={commit.id} onClick={() => onSelect(commit.id)} size="small" title={commit.title} variant={selected === commit.id ? 'contained' : 'outlined'}>{shortSha(commit.id)} · {commit.title}</Button>)}{nextPage !== null ? <Button onClick={onNextPage} size="small" variant="outlined">次のコミット</Button> : null}</Stack></Paper>
}

function OverviewTab({ approvals, approvalsError, approvalsLoading, currentUserId, description, disabled, onApprove }: { approvals: Approvals | null; approvalsError: Error | null; approvalsLoading: boolean; currentUserId: string; description: string; disabled: boolean; onApprove: (myApproved: boolean) => Promise<boolean> }) {
  const myApproved = Boolean(approvals?.approvedBy.some((user) => user.id === currentUserId))
  const approvalCount = approvals?.approvedBy.length ?? 0
  return <Stack spacing={1.5}><Paper sx={{ p: 1.75 }} variant="outlined"><Typography component="h2" variant="h2">説明</Typography><Box sx={{ mt: 1 }}><MockMarkdown body={description || '説明はありません。'} /></Box></Paper><Paper sx={{ p: 1.5 }} variant="outlined"><Stack direction={{ sm: 'row', xs: 'column' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CheckCircleOutlineRoundedIcon color={approvalCount > 0 ? 'success' : 'disabled'} fontSize="small" /><Typography variant="body2">{approvalsLoading ? '承認状態を確認中…' : approvalsError ? '承認状態を利用できません' : approvalCount > 0 ? `${approvalCount}人が承認済み` : '未承認'}</Typography></Stack>{approvals && !approvalsError ? <Button disabled={disabled || approvalsLoading} onClick={() => void onApprove(myApproved)} startIcon={myApproved ? <UndoRoundedIcon /> : <CheckCircleOutlineRoundedIcon />} variant="contained">{myApproved ? '自分の承認を取り消す' : '承認する'}</Button> : null}</Stack>{approvalsError ? <Alert severity="warning" sx={{ mt: 1 }}>承認状態を取得できませんでした: {approvalsError.message}</Alert> : null}</Paper></Stack>
}

function LoadingPanel({ label }: { label: string }) { return <Paper sx={{ p: 2 }} variant="outlined"><Typography color="text.secondary" variant="body2">{label}</Typography></Paper> }

function normalizePosition(position: Position, mergeRequest: MergeRequest): Position {
  return { ...position, baseSha: mergeRequest.diffRefs?.baseSha ?? position.baseSha, headSha: mergeRequest.diffRefs?.headSha ?? position.headSha, startSha: mergeRequest.diffRefs?.startSha ?? position.startSha }
}

function isPositionCurrent(position: Position, mergeRequest: MergeRequest): boolean {
  const currentHead = mergeRequest.diffRefs?.headSha ?? mergeRequest.headSha
  return Boolean(currentHead && position.headSha && currentHead === position.headSha)
}

function formatState(state: string): string { if (state === 'opened' || state === 'open') return 'Open'; if (state === 'merged') return 'Merged'; if (state === 'closed') return 'Closed'; return state || 'Unknown' }
function shortSha(value: string): string { return value.length > 10 ? value.slice(0, 8) : value }
function formatFetchedAt(timestamp?: number): string { if (!timestamp) return '時刻不明'; return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp) }
