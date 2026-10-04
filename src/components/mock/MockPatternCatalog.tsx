import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { MockProjectPage, type ProjectMrFilter } from './MockProjectPage'
import { MockCommitTimeline, type MockCommitTimelineValue } from './MockCommitTimeline'
import { MockDiscussionList } from './MockDiscussionList'
import { MockReviewComposer } from './MockReviewComposer'
import { MockReviewPane, type ReviewTab } from './MockReviewPane'
import { mockMergeRequests, mockProjects, type MockDiscussion } from '../../mock/fixtures'
import { getMockCommitsForMergeRequest } from '../../mock/commits'
import type { MockCommentOptions, MockCommentPosition, MockPendingComment, MockReviewActions } from '../../mock/reviewTypes'
import { appendImmediateComment, appendImmediateReply, canEditReviewNote, cloneDiscussions, clonePosition, createReviewId, publishPendingComments, removeDiscussionOrTombstone, removePendingReplies } from '../../mock/reviewState'

export function MockPatternCatalog() {
  const mergeRequest = mockMergeRequests[0]
  const commits = getMockCommitsForMergeRequest(mergeRequest.id)
  const timelinePreviewCommits = Array.from({ length: 12 }, (_, index) => {
    const baseCommit = commits[index % commits.length]
    return {
      ...baseCommit,
      id: `catalog-timeline:${index + 1}`,
      date: `今日 08:${String(index * 3).padStart(2, '0')}`,
      message: `コミット ${index + 1}: ${baseCommit.message}`,
      parentSHA: index === 0 ? baseCommit.parentSHA : `${index.toString(16).padStart(7, '0')}`,
      sha: `${(index + 1).toString(16).padStart(7, '0')}`,
    }
  })
  const project = mockProjects[0]
  const projectMergeRequests = mockMergeRequests.filter((candidate) => candidate.projectId === project.id)
  const [selectedPath, setSelectedPath] = useState(mergeRequest.files[0].path)
  const [draft, setDraft] = useState('')
  const [replyTarget, setReplyTarget] = useState<string>()
  const [catalogDiscussions, setCatalogDiscussions] = useState<MockDiscussion[]>(() => cloneDiscussions(mergeRequest.discussions))
  const [catalogPending, setCatalogPending] = useState<MockPendingComment[]>([])
  const [commentPosition, setCommentPosition] = useState<MockCommentPosition>()
  const [notice, setNotice] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState<ProjectMrFilter>('all')
  const [favorite, setFavorite] = useState(project.favorite)
  const [timelinePreviewValue, setTimelinePreviewValue] = useState<MockCommitTimelineValue>('overall')
  const [activeTab, setActiveTab] = useState<ReviewTab>('discussion')
  const resolvedIds = catalogDiscussions.filter((item) => item.kind !== 'comment' && item.state === 'resolved').map((item) => item.id)
  const catalogMergeRequest = { ...mergeRequest, discussions: catalogDiscussions }
  const replyName = replyTarget ? catalogDiscussions.find((discussion) => discussion.id === replyTarget)?.author.name : undefined

  const updateCatalogDiscussions = (updater: (discussions: MockDiscussion[]) => MockDiscussion[]) => {
    setCatalogDiscussions((current) => updater(cloneDiscussions(current)))
  }

  const submitCatalogComment = (options: MockCommentOptions = { kind: 'comment' }) => {
    if (!draft.trim()) return
    updateCatalogDiscussions((discussions) => {
      if (replyTarget) appendImmediateReply(discussions, replyTarget, draft.trim(), options.kind === 'thread' ? options.resolution : undefined)
      else appendImmediateComment(discussions, draft.trim(), { kind: commentPosition ? 'thread' : options.kind, resolution: options.resolution }, clonePosition(commentPosition))
      return discussions
    })
    setDraft('')
    setReplyTarget(undefined)
    setCommentPosition(undefined)
    setNotice('コメントをローカルに追加しました。GitLabへは送信されません。')
  }

  const addCatalogToReview = (options: MockCommentOptions = { kind: 'thread' }) => {
    if (!draft.trim()) return
    const target = replyTarget ? catalogDiscussions.find((discussion) => discussion.id === replyTarget) : undefined
    const kind = replyTarget || commentPosition ? 'thread' : options.kind
    setCatalogPending((current) => [...current, {
      id: createReviewId('catalog-pending'),
      body: draft.trim(),
      kind,
      position: replyTarget ? undefined : clonePosition(commentPosition),
      replyTo: replyTarget,
      replyAuthor: target?.author.name,
      resolution: kind === 'thread' ? options.resolution : undefined,
    }])
    setDraft('')
    setNotice('レビューに追加しました。公開するまで反映されません。')
  }

  const editCatalogNote = (discussionId: string, body: string, replyId?: string) => {
    if (!body.trim()) return
    updateCatalogDiscussions((discussions) => {
      const discussion = discussions.find((item) => item.id === discussionId)
      if (!discussion) return discussions
      if (replyId) {
        const reply = discussion.replies.find((item) => item.id === replyId)
        if (!reply || !canEditReviewNote(reply, body)) return discussions
        reply.body = body.trim()
        reply.edited = true
      } else if (canEditReviewNote(discussion, body) && !discussion.deleted) {
        discussion.body = body.trim()
        discussion.edited = true
      }
      return discussions
    })
  }

  const deleteCatalogNote = (discussionId: string, replyId?: string) => {
    const currentDiscussion = catalogDiscussions.find((item) => item.id === discussionId)
    const canDeleteRoot = !replyId && Boolean(currentDiscussion && !currentDiscussion.deleted && currentDiscussion.author.handle === '@otata')
    if (canDeleteRoot) setCatalogPending((current) => removePendingReplies(current, discussionId))
    updateCatalogDiscussions((discussions) => {
      const discussion = discussions.find((item) => item.id === discussionId)
      if (!discussion) return discussions
      if (replyId) {
        const reply = discussion.replies.find((item) => item.id === replyId)
        if (reply?.author.handle === '@otata') discussion.replies = discussion.replies.filter((item) => item.id !== replyId)
        return discussions
      }
      if (discussion.author.handle !== '@otata' || discussion.deleted) return discussions
      return removeDiscussionOrTombstone(discussions, discussionId)
    })
  }

  const toggleCatalogResolved = (discussionId: string) => {
    updateCatalogDiscussions((discussions) => {
      const discussion = discussions.find((item) => item.id === discussionId)
      if (!discussion || discussion.kind === 'comment') return discussions
      discussion.state = discussion.state === 'resolved' ? 'open' : 'resolved'
      return discussions
    })
    setNotice('議論の状態をシミュレーションしました。')
  }

  const catalogReviewActions: MockReviewActions = {
    pending: catalogPending,
    position: commentPosition,
    onStartLineComment: (position) => { setCommentPosition(clonePosition(position)); setReplyTarget(undefined); setActiveTab('discussion') },
    onCancelPosition: () => setCommentPosition(undefined),
    onAddToReview: addCatalogToReview,
    onEditNote: editCatalogNote,
    onDeleteNote: deleteCatalogNote,
    onEditPending: (id, body) => { if (body.trim()) setCatalogPending((current) => current.map((item) => item.id === id ? { ...item, body: body.trim() } : item)) },
    onDeletePending: (id) => setCatalogPending((current) => removePendingReplies(current.filter((item) => item.id !== id), id)),
    onDiscardReview: () => { setCatalogPending([]); setNotice('保留中のレビューを破棄しました。') },
    onPublishReview: (summary, approve) => { setCatalogDiscussions((current) => publishPendingComments(current, catalogPending, summary)); setCatalogPending([]); setNotice(approve ? 'レビューを承認として公開しました。' : 'レビューを公開しました。') },
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Box>
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 700 }}>レビューの共有パターン</Typography>
          <Typography color="text.secondary" variant="caption">同じ実コンポーネントで、プロジェクト画面・変更範囲・議論の密度を確認します。</Typography>
        </Box>
        <Typography color="text.disabled" variant="caption">UIモック · 実通信なし</Typography>
      </Stack>

      <MockProjectPage
        favorite={favorite}
        filter={projectFilter}
        mergeRequests={projectMergeRequests}
        onBackToProjects={() => setNotice('プロジェクト一覧へ戻るモック操作です。')}
        onFilterChange={setProjectFilter}
        onOpenMr={(id) => setNotice(`MR ${id}を開くモック操作です。`)}
        onQueryChange={setProjectQuery}
        onToggleFavorite={() => setFavorite((current) => !current)}
        project={project}
        query={projectQuery}
      />

      <Paper component="section" variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.25 }}>
        <Stack direction={{ sm: 'row', xs: 'column' }} spacing={0.75} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography component="h2" sx={{ fontSize: 'body2.fontSize', fontWeight: 700 }}>コミットタイムライン</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.2 }}>MR全体を先頭に、古いコミットから順に表示します。選択した版の差分とファイル全体を切り替えられます。</Typography>
          </Box>
          <Button onClick={() => setNotice('この画面の変更範囲を操作できます。')} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0 }} variant="outlined">操作例</Button>
        </Stack>
        <Paper component="section" variant="outlined" sx={{ bgcolor: 'background.default', mt: 1, overflow: 'hidden', px: 0.5 }}>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', px: 1, pt: 0.65 }}>コミットが多い場合の表示例 · UI確認用</Typography>
          <MockCommitTimeline commits={timelinePreviewCommits} onChange={setTimelinePreviewValue} value={timelinePreviewValue} />
          <Typography color="text.secondary" sx={{ borderTop: 1, borderColor: 'divider', fontSize: 'caption.fontSize', px: 1, py: 0.55 }}>
            {timelinePreviewValue === 'overall' ? 'MR全体 · すべての変更ファイル' : '親コミット → 選択コミット · UI確認用'}
          </Typography>
        </Paper>
        <Box sx={{ border: 1, borderColor: 'divider', display: 'flex', height: 500, minHeight: 0, mt: 1, overflow: 'hidden' }}>
          <MockReviewPane
            activeTab={activeTab}
            approved={false}
            draft={draft}
            mergeRequest={catalogMergeRequest}
            composerKey={`catalog:${replyTarget ?? 'new'}:${commentPosition ? JSON.stringify(commentPosition) : 'none'}`}
            onApproveToggle={() => setNotice('承認操作をシミュレーションしました。')}
            onBackToList={() => setNotice('MR一覧へ戻るモック操作です。')}
            onCancelReply={() => setReplyTarget(undefined)}
            onChangeDraft={setDraft}
            onOpenDiscussion={() => {
              setActiveTab('discussion')
              setNotice('行コメントを議論パネルで確認できます。')
            }}
            onReply={(discussionId) => {
              setReplyTarget(discussionId)
              setCommentPosition(undefined)
              setActiveTab('discussion')
              setNotice(`議論 ${discussionId}への返信先を選択しました。`)
            }}
            onSaveDraft={() => setNotice('下書きをメモリ内に保存しました。')}
            onSelectFile={setSelectedPath}
            onSelectTab={(tab) => {
              setActiveTab(tab)
              setNotice(`${tab}タブを選択しました。`)
            }}
            onSubmitComment={submitCatalogComment}
            onToggleResolved={toggleCatalogResolved}
            replyTargetId={replyTarget}
            reviewActions={catalogReviewActions}
            replyTarget={replyName}
            resolvedIds={resolvedIds}
            selectedFile={selectedPath}
          />
        </Box>
      </Paper>

      <MockDiscussionList
        discussions={catalogDiscussions}
        onReply={(discussionId) => {
          setReplyTarget(discussionId)
          setCommentPosition(undefined)
          setNotice('返信先を選択しました。')
        }}
        onDeleteNote={deleteCatalogNote}
        onEditNote={editCatalogNote}
        onToggleResolved={toggleCatalogResolved}
        resolvedIds={resolvedIds}
      />

      <MockReviewComposer
        key={replyTarget ?? 'new'}
        draft={draft}
        onCancelReply={() => setReplyTarget(undefined)}
        onChange={setDraft}
        onSaveDraft={() => setNotice('下書きをメモリ内に保存しました。')}
        onSubmit={submitCatalogComment}
        replyTarget={replyName}
      />
      {notice ? <Alert onClose={() => setNotice('')} severity="info" sx={{ fontSize: 11 }}>{notice}</Alert> : null}
    </Stack>
  )
}
