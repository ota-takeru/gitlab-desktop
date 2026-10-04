import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FavoriteBorderOutlinedIcon from '@mui/icons-material/FavoriteBorderOutlined'
import FavoriteOutlinedIcon from '@mui/icons-material/FavoriteOutlined'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import TextSnippetOutlinedIcon from '@mui/icons-material/TextSnippetOutlined'
import Avatar from '@mui/material/Avatar'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import { MockSidebar, type MockSection } from '../components/mock/MockSidebar'
import { MockMrList, type MrFilter } from '../components/mock/MockMrList'
import { MockProjectPage, type ProjectMrFilter } from '../components/mock/MockProjectPage'
import { MockReviewPane, type ReviewTab } from '../components/mock/MockReviewPane'
import { MockPatternCatalog } from '../components/mock/MockPatternCatalog'
import { StatusPill } from '../components/StatusPill'
import type { MockCommentOptions, MockCommentPosition, MockPendingComment, MockReviewActions } from '../mock/reviewTypes'
import {
  CURRENT_USER_HANDLE,
  appendImmediateComment,
  appendImmediateReply,
  canEditReviewNote,
  cloneDiscussions,
  clonePosition,
  createReviewId,
  getReviewDraftKey,
  publishPendingComments,
  removeDiscussionOrTombstone,
  removePendingReplies,
} from '../mock/reviewState'
import {
  filterMergeRequests,
  mockMergeRequests,
  mockProjects,
  type MockMergeRequest,
  type MockDiscussion,
} from '../mock/fixtures'

interface MockAppProps {
  mode: 'light' | 'dark'
  onModeChange: () => void
  onBackToFoundation: () => void
}

type HistoricalFilter = 'all' | 'open' | 'merged' | 'closed'

export function MockApp({ mode, onModeChange, onBackToFoundation }: MockAppProps) {
  const [section, setSection] = useState<MockSection>('review')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pane, setPane] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState(mockMergeRequests[0].id)
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>()
  const [listQuery, setListQuery] = useState('')
  const [listFilter, setListFilter] = useState<MrFilter>('needs-review')
  const [activeTab, setActiveTab] = useState<ReviewTab>('discussion')
  const [selectedFile, setSelectedFile] = useState(mockMergeRequests[0].files[0].path)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [replyTarget, setReplyTarget] = useState<string>()
  const [commentPosition, setCommentPosition] = useState<MockCommentPosition>()
  const [publishedDiscussions, setPublishedDiscussions] = useState<Record<string, MockDiscussion[]>>(() => Object.fromEntries(mockMergeRequests.map((mergeRequest) => [mergeRequest.id, cloneDiscussions(mergeRequest.discussions)])))
  const [pendingReviews, setPendingReviews] = useState<Record<string, MockPendingComment[]>>({})
  const [approvedByMr, setApprovedByMr] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<string>()
  const [projectQuery, setProjectQuery] = useState('')
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({})
  const [historicalQuery, setHistoricalQuery] = useState('')
  const [historicalFilter, setHistoricalFilter] = useState<HistoricalFilter>('all')
  const [projectPageId, setProjectPageId] = useState<string>()
  const [projectMrQuery, setProjectMrQuery] = useState('')
  const [projectMrFilter, setProjectMrFilter] = useState<ProjectMrFilter>('all')

  const effectiveMergeRequests = useMemo(
    () => mockMergeRequests.map((mergeRequest) => {
      const discussions = cloneDiscussions(publishedDiscussions[mergeRequest.id] ?? mergeRequest.discussions)
      const approvalOverride = approvedByMr[mergeRequest.id]
      if (approvalOverride === undefined) return { ...mergeRequest, discussions }

      const wasApproved = mergeRequest.reviewState === 'approved'
      const approvalDelta = approvalOverride === wasApproved ? 0 : approvalOverride ? 1 : -1
      return {
        ...mergeRequest,
        discussions,
        approvals: Math.max(0, mergeRequest.approvals + approvalDelta),
        reviewState: approvalOverride
          ? 'approved' as const
          : mergeRequest.reviewState === 'approved'
            ? 'needs-review' as const
            : mergeRequest.reviewState,
      }
    }),
    [approvedByMr, publishedDiscussions],
  )
  const selectedMr = effectiveMergeRequests.find((mergeRequest) => mergeRequest.id === selectedId) ?? effectiveMergeRequests[0]
  const selectedMrWithLocal = selectedMr
  const reviewList = useMemo(
    () => filterMergeRequests(effectiveMergeRequests, listQuery, listFilter, selectedProjectId),
    [effectiveMergeRequests, listFilter, listQuery, selectedProjectId],
  )
  const historicalResults = useMemo(
    () => filterMergeRequests(effectiveMergeRequests, historicalQuery, historicalFilter),
    [effectiveMergeRequests, historicalFilter, historicalQuery],
  )
  const projectPage = projectPageId ? mockProjects.find((project) => project.id === projectPageId) : undefined
  const projectPageMergeRequests = projectPageId
    ? effectiveMergeRequests.filter((mergeRequest) => mergeRequest.projectId === projectPageId)
    : []
  const resolvedIds = selectedMrWithLocal.discussions
    .filter((discussion) => discussion.kind !== 'comment' && discussion.state === 'resolved')
    .map((discussion) => discussion.id)
  const approved = selectedMr.reviewState === 'approved'
  const draftKey = getReviewDraftKey(selectedMr.id, replyTarget, commentPosition)
  const draft = drafts[draftKey] ?? ''

  const handleSectionChange = (nextSection: MockSection) => {
    setSection(nextSection)
    if (nextSection === 'review' || nextSection === 'projects') {
      setSelectedProjectId(undefined)
      setProjectPageId(undefined)
      setPane('list')
    } else {
      setSelectedProjectId(undefined)
      setProjectPageId(undefined)
    }
    setNotice(undefined)
  }

  const selectMr = (id: string) => {
    const nextMr = mockMergeRequests.find((mergeRequest) => mergeRequest.id === id)
    if (!nextMr) return
    setSelectedId(id)
    setSelectedFile(nextMr.files[0]?.path ?? '')
    setActiveTab('discussion')
    setReplyTarget(undefined)
    setCommentPosition(undefined)
    setNotice(undefined)
    setPane('detail')
  }

  const toggleResolved = (discussionId: string) => {
    const discussion = selectedMrWithLocal.discussions.find((candidate) => candidate.id === discussionId)
    if (!discussion || discussion.kind === 'comment') return
    setPublishedDiscussions((current) => {
      const nextDiscussions = cloneDiscussions(current[selectedMr.id] ?? selectedMrWithLocal.discussions)
      const nextDiscussion = nextDiscussions.find((candidate) => candidate.id === discussionId)
      if (!nextDiscussion) return current
      nextDiscussion.state = nextDiscussion.state === 'resolved' ? 'open' : 'resolved'
      return { ...current, [selectedMr.id]: nextDiscussions }
    })
    setNotice('議論の状態をシミュレーションしました。')
  }

  const toggleApproved = () => {
    const next = !approved
    const fixtureMr = mockMergeRequests.find((mergeRequest) => mergeRequest.id === selectedMr.id)
    const initiallyApproved = fixtureMr?.reviewState === 'approved'
    setApprovedByMr((current) => {
      if (next === initiallyApproved) {
        const nextState = { ...current }
        delete nextState[selectedMr.id]
        return nextState
      }
      return { ...current, [selectedMr.id]: next }
    })
    setNotice(next ? '承認をシミュレーションしました。GitLabへは送信されません。' : '承認取消をシミュレーションしました。')
  }

  const updatePublishedDiscussions = (updater: (discussions: MockDiscussion[]) => MockDiscussion[]) => {
    setPublishedDiscussions((current) => ({
      ...current,
      [selectedMr.id]: updater(cloneDiscussions(current[selectedMr.id] ?? selectedMrWithLocal.discussions)),
    }))
  }

  const submitComment = (options: MockCommentOptions = { kind: 'comment' }) => {
    if (!draft.trim()) return
    const body = draft.trim()
    const wasReply = Boolean(replyTarget)
    updatePublishedDiscussions((discussions) => {
      if (replyTarget) {
        appendImmediateReply(discussions, replyTarget, body, options.kind === 'thread' ? options.resolution : undefined)
      } else {
        appendImmediateComment(discussions, body, {
          kind: commentPosition ? 'thread' : options.kind,
          resolution: commentPosition ? options.resolution : undefined,
        }, clonePosition(commentPosition))
      }
      return discussions
    })
    setDrafts((current) => ({ ...current, [draftKey]: '' }))
    setReplyTarget(undefined)
    setCommentPosition(undefined)
    setNotice(`${wasReply ? '返信' : 'コメント'}をローカルに追加しました。GitLabへは送信されません。`)
  }

  const addToReview = (options: MockCommentOptions = { kind: 'thread' }) => {
    if (!draft.trim()) return
    const body = draft.trim()
    const targetDiscussion = replyTarget ? selectedMrWithLocal.discussions.find((discussion) => discussion.id === replyTarget) : undefined
    const kind = replyTarget || commentPosition ? 'thread' : options.kind
    const pending: MockPendingComment = {
      id: createReviewId('pending'),
      body,
      kind,
      position: replyTarget ? undefined : clonePosition(commentPosition),
      replyTo: replyTarget,
      replyAuthor: targetDiscussion?.author.name,
      resolution: kind === 'thread' ? options.resolution : undefined,
    }
    setPendingReviews((current) => ({ ...current, [selectedMr.id]: [...(current[selectedMr.id] ?? []), pending] }))
    setDrafts((current) => ({ ...current, [draftKey]: '' }))
    setNotice('レビューに追加しました。公開するまでMRには反映されません。')
  }

  const startLineComment = (position: MockCommentPosition) => {
    setCommentPosition(clonePosition(position))
    setReplyTarget(undefined)
    setActiveTab('discussion')
    setNotice(position.line === undefined
      ? `${position.path}へのファイルコメント位置を選択しました。`
      : `${position.path}:${position.line}へのコメント位置を選択しました。`)
  }

  const editNote = (discussionId: string, body: string, replyId?: string) => {
    if (!body.trim()) return
    updatePublishedDiscussions((discussions) => {
      const discussion = discussions.find((candidate) => candidate.id === discussionId)
      if (!discussion) return discussions
      if (replyId) {
        const reply = discussion.replies.find((candidate) => candidate.id === replyId)
        if (!reply || !canEditReviewNote(reply, body)) return discussions
        reply.body = body.trim()
        reply.edited = true
      } else {
        if (discussion.deleted || !canEditReviewNote(discussion, body)) return discussions
        discussion.body = body.trim()
        discussion.edited = true
      }
      return discussions
    })
  }

  const deleteNote = (discussionId: string, replyId?: string) => {
    const currentDiscussion = selectedMrWithLocal.discussions.find((discussion) => discussion.id === discussionId)
    const canDeleteRoot = !replyId && Boolean(currentDiscussion && !currentDiscussion.deleted && currentDiscussion.author.handle === CURRENT_USER_HANDLE)
    if (canDeleteRoot) {
      const hadPendingReplies = (pendingReviews[selectedMr.id] ?? []).some((item) => item.replyTo === discussionId)
      setPendingReviews((current) => ({
        ...current,
        [selectedMr.id]: removePendingReplies(current[selectedMr.id] ?? [], discussionId),
      }))
      if (replyTarget === discussionId) {
        setReplyTarget(undefined)
        setCommentPosition(undefined)
      }
      setNotice(hadPendingReplies ? 'コメントを削除し、未公開の返信も破棄しました。' : 'コメントを削除しました。')
    }
    updatePublishedDiscussions((discussions) => {
      const discussion = discussions.find((candidate) => candidate.id === discussionId)
      if (!discussion) return discussions
      if (replyId) {
        const reply = discussion.replies.find((candidate) => candidate.id === replyId)
        if (!reply || reply.author.handle !== CURRENT_USER_HANDLE) return discussions
        discussion.replies = discussion.replies.filter((candidate) => candidate.id !== replyId)
        return discussions
      }
      if (discussion.author.handle !== CURRENT_USER_HANDLE || discussion.deleted) return discussions
      return removeDiscussionOrTombstone(discussions, discussionId)
    })
  }

  const editPending = (id: string, body: string) => {
    if (!body.trim()) return
    setPendingReviews((current) => ({
      ...current,
      [selectedMr.id]: (current[selectedMr.id] ?? []).map((item) => item.id === id ? { ...item, body: body.trim() } : item),
    }))
  }

  const deletePending = (id: string) => {
    setPendingReviews((current) => {
      const pending = current[selectedMr.id] ?? []
      const target = pending.find((item) => item.id === id)
      const next = target?.replyTo ? pending.filter((item) => item.id !== id) : removePendingReplies(pending.filter((item) => item.id !== id), id)
      return { ...current, [selectedMr.id]: next }
    })
  }

  const discardReview = () => {
    setPendingReviews((current) => ({ ...current, [selectedMr.id]: [] }))
    setNotice('保留中のレビューを破棄しました。')
  }

  const publishReview = (summary: string, approve: boolean) => {
    const pending = pendingReviews[selectedMr.id] ?? []
    updatePublishedDiscussions((discussions) => publishPendingComments(discussions, pending, summary))
    setPendingReviews((current) => ({ ...current, [selectedMr.id]: [] }))
    if (approve && !approved) {
      setApprovedByMr((current) => ({ ...current, [selectedMr.id]: true }))
    }
    setNotice('レビューを公開しました。GitLabへは送信されません。')
  }

  const reviewActions: MockReviewActions = {
    pending: pendingReviews[selectedMr.id] ?? [],
    position: commentPosition,
    onStartLineComment: startLineComment,
    onCancelPosition: () => setCommentPosition(undefined),
    onAddToReview: addToReview,
    onEditNote: editNote,
    onDeleteNote: deleteNote,
    onEditPending: editPending,
    onDeletePending: deletePending,
    onDiscardReview: discardReview,
    onPublishReview: publishReview,
  }

  const saveDraft = () => {
    setNotice('下書きをメモリ内に保存しました。アプリを閉じると消えます。')
  }

  const openProject = (projectId: string) => {
    setReplyTarget(undefined)
    setCommentPosition(undefined)
    setSelectedProjectId(undefined)
    setProjectPageId(projectId)
    setProjectMrQuery('')
    setProjectMrFilter('all')
    setSection('projects')
    setPane('list')
    setNotice(undefined)
  }

  const openMrFromProject = (id: string) => {
    const nextMr = effectiveMergeRequests.find((mergeRequest) => mergeRequest.id === id)
    if (!nextMr) return
    setSelectedProjectId(nextMr.projectId)
    setListQuery('')
    setListFilter('all')
    setSection('review')
    selectMr(id)
  }

  const returnToProject = (projectId: string) => {
    if (!mockProjects.some((project) => project.id === projectId)) return
    setSelectedProjectId(undefined)
    setProjectPageId(projectId)
    setSection('projects')
    setPane('list')
    setReplyTarget(undefined)
    setCommentPosition(undefined)
    setNotice(undefined)
  }

  const openMrFromSearch = (id: string) => {
    setSelectedProjectId(undefined)
    setProjectPageId(undefined)
    setListQuery('')
    setListFilter('all')
    setSection('review')
    selectMr(id)
  }

  const toggleFavorite = (projectId: string) => {
    const project = mockProjects.find((candidate) => candidate.id === projectId)
    if (!project) return
    setFavoriteOverrides((current) => ({ ...current, [projectId]: !(current[projectId] ?? project.favorite) }))
  }

  return (
    <Box sx={{ bgcolor: 'background.default', display: 'flex', height: '100vh', minHeight: 640, minWidth: 960, overflow: 'hidden' }}>
      <MockSidebar collapsed={sidebarCollapsed} mode={mode} onBackToFoundation={onBackToFoundation} onModeChange={onModeChange} onSectionChange={handleSectionChange} onToggleCollapsed={() => setSidebarCollapsed((current) => !current)} section={section} />
      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
        <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {section === 'review' ? (
          <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
            {selectedProjectId ? <ProjectScopeBar onBack={() => returnToProject(selectedProjectId)} project={mockProjects.find((candidate) => candidate.id === selectedProjectId)} /> : null}
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', flex: '0 0 auto', flexDirection: 'column', minHeight: 0, minWidth: 0, width: selectedProjectId ? 314 : undefined, '& > [aria-label="Merge request一覧"]': { flex: 1, minHeight: 0 }, '@media (max-width: 1100px)': { display: pane === 'list' ? 'flex' : 'none', flex: 1, width: '100%' } }}>
              <MockMrList
                allMergeRequests={selectedProjectId ? effectiveMergeRequests.filter((mergeRequest) => mergeRequest.projectId === selectedProjectId) : effectiveMergeRequests}
                filter={listFilter}
                mergeRequests={reviewList}
                onFilterChange={(nextFilter) => { setListFilter(nextFilter); setPane('list') }}
                onQueryChange={(query) => { setListQuery(query); setPane('list') }}
                onSelect={selectMr}
                query={listQuery}
                selectedId={selectedId}
              />
            </Box>
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, '@media (max-width: 1100px)': { display: pane === 'detail' ? 'flex' : 'none', width: '100%' } }}>
              <MockReviewPane
                key={selectedMr.id}
                activeTab={activeTab}
                approved={approved}
                draft={draft}
                mergeRequest={selectedMrWithLocal}
                onApproveToggle={toggleApproved}
                onBackToList={() => setPane('list')}
                onCancelReply={() => setReplyTarget(undefined)}
                onChangeDraft={(value) => setDrafts((current) => ({ ...current, [draftKey]: value }))}
                onOpenDiscussion={() => setActiveTab('discussion')}
                onOpenProject={() => openProject(selectedMr.projectId)}
                onReply={(discussionId) => {
                  setReplyTarget(discussionId)
                  setCommentPosition(undefined)
                  setActiveTab('discussion')
                }}
                onSaveDraft={saveDraft}
                onSelectFile={setSelectedFile}
                onSelectTab={setActiveTab}
                onSubmitComment={submitComment}
                onToggleResolved={toggleResolved}
                reviewActions={reviewActions}
                composerKey={draftKey}
                replyTarget={replyTarget ? selectedMrWithLocal.discussions.find((discussion) => discussion.id === replyTarget)?.author.name : undefined}
                replyTargetId={replyTarget}
                resolvedIds={resolvedIds}
                selectedFile={selectedFile}
              />
              {notice ? <Alert onClose={() => setNotice(undefined)} severity="info" sx={{ borderRadius: 0, bottom: 36, boxShadow: 2, fontSize: 'caption.fontSize', left: '50%', position: 'absolute', transform: 'translateX(-50%)', zIndex: 4 }} onClick={() => setNotice(undefined)}>{notice}</Alert> : null}
            </Box>
            </Box>
          </Box>
          ) : null}
          {section === 'projects' && projectPage ? (
          <MockProjectPage
            favorite={favoriteOverrides[projectPage.id] ?? projectPage.favorite}
            filter={projectMrFilter}
            mergeRequests={projectPageMergeRequests}
            onBackToProjects={() => { setProjectPageId(undefined); setProjectMrQuery(''); setProjectMrFilter('all') }}
            onFilterChange={setProjectMrFilter}
            onOpenMr={openMrFromProject}
            onQueryChange={setProjectMrQuery}
            onToggleFavorite={() => toggleFavorite(projectPage.id)}
            project={projectPage}
            query={projectMrQuery}
          />
          ) : null}
          {section === 'projects' && !projectPage ? <ProjectsView favoriteOverrides={favoriteOverrides} onOpenProject={openProject} onToggleFavorite={toggleFavorite} projectQuery={projectQuery} setProjectQuery={setProjectQuery} /> : null}
          {section === 'search' ? <HistoricalSearchView historicalFilter={historicalFilter} historicalQuery={historicalQuery} onFilterChange={setHistoricalFilter} onOpenMr={openMrFromSearch} onQueryChange={setHistoricalQuery} results={historicalResults} /> : null}
          {section === 'catalog' ? <MockCatalogView onBackToReview={() => handleSectionChange('review')} /> : null}
        </Box>
        <Box
          aria-label="接続ステータス"
          component="footer"
          sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', display: 'flex', flexShrink: 0, height: 24, minHeight: 24, px: 1.5 }}
        >
          <Typography color="text.secondary" noWrap sx={{ fontSize: 'caption.fontSize', lineHeight: 1 }}>UIモック · サンプルデータ / 未接続</Typography>
        </Box>
      </Box>
    </Box>
  )
}

function ProjectScopeBar({ onBack, project }: { onBack: () => void; project?: (typeof mockProjects)[number] }) {
  if (!project) return null
  return (
    <Box sx={{ alignItems: 'center', bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', display: 'flex', flexShrink: 0, minHeight: 40, minWidth: 0, px: 1 }}>
      <Button aria-label={`${project.name} に戻る`} onClick={onBack} size="small" startIcon={<ArrowBackRoundedIcon />} sx={{ flexShrink: 0, fontSize: 'caption.fontSize', minWidth: 0, px: 0.5, textTransform: 'none' }}>
        {project.name} に戻る
      </Button>
      <Typography color="text.secondary" noWrap sx={{ fontSize: 'caption.fontSize', ml: 0.75, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        · {project.path}
      </Typography>
    </Box>
  )
}

function ProjectsView({ favoriteOverrides, onOpenProject, onToggleFavorite, projectQuery, setProjectQuery }: { favoriteOverrides: Record<string, boolean>; onOpenProject: (projectId: string) => void; onToggleFavorite: (projectId: string) => void; projectQuery: string; setProjectQuery: (query: string) => void }) {
  const projects = mockProjects.filter((project) => `${project.name} ${project.path} ${project.description}`.toLocaleLowerCase('ja-JP').includes(projectQuery.toLocaleLowerCase('ja-JP')))
  return (
    <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 2, md: 3.5 } }}>
      <Stack spacing={2.25} sx={{ maxWidth: 1080, mx: 'auto' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'end' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography color="primary.main" sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Projects</Typography>
            <Typography component="h1" sx={{ fontSize: 24, fontWeight: 'fontWeightBold', letterSpacing: '-0.03em', mt: 0.5 }}>プロジェクトを選ぶ</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize', mt: 0.5 }}>お気に入りと最近の活動から、レビュー対象を切り替えます。</Typography>
          </Box>
          <TextField onChange={(event) => setProjectQuery(event.target.value)} placeholder="プロジェクトを検索" value={projectQuery} slotProps={{ htmlInput: { 'aria-label': 'プロジェクトを検索' }, input: { startAdornment: <InputAdornment position="start"><SearchOutlinedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment> } }} sx={{ minWidth: 280, '& .MuiInputBase-root': { fontSize: 'body2.fontSize' } }} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip label={`${projects.length} projects`} size="small" variant="outlined" />
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>保存済みの表示例 · 実通信なし</Typography>
        </Stack>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { md: 'repeat(2, minmax(0, 1fr))', xs: '1fr' } }}>
          {projects.map((project) => {
            const favorite = favoriteOverrides[project.id] ?? project.favorite
            const openMrCount = mockMergeRequests.filter((mergeRequest) => mergeRequest.projectId === project.id && mergeRequest.state === 'open').length
            return (
              <Card component="article" key={project.id} sx={{ position: 'relative' }} variant="outlined">
                <CardActionArea onClick={() => onOpenProject(project.id)} sx={{ height: '100%' }}>
                  <CardContent sx={{ p: 2 }}>
                    <Stack spacing={1.3}>
                      <Stack direction="row" sx={{ alignItems: 'start' }}>
                        <Avatar sx={{ bgcolor: 'action.selected', color: 'primary.main', fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold', height: 34, width: 34 }}>{project.name.slice(0, 1)}</Avatar>
                        <Box sx={{ flex: 1, minWidth: 0, ml: 1.25 }}>
                          <Typography sx={{ fontSize: 14, fontWeight: 'fontWeightBold' }}>{project.name}</Typography>
                          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.25 }}>{project.path}</Typography>
                        </Box>
                      </Stack>
                      <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize', lineHeight: 1.65 }}>{project.description}</Typography>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Chip label={`${openMrCount}件のオープンMR`} color="primary" size="small" variant="outlined" sx={{ fontSize: 'caption.fontSize' }} />
                        <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>{project.activity}</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography color="primary.main" sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' }}>プロジェクトを開く →</Typography>
                      </Stack>
                    </Stack>
                  </CardContent>
                </CardActionArea>
                <Tooltip title={favorite ? 'お気に入りを外す' : 'お気に入りに追加'}>
                  <IconButton aria-label={favorite ? `${project.name}をお気に入りから外す` : `${project.name}をお気に入りに追加`} onClick={() => onToggleFavorite(project.id)} size="small" sx={{ position: 'absolute', right: 9, top: 9, zIndex: 1 }}>
                    {favorite ? <FavoriteOutlinedIcon color="warning" sx={{ fontSize: 18 }} /> : <FavoriteBorderOutlinedIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
              </Card>
            )
          })}
        </Box>
      </Stack>
    </Box>
  )
}

function HistoricalSearchView({ historicalFilter, historicalQuery, onFilterChange, onOpenMr, onQueryChange, results }: { historicalFilter: HistoricalFilter; historicalQuery: string; onFilterChange: (filter: HistoricalFilter) => void; onOpenMr: (id: string) => void; onQueryChange: (query: string) => void; results: MockMergeRequest[] }) {
  const tabs: Array<{ key: HistoricalFilter; label: string }> = [
    { key: 'all', label: 'すべて' },
    { key: 'open', label: 'Open' },
    { key: 'merged', label: 'Merged' },
    { key: 'closed', label: 'Closed' },
  ]
  return (
    <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 2, md: 3.5 } }}>
      <Stack spacing={2} sx={{ maxWidth: 960, mx: 'auto' }}>
        <Box>
          <Typography color="primary.main" sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>History</Typography>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 'fontWeightBold', letterSpacing: '-0.03em', mt: 0.5 }}>過去のMRを検索</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize', mt: 0.5 }}>タイトルと説明だけを検索対象にした、読み返しやすい履歴ビューです。</Typography>
        </Box>
        <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.5 }}>
          <Stack spacing={1.25}>
            <TextField fullWidth onChange={(event) => onQueryChange(event.target.value)} placeholder="例: キャッシュ、接続、検索…" value={historicalQuery} slotProps={{ htmlInput: { 'aria-label': '過去のMRをタイトル・説明で検索' }, input: { startAdornment: <InputAdornment position="start"><SearchOutlinedIcon sx={{ color: 'text.secondary', fontSize: 19 }} /></InputAdornment> } }} />
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Tabs aria-label="過去MRの状態" onChange={(_, value: HistoricalFilter) => onFilterChange(value)} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, minWidth: 0, px: 1, fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' } }} value={historicalFilter}>
                {tabs.map(({ key, label }) => <Tab key={key} label={label} value={key} />)}
              </Tabs>
              <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{results.length}件 · 保存済みの表示例</Typography>
            </Stack>
          </Stack>
        </Paper>
        <Stack spacing={0.75}>
          {results.map((mergeRequest) => (
            <ListItemButton key={mergeRequest.id} onClick={() => onOpenMr(mergeRequest.id)} sx={{ alignItems: 'start', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1.1 }}>
              <ListItemText
                primary={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>{mergeRequest.title}</Typography><Chip label={mergeRequest.state} size="small" variant="outlined" sx={{ fontSize: 'caption.fontSize', height: 21 }} /></Stack>}
                secondary={<Typography color="text.secondary" sx={{ display: 'block', fontSize: 'caption.fontSize', lineHeight: 1.6, mt: 0.35 }}>{mergeRequest.projectPath} · !{mergeRequest.iid} · {mergeRequest.description}</Typography>}
              />
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', ml: 2, mt: 0.25 }}><TextSnippetOutlinedIcon sx={{ color: 'text.disabled', fontSize: 15 }} /><Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.files.length}</Typography><HistoryOutlinedIcon sx={{ color: 'text.disabled', fontSize: 15 }} /><Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.updatedAt}</Typography></Stack>
            </ListItemButton>
          ))}
          {results.length === 0 ? <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 4, textAlign: 'center' }}><FilterAltOutlinedIcon sx={{ color: 'text.disabled', fontSize: 26 }} /><Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold', mt: 1 }}>検索結果がありません</Typography><Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.5 }}>タイトル・説明・状態を変えて試してください。</Typography></Paper> : null}
        </Stack>
      </Stack>
    </Box>
  )
}

function MockCatalogView({ onBackToReview }: { onBackToReview: () => void }) {
  return (
    <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 2, md: 3.5 } }}>
      <Stack spacing={2.25} sx={{ maxWidth: 1040, mx: 'auto' }}>
        <Stack direction="row" sx={{ alignItems: 'end', justifyContent: 'space-between' }}>
          <Box>
            <Typography color="primary.main" sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Reference</Typography>
            <Typography component="h1" sx={{ fontSize: 24, fontWeight: 'fontWeightBold', letterSpacing: '-0.03em', mt: 0.5 }}>レビューUIカタログ</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize', mt: 0.5 }}>モックで使う状態と密度を揃えるための、共有パターンの確認画面です。</Typography>
          </Box>
          <Button onClick={onBackToReview} size="small" startIcon={<ArrowBackRoundedIcon />} sx={{ fontSize: 'caption.fontSize' }} variant="outlined">レビューに戻る</Button>
        </Stack>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { md: 'repeat(2, minmax(0, 1fr))', xs: '1fr' } }}>
          <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.75 }}>
            <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>状態ラベル</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.35 }}>一覧と詳細で同じ意味を使います。</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1.25 }}>
              <StatusPill tone="warning" label="要レビュー" subtle /><StatusPill tone="error" label="要修正" subtle /><StatusPill tone="success" label="承認済み" subtle /><StatusPill tone="info" label="Merged" subtle />
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.75 }}>
            <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>フィードバック</Typography>
            <Stack spacing={0.8} sx={{ mt: 1.25 }}>
              <Alert severity="info" sx={{ fontSize: 'caption.fontSize', py: 0.1 }}>保存済みの表示例を先に表示しています。</Alert>
              <Alert severity="success" sx={{ fontSize: 'caption.fontSize', py: 0.1 }}>シミュレーション操作が完了しました。</Alert>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.75 }}>
            <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>入力の状態</Typography>
            <Stack spacing={0.8} sx={{ mt: 1.25 }}>
              <TextField disabled label="未接続" placeholder="GitLab接続後に利用" size="small" />
              <Button disabled startIcon={<AddOutlinedIcon />} variant="contained">コメントを投稿</Button>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.75 }}>
            <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>空状態</Typography>
            <Stack sx={{ alignItems: 'center', bgcolor: 'action.hover', borderRadius: 1, mt: 1.25, p: 2, textAlign: 'center' }}>
              <FolderOpenOutlinedIcon sx={{ color: 'text.disabled', fontSize: 25 }} />
              <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold', mt: 0.5 }}>表示する議論がありません</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.35 }}>最初のコメントを下書きできます。</Typography>
            </Stack>
          </Paper>
        </Box>
        <MockPatternCatalog />
      </Stack>
    </Box>
  )
}
