import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { StatusPill, type StatusTone } from '../StatusPill'
import { getDiscussionCount, type MockMergeRequest } from '../../mock/fixtures'
import { getMockCommitsForMergeRequest } from '../../mock/commits'
import type { MockCommentOptions, MockReviewActions } from '../../mock/reviewTypes'
import { MockDiffView, type MockDiffDisplayMode } from './MockDiffView'
import { MockDiscussionList } from './MockDiscussionList'
import { MockCommitTimeline, type MockCommitTimelineValue } from './MockCommitTimeline'
import { MockPendingReview } from './MockPendingReview'
import { MockReviewComposer } from './MockReviewComposer'

export type ReviewTab = 'overview' | 'changes' | 'discussion'

interface MockReviewPaneProps {
  activeTab: ReviewTab
  approved: boolean
  draft: string
  mergeRequest: MockMergeRequest
  replyTarget?: string
  resolvedIds: string[]
  selectedFile: string
  onApproveToggle: () => void
  onBackToList: () => void
  onCancelReply: () => void
  onChangeDraft: (value: string) => void
  onOpenDiscussion: () => void
  onOpenProject?: () => void
  onReply: (discussionId: string) => void
  onSaveDraft: () => void
  onSelectFile: (path: string) => void
  onSelectTab: (tab: ReviewTab) => void
  onSubmitComment: (options?: MockCommentOptions) => void
  onToggleResolved: (discussionId: string) => void
  reviewActions?: MockReviewActions
  replyTargetId?: string
  composerKey?: string
}

function stateLabel(mergeRequest: MockMergeRequest) {
  if (mergeRequest.state === 'merged') return 'Merged'
  if (mergeRequest.state === 'closed') return 'Closed'
  if (mergeRequest.reviewState === 'approved') return '承認済み'
  if (mergeRequest.reviewState === 'changes-requested') return '要修正'
  return '要レビュー'
}

function stateTone(mergeRequest: MockMergeRequest): StatusTone {
  if (mergeRequest.state === 'merged') return 'info'
  if (mergeRequest.state === 'closed') return 'default'
  if (mergeRequest.reviewState === 'approved') return 'success'
  if (mergeRequest.reviewState === 'changes-requested') return 'error'
  return 'warning'
}

export function MockReviewPane({
  activeTab,
  approved,
  draft,
  mergeRequest,
  replyTarget,
  resolvedIds,
  selectedFile,
  onApproveToggle,
  onBackToList,
  onCancelReply,
  onChangeDraft,
  onOpenDiscussion,
  onOpenProject,
  onReply,
  onSaveDraft,
  onSelectFile,
  onSelectTab,
  onSubmitComment,
  onToggleResolved,
  reviewActions,
  replyTargetId,
  composerKey,
}: MockReviewPaneProps) {
  const discussionCount = getDiscussionCount(mergeRequest)
  const commits = getMockCommitsForMergeRequest(mergeRequest.id)
  const [timelineValue, setTimelineValue] = useState<MockCommitTimelineValue>('overall')
  const [displayMode, setDisplayMode] = useState<MockDiffDisplayMode>('diff')
  const [showMetadata, setShowMetadata] = useState(false)
  const selectedCommit = commits.find((commit) => commit.id === timelineValue)
  const reviewScope = timelineValue === 'overall' ? 'overall' : 'commit'
  const scopedFiles = reviewScope === 'overall' ? mergeRequest.files : selectedCommit?.files ?? []
  const diffKey = `${mergeRequest.id}:${timelineValue}`
  const contentVersionLabel = reviewScope === 'overall' ? commits.at(-1)?.sha ?? 'MRの最新状態' : selectedCommit?.sha ?? 'MRの最新状態'

  const handleTimelineChange = (nextValue: MockCommitTimelineValue) => {
    setTimelineValue(nextValue)
    const nextCommit = commits.find((commit) => commit.id === nextValue)
    const nextFiles = nextValue === 'overall' ? mergeRequest.files : nextCommit?.files ?? []
    onSelectFile(nextFiles[0]?.path ?? '')
  }
  return (
    <Box component="section" aria-label={`MR !${mergeRequest.iid} 詳細`} sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <Box sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', px: { xs: 1.5, md: 2.25 }, pt: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
          <Button aria-label="MR一覧へ戻る" onClick={onBackToList} size="small" startIcon={<ArrowBackRoundedIcon />} sx={{ display: 'none', fontSize: 'caption.fontSize', minWidth: 0, px: 0.5, '@media (max-width: 1100px)': { display: 'inline-flex' } }}>
            一覧
          </Button>
          {onOpenProject ? (
            <Button aria-label="このプロジェクトを開く" onClick={onOpenProject} size="small" sx={{ color: 'text.secondary', fontSize: 'caption.fontSize', minWidth: 0, p: 0, textTransform: 'none' }}>
              {mergeRequest.projectPath}
            </Button>
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.projectPath}</Typography>
          )}
          <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>·</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>!{mergeRequest.iid}</Typography>
          <StatusPill label={stateLabel(mergeRequest)} size="small" subtle tone={stateTone(mergeRequest)} />
          <Box sx={{ flex: 1 }} />
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.updatedAt}</Typography>
        </Stack>
        <Typography component="h1" sx={{ fontSize: { xs: 17, md: 20 }, fontWeight: 'fontWeightBold', letterSpacing: '-0.025em', lineHeight: 1.35, maxWidth: 780 }}>
          {mergeRequest.title}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 1 }}>
          <Avatar sx={{ bgcolor: 'action.hover', color: 'primary.main', fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', height: 23, width: 23 }}>{mergeRequest.author.initials}</Avatar>
          <Typography sx={{ fontSize: 'caption.fontSize', fontWeight: 600 }}>{mergeRequest.author.name}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.author.handle}</Typography>
          <Button aria-expanded={showMetadata} aria-label="MRの付帯情報を表示" onClick={() => setShowMetadata((current) => !current)} size="small" sx={{ color: 'text.secondary', fontSize: 'caption.fontSize', minWidth: 0, ml: 0.5, px: 0.5, textTransform: 'none' }}>
            {showMetadata ? '詳細を隠す' : '詳細'}
          </Button>
          <Box sx={{ flex: 1 }} />
          {reviewActions ? (
            <MockPendingReview
              onDelete={reviewActions.onDeletePending}
              onDiscard={reviewActions.onDiscardReview}
              onEdit={reviewActions.onEditPending}
              onPublish={reviewActions.onPublishReview}
              pending={reviewActions.pending}
            />
          ) : null}
          <Button aria-label={approved ? '承認を取り消す' : 'MRを承認'} color={approved ? 'success' : 'primary'} onClick={onApproveToggle} size="small" startIcon={approved ? <VerifiedOutlinedIcon /> : <ThumbUpAltOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', px: 1 }} variant={approved ? 'outlined' : 'contained'}>
            {approved ? '承認済み · 取消' : '承認する'}
          </Button>
        </Stack>
        <Collapse in={showMetadata} unmountOnExit={false}>
          <Stack direction={{ sm: 'row', xs: 'column' }} spacing={0.75} sx={{ alignItems: { sm: 'center' }, mt: 0.9 }}>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography>
            <Typography color="text.disabled" sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 'caption.fontSize' }}>·</Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {mergeRequest.labels.map((label) => <Chip key={label} label={label} size="small" variant="outlined" sx={{ fontSize: 'caption.fontSize', height: 22 }} />)}
            </Stack>
          </Stack>
        </Collapse>
        <Tabs
          aria-label="MR詳細タブ"
          onChange={(_, value: ReviewTab) => onSelectTab(value)}
          sx={{ minHeight: 38, mt: 1.25, '& .MuiTab-root': { minHeight: 38, minWidth: 0, mr: 2.5, px: 0, fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' } }}
          value={activeTab}
        >
          <Tab icon={<ForumOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`議論 ${discussionCount}`} value="discussion" />
          <Tab icon={<AccountTreeOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`変更 ${mergeRequest.files.length}`} value="changes" />
          <Tab icon={<CodeOutlinedIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="概要" value="overview" />
        </Tabs>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeTab === 'overview' ? (
          <OverviewContent
            mergeRequest={mergeRequest}
            onSelectTab={onSelectTab}
            resolvedIds={resolvedIds}
          />
        ) : null}
        {activeTab === 'changes' ? (
          <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={0.35} sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: { xs: 1, md: 1.25 }, pt: 0.3 }}>
              <MockCommitTimeline commits={commits} onChange={handleTimelineChange} value={timelineValue} />
              <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', overflowWrap: 'anywhere' }}>
                {reviewScope === 'overall'
                  ? 'MR全体 · すべての変更ファイル'
                  : `親コミット → 選択コミット: ${selectedCommit?.parentSHA ?? 'root'} → ${selectedCommit?.sha ?? '—'}`}
              </Typography>
            </Stack>
            <MockDiffView
              key={diffKey}
              discussions={mergeRequest.discussions}
              displayMode={displayMode}
              files={scopedFiles}
              contentVersionLabel={contentVersionLabel}
              commentScope={reviewScope}
              onAddComment={reviewActions?.onStartLineComment}
              onOpenDiscussion={onOpenDiscussion}
              onDisplayModeChange={setDisplayMode}
              onSelectPath={onSelectFile}
              selectedPath={selectedFile}
              showDiscussionMarkers={reviewScope === 'overall'}
            />
          </Box>
        ) : null}
        {activeTab === 'discussion' ? (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.25, md: 2.25 } }}>
            <Stack spacing={1.25} sx={{ maxWidth: 860, mx: 'auto' }}>
              <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Box>
                  <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700 }}>レビューの議論</Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.25 }}>解決・返信の状態もこの画面で確認できます。</Typography>
                </Box>
                <Chip icon={<CheckCircleOutlineOutlinedIcon />} label={`解決済み ${resolvedIds.length}`} size="small" variant="outlined" sx={{ fontSize: 'caption.fontSize' }} />
              </Stack>
              <MockDiscussionList
                currentUserHandle="@otata"
                discussions={mergeRequest.discussions}
                onDeleteNote={reviewActions?.onDeleteNote}
                onEditNote={reviewActions?.onEditNote}
                onReply={onReply}
                onToggleResolved={onToggleResolved}
                resolvedIds={resolvedIds}
              />
            </Stack>
          </Box>
        ) : null}
        {activeTab === 'discussion' ? (
          <Box sx={{ borderTop: 1, borderColor: 'divider', p: { xs: 1.25, md: 2.25 }, pt: 1.25 }}>
            <Box sx={{ maxWidth: 860, mx: 'auto' }}>
              <MockReviewComposer
                canResolveReply={Boolean(replyTargetId && mergeRequest.discussions.find((discussion) => discussion.id === replyTargetId && discussion.kind !== 'comment'))}
                key={composerKey ?? `${mergeRequest.id}:${replyTarget ?? 'new'}`}
                draft={draft}
                onAddToReview={reviewActions?.onAddToReview}
                onCancelPosition={reviewActions?.onCancelPosition}
                onCancelReply={onCancelReply}
                onChange={onChangeDraft}
                onSaveDraft={onSaveDraft}
                onSubmit={onSubmitComment}
                position={reviewActions?.position}
                replyResolved={Boolean(replyTargetId && mergeRequest.discussions.find((discussion) => discussion.id === replyTargetId)?.state === 'resolved')}
                replyTarget={replyTarget}
                reviewCount={reviewActions?.pending.length}
              />
            </Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

interface OverviewContentProps {
  mergeRequest: MockMergeRequest
  onSelectTab: (tab: ReviewTab) => void
  resolvedIds: string[]
}

function OverviewContent({
  mergeRequest,
  onSelectTab,
  resolvedIds,
}: OverviewContentProps) {
  const openDiscussionCount = mergeRequest.discussions.filter((discussion) => !resolvedIds.includes(discussion.id) && discussion.state !== 'resolved').length

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.25, md: 2.25 } }}>
      <Stack spacing={1.5} sx={{ maxWidth: 860, mx: 'auto' }}>
        <Paper component="section" variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.5 }}>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>説明</Typography>
          <Typography sx={{ fontSize: 'body2.fontSize', lineHeight: 1.75, mt: 0.6, whiteSpace: 'pre-wrap' }}>{mergeRequest.description}</Typography>
        </Paper>

        <Paper component="section" variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.25 }}>
          <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', rowGap: 0.75 }}>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography>
            <Typography color="text.disabled" sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 'caption.fontSize' }}>·</Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {mergeRequest.labels.map((label) => <Chip key={label} label={label} size="small" variant="outlined" sx={{ fontSize: 'caption.fontSize', height: 22 }} />)}
            </Stack>
          </Stack>
        </Paper>

        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', px: 0.25, rowGap: 0.5 }}>
          <Typography color={mergeRequest.checksPassed === mergeRequest.checksTotal ? 'success.main' : 'warning.main'} sx={{ fontSize: 'caption.fontSize', fontWeight: 700 }}>
            Checks {mergeRequest.checksPassed}/{mergeRequest.checksTotal}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>変更 {mergeRequest.files.length}ファイル</Typography>
          <Typography color={openDiscussionCount > 0 ? 'primary.main' : 'text.secondary'} sx={{ fontSize: 'caption.fontSize', fontWeight: openDiscussionCount > 0 ? 700 : undefined }}>
            未解決 {openDiscussionCount}件
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>承認 {mergeRequest.approvals}/{mergeRequest.requiredApprovals}</Typography>
          <Box sx={{ flex: 1, minWidth: 12 }} />
          <Button onClick={() => onSelectTab('discussion')} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }} variant="text">議論に戻る</Button>
          <Button onClick={() => onSelectTab('changes')} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }} variant="outlined">変更を見る</Button>
        </Stack>
      </Stack>
    </Box>
  )
}
