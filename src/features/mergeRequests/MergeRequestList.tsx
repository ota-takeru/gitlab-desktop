import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { ListRow } from '../../components/ListRow'
import { MergeRequestStateIcon } from '../../components/MergeRequestStateIcon'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { Pager } from '../../components/Pager'
import { PipelineStatus } from '../../components/PipelineStatus'
import { RelativeTime } from '../../components/RelativeTime'
import type { MergeRequest, MergeRequestQuery, MergeRequestState, MergeRequestsQuery } from '../../types/gitlab'
import { normalizeGitLabError, openGitLabUrl } from '../../lib/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { preferenceScope, readSavedSearches, type SavedMergeRequestSearch, writeSavedSearches } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { usePersonalWorkspace, type MrRef } from '../shared/personalWorkspace'
import { ProjectSearchPicker, UserSearchPicker } from './SearchPickers'

type OrderBy = NonNullable<MergeRequestsQuery['orderBy']>
type SortDirection = NonNullable<MergeRequestsQuery['sort']>
type StoredSearch = SavedMergeRequestSearch & { orderBy?: OrderBy; sort?: SortDirection }

export interface MergeRequestListProps {
  /** The MR currently shown in the detail pane. */
  selected?: MrRef | null
  projectId?: string
  projectName?: string
  initialQuery?: string
  initialParams?: Record<string, string>
  onOpenMergeRequest: (mergeRequest: MergeRequest) => void
  onSearchStateChange?: (params: Record<string, string>) => void
}

interface SearchDraft {
  assignee: string
  search: string
  state: MergeRequestState
  authorId: string
  reviewer: string
  updatedAfter: string
  updatedBefore: string
  projectId: string
  orderBy: OrderBy
  sort: SortDirection
}

interface AppliedSearch extends SearchDraft {
  page: number
}

export function MergeRequestList({ initialQuery = '', initialParams = {}, onOpenMergeRequest, onSearchStateChange, projectId, projectName, selected }: MergeRequestListProps) {
  const { session } = useConnection()
  const personalWorkspace = usePersonalWorkspace(session)
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const initial = useMemo(() => makeInitialState(initialParams, initialQuery, projectId, session?.user.id), [initialParams, initialQuery, projectId, session?.user.id])
  const [draft, setDraft] = useState<SearchDraft>(initial.draft)
  const [showAdvanced, setShowAdvanced] = useState(() => hasAdvancedFilters(initial.draft, projectName ? projectId : undefined))
  const [applied, setApplied] = useState<AppliedSearch | null>(initial.error ? null : initial.applied)
  const [filterError, setFilterError] = useState<string | null>(initial.error)
  const [savedSearches, setSavedSearches] = useState<StoredSearch[]>(() => readSavedSearches(scope))
  const [saveLabel, setSaveLabel] = useState('')
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false)
  const [renameLabels, setRenameLabels] = useState<Record<string, string>>({})
  const [pipelineOpenError, setPipelineOpenError] = useState<string | null>(null)
  const query = useMemo<MergeRequestsQuery | null>(() => applied && session ? buildQuery(applied, session.user.id) : null, [applied, session])
  const result = useGitLabQuery(session?.id ?? null, query)

  useEffect(() => {
    const focus = () => searchInputRef.current?.focus()
    globalThis.addEventListener('gitlab-focus-project-search', focus)
    return () => globalThis.removeEventListener('gitlab-focus-project-search', focus)
  }, [])

  const emitApplied = (next: AppliedSearch) => {
    onSearchStateChange?.(serializeSearch(next))
  }

  const applyDraft = () => {
    const error = validateDraft(draft, session?.user.id)
    if (error) {
      setFilterError(error)
      return
    }
    const next: AppliedSearch = { ...draft, page: 1 }
    setFilterError(null)
    setApplied(next)
    emitApplied(next)
  }

  const saveSearch = (): boolean => {
    const error = validateDraft(draft, session?.user.id)
    if (error) {
      setFilterError(error)
      return false
    }
    const nextSearch: StoredSearch = {
      assignee: cleanOptional(draft.assignee),
      authorId: cleanOptional(draft.authorId),
      id: `search-${Date.now()}`,
      label: cleanOptional(saveLabel) ?? defaultSearchLabel(draft),
      orderBy: draft.orderBy,
      projectId: cleanOptional(draft.projectId),
      query: draft.search.trim(),
      reviewer: cleanOptional(draft.reviewer),
      sort: draft.sort,
      state: draft.state,
      updatedAfter: cleanOptional(draft.updatedAfter),
      updatedBefore: cleanOptional(draft.updatedBefore),
    }
    const next = [nextSearch, ...savedSearches.filter((item) => !sameSavedSearch(item, nextSearch))].slice(0, 20)
    setSavedSearches(next)
    writeSavedSearches(scope, next)
    setSaveLabel('')
    setFilterError(null)
    return true
  }

  const applySavedSearch = (saved: SavedMergeRequestSearch) => {
    const nextDraft: SearchDraft = {
      assignee: saved.assignee ?? '',
      authorId: saved.authorId ?? '',
      projectId: saved.projectId ?? '',
      reviewer: saved.reviewer ?? '',
      search: saved.query,
      state: saved.state,
      updatedAfter: saved.updatedAfter ?? '',
      updatedBefore: saved.updatedBefore ?? '',
      orderBy: validOrderBy(saved.orderBy) ? saved.orderBy : 'updated_at',
      sort: validSort(saved.sort) ? saved.sort : 'desc',
    }
    const error = validateDraft(nextDraft, session?.user.id)
    setDraft(nextDraft)
    if (error) {
      setFilterError(error)
      setApplied(null)
      return
    }
    const next: AppliedSearch = { ...nextDraft, page: 1 }
    setFilterError(null)
    setApplied(next)
    emitApplied(next)
  }

  const updatePage = (page: number) => {
    if (!applied) return
    const next = { ...applied, page }
    setApplied(next)
    emitApplied(next)
  }

  const openPipeline = async (url: string) => {
    if (!session) return
    try {
      await openGitLabUrl(session.id, url)
      setPipelineOpenError(null)
    } catch (error) {
      setPipelineOpenError(normalizeGitLabError(error).message)
    }
  }

  const renameSavedSearch = (saved: StoredSearch) => {
    const label = cleanOptional(renameLabels[saved.id])
    if (!label || label === saved.label) return
    const next = savedSearches.map((item) => item.id === saved.id ? { ...item, label } : item)
    setSavedSearches(next)
    writeSavedSearches(scope, next)
    setRenameLabels((current) => ({ ...current, [saved.id]: label }))
  }

  const deleteSavedSearch = (id: string) => {
    const next = savedSearches.filter((item) => item.id !== id)
    setSavedSearches(next)
    writeSavedSearches(scope, next)
    setRenameLabels((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
  }

  if (!session) {
    return <PaneEmpty description="GitLabに接続すると、レビュー対象を検索できます。" title="GitLabに接続してください"><Button href="#client/settings" variant="contained">接続設定を開く</Button></PaneEmpty>
  }

  const personalQueue = personalQueueFor(initialParams, session.user.id)
  const title = projectName ?? (personalQueue === 'assigned' ? '自分の担当MR' : personalQueue === 'created' ? '自分が作成' : personalQueue === 'waiting' ? 'レビュー待ち' : 'MR検索')
  const advancedActive = hasAdvancedFilters(draft, projectName ? projectId : undefined)
  const page = applied?.page ?? 1
  const freshness = result.stale ? `保存済み · ${formatFetchedAt(result.snapshot?.fetchedAt)}` : result.refreshing ? '更新中…' : null

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<>
          <Tooltip title="保存済み検索"><IconButton aria-label={`保存済み検索を管理（${savedSearches.length}）`} onClick={() => setSavedSearchesOpen(true)}><BookmarksOutlinedIcon /></IconButton></Tooltip>
          <Tooltip title="更新"><span><IconButton aria-label="更新" disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        </>}
        subtitle={projectName ? 'プロジェクトのマージリクエスト' : undefined}
        title={title}
      >
        <Box component="form" onSubmit={(event) => { event.preventDefault(); applyDraft() }}>
          <TextField
            fullWidth
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            placeholder="タイトル・説明を検索"
            slotProps={{
              htmlInput: { 'aria-label': 'MRをタイトル・説明で検索' },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title="検索 (Enter)"><IconButton aria-label="検索" edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            inputRef={searchInputRef}
            value={draft.search}
          />
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            <Select aria-label="MRの状態" onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as MergeRequestState }))} sx={pillSelectSx} value={draft.state}>
              <MenuItem value="all">すべての状態</MenuItem>
              <MenuItem value="opened">Open</MenuItem>
              <MenuItem value="merged">Merged</MenuItem>
              <MenuItem value="closed">Closed</MenuItem>
            </Select>
            <Select aria-label="レビュー担当" displayEmpty onChange={(event) => setDraft((current) => ({ ...current, reviewer: event.target.value }))} sx={pillSelectSx} value={personSelectValue(draft.reviewer)}>
              <MenuItem value="">レビュアー: すべて</MenuItem>
              <MenuItem value="self">自分がレビュアー</MenuItem>
              <MenuItem value="id">レビュアーを指定</MenuItem>
            </Select>
            <Select aria-label="MR担当者" displayEmpty onChange={(event) => setDraft((current) => ({ ...current, assignee: event.target.value }))} sx={pillSelectSx} value={personSelectValue(draft.assignee)}>
              <MenuItem value="">担当: すべて</MenuItem>
              <MenuItem value="self">自分が担当</MenuItem>
              <MenuItem value="id">担当者を指定</MenuItem>
            </Select>
            <Select aria-label="MRの並び順" displayEmpty onChange={(event) => setDraft((current) => ({ ...current, orderBy: event.target.value as OrderBy }))} sx={pillSelectSx} value={draft.orderBy}>
              <MenuItem value="updated_at">更新日時</MenuItem>
              <MenuItem value="created_at">作成日時</MenuItem>
            </Select>
            <Select aria-label="並び順の方向" onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value as SortDirection }))} sx={pillSelectSx} value={draft.sort}>
              <MenuItem value="desc">新しい順</MenuItem>
              <MenuItem value="asc">古い順</MenuItem>
            </Select>
            <Button aria-controls="mr-advanced-filters" aria-expanded={showAdvanced} color={advancedActive ? 'primary' : 'inherit'} onClick={() => setShowAdvanced((current) => !current)} startIcon={<TuneRoundedIcon />} sx={{ color: advancedActive ? undefined : 'text.secondary', minHeight: 26, px: 1 }}>詳細条件{advancedActive ? ' · 設定あり' : ''}</Button>
          </Stack>
          {draft.reviewer !== '' && draft.reviewer !== 'self' ? <Box sx={{ mt: 1 }}><UserSearchPicker ariaLabel="MRのレビュアー" label="レビュアーを選択" onChange={(id) => setDraft((current) => ({ ...current, reviewer: id }))} value={draft.reviewer} /></Box> : null}
          {draft.assignee !== '' && draft.assignee !== 'self' ? <Box sx={{ mt: 1 }}><UserSearchPicker ariaLabel="MRの担当者" label="担当者を選択" onChange={(id) => setDraft((current) => ({ ...current, assignee: id }))} value={draft.assignee} /></Box> : null}
          <Collapse in={showAdvanced}>
            <Box id="mr-advanced-filters" sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', pt: 1.25 }}>
              <Box sx={{ gridColumn: '1 / -1' }}><UserSearchPicker ariaLabel="MRの作者" label="作者" onChange={(id) => setDraft((current) => ({ ...current, authorId: id }))} value={draft.authorId} /></Box>
              <TextField label="更新日（開始）" onChange={(event) => setDraft((current) => ({ ...current, updatedAfter: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（開始）' }, inputLabel: { shrink: true } }} type="date" value={toDateInputValue(draft.updatedAfter)} />
              <TextField label="更新日（終了）" onChange={(event) => setDraft((current) => ({ ...current, updatedBefore: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（終了）' }, inputLabel: { shrink: true } }} type="date" value={toDateInputValue(draft.updatedBefore)} />
              <Box sx={{ gridColumn: '1 / -1' }}><ProjectSearchPicker ariaLabel="MRのプロジェクト" label="プロジェクト" onChange={(id) => setDraft((current) => ({ ...current, projectId: id }))} value={draft.projectId} /></Box>
            </Box>
          </Collapse>
          {filterError ? <Alert severity="error" sx={{ mt: 1 }}>{filterError}</Alert> : null}
        </Box>
      </PaneHeader>

      <Dialog fullWidth maxWidth="sm" onClose={() => setSavedSearchesOpen(false)} open={savedSearchesOpen}>
        <DialogTitle>保存済み検索</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box>
              <Typography color="text.secondary" sx={{ display: 'block', mb: 0.75 }} variant="overline">現在の条件を保存</Typography>
              <Stack direction="row" spacing={1}>
                <TextField fullWidth label="保存名（任意）" onChange={(event) => setSaveLabel(event.target.value)} value={saveLabel} />
                <Button onClick={() => { if (saveSearch()) setSavedSearchesOpen(false) }} startIcon={<SaveRoundedIcon />} type="button" variant="contained">検索を保存</Button>
              </Stack>
            </Box>
            <Box>
              <Typography color="text.secondary" sx={{ display: 'block', mb: 0.75 }} variant="overline">保存済み（{savedSearches.length}）</Typography>
              {savedSearches.length === 0 ? <Typography color="text.secondary" variant="body2">保存済み検索はありません。</Typography> : (
                <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {savedSearches.map((saved) => (
                    <Stack key={saved.id} spacing={0.75} sx={{ p: 1 }}>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Button onClick={() => { applySavedSearch(saved); setSavedSearchesOpen(false) }} sx={{ flex: 1, justifyContent: 'flex-start', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left', whiteSpace: 'normal' }}>
                          {saved.label}
                        </Button>
                        <Tooltip title="削除"><IconButton aria-label={`${saved.label}を削除`} onClick={() => deleteSavedSearch(saved.id)}><DeleteOutlineRoundedIcon /></IconButton></Tooltip>
                      </Stack>
                      <Stack direction="row" spacing={0.75}>
                        <TextField fullWidth label="保存名" onChange={(event) => setRenameLabels((current) => ({ ...current, [saved.id]: event.target.value }))} value={renameLabels[saved.id] ?? saved.label} />
                        <Button disabled={!cleanOptional(renameLabels[saved.id]) || (renameLabels[saved.id] ?? saved.label).trim() === saved.label} onClick={() => renameSavedSearch(saved)} startIcon={<EditOutlinedIcon />} sx={{ flexShrink: 0 }}>名前を変更</Button>
                      </Stack>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setSavedSearchesOpen(false)}>閉じる</Button></DialogActions>
      </Dialog>

      {result.data ? <PaneStatus>{result.data.length}件取得{page > 1 || result.snapshot?.nextPage ? ` · ページ ${page}` : ''}{freshness ? ` · ${freshness}` : ''}</PaneStatus> : null}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert severity="warning" sx={{ m: 1.5 }}>保存済みの結果を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {pipelineOpenError ? <Alert onClose={() => setPipelineOpenError(null)} severity="error" sx={{ m: 1.5 }}>CIパイプラインを開けませんでした: {pipelineOpenError}</Alert> : null}
        {result.loading && !result.data ? <LoadingRows /> : null}
        {!result.loading && !result.data && !result.error && !filterError ? <PaneEmpty description="検索語や状態を変えてください。検索対象はタイトルと説明です。" title="MRがありません" /> : null}
        {result.data ? <MergeRequestResults mergeRequests={result.data} onOpenMergeRequest={onOpenMergeRequest} onOpenPipeline={openPipeline} personalWorkspace={personalWorkspace} selected={selected ?? null} sessionId={session.id} /> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager hasNext={(result.snapshot?.nextPage ?? null) !== null} hasPrevious={page > 1} onNext={() => updatePage(page + 1)} onPrevious={() => updatePage(Math.max(1, page - 1))} page={page} /></Box> : null}
    </Box>
  )
}

const pillSelectSx = {
  bgcolor: 'transparent',
  fontSize: '0.75rem',
  height: 26,
  '& .MuiSelect-select': { pl: 1, pr: '24px !important', py: 0 },
  '& .MuiSvgIcon-root': { fontSize: 18, right: 4 },
} as const

function hasAdvancedFilters(draft: SearchDraft, projectId?: string) {
  return Boolean(draft.authorId || draft.updatedAfter || draft.updatedBefore || (draft.projectId && draft.projectId !== projectId))
}

function personalQueueFor(params: Record<string, string>, currentUserId: string): 'assigned' | 'created' | 'waiting' | null {
  if (params.assignee === 'self') return 'assigned'
  if (params.reviewer === 'self') return 'waiting'
  if (params.authorId === currentUserId) return 'created'
  return null
}

function MergeRequestResults({ mergeRequests, onOpenMergeRequest, onOpenPipeline, personalWorkspace, selected, sessionId }: { mergeRequests: MergeRequest[]; onOpenMergeRequest: (mergeRequest: MergeRequest) => void; onOpenPipeline: (url: string) => Promise<void>; personalWorkspace: ReturnType<typeof usePersonalWorkspace>; selected: MrRef | null; sessionId: string }) {
  if (mergeRequests.length === 0) return <PaneEmpty description="検索語や条件を変えてください。" title="条件に一致するMRがありません。" />
  return (
    <Box aria-label="MR検索結果" component="ul" onKeyDown={focusMergeRequestRow} role="list" sx={{ m: 0, p: 0 }}>
      {mergeRequests.map((mergeRequest) => <MergeRequestResultRow
        key={`${mergeRequest.projectId}:${mergeRequest.iid}`}
        mergeRequest={mergeRequest}
        onOpenMergeRequest={onOpenMergeRequest}
        onOpenPipeline={onOpenPipeline}
        personalWorkspace={personalWorkspace}
        selected={selected?.projectId === mergeRequest.projectId && selected.iid === mergeRequest.iid}
        sessionId={sessionId}
      />)}
    </Box>
  )
}

function MergeRequestResultRow({ mergeRequest, onOpenMergeRequest, onOpenPipeline, personalWorkspace, selected, sessionId }: { mergeRequest: MergeRequest; onOpenMergeRequest: (mergeRequest: MergeRequest) => void; onOpenPipeline: (url: string) => Promise<void>; personalWorkspace: ReturnType<typeof usePersonalWorkspace>; selected: boolean; sessionId: string }) {
  const ref = { iid: mergeRequest.iid, projectId: mergeRequest.projectId }
  const pinned = personalWorkspace.isPinned(ref)
  const unread = personalWorkspace.unreadCount(ref)
  const [pipelineRequested, setPipelineRequested] = useState(false)
  const pipelineQuery = useMemo<MergeRequestQuery | null>(() => pipelineRequested
    ? { iid: mergeRequest.iid, kind: 'mr', projectId: mergeRequest.projectId }
    : null, [mergeRequest.iid, mergeRequest.projectId, pipelineRequested])
  const pipelineResult = useGitLabQuery<MergeRequestQuery>(sessionId, pipelineQuery)
  const pipeline = mergeRequest.pipeline ?? (pipelineRequested ? pipelineResult.data?.pipeline : undefined)
  const pipelineConfirmedEmpty = pipelineRequested && !pipelineResult.loading && !pipelineResult.error && pipelineResult.data !== null && !pipeline
  const pipelineConfirmationMissing = pipelineRequested && !pipelineResult.loading && !pipelineResult.error && pipelineResult.data === null
  const people = [
    mergeRequest.assignees?.length ? `担当 ${mergeRequest.assignees.map((person) => person.name).join('、')}` : null,
    mergeRequest.reviewers?.length ? `レビュー ${mergeRequest.reviewers.map((person) => person.name).join('、')}` : null,
  ].filter(Boolean).join(' · ')
  const hasUnread = unread !== undefined && unread > 0

  return (
    <ListRow
      actions={<>
        {!pipelineRequested && !pipeline ? <Button onClick={() => setPipelineRequested(true)} sx={{ fontSize: 12, minHeight: 26, minWidth: 0, px: 0.75 }}>CIを確認</Button> : null}
        {pipelineRequested && pipelineResult.loading ? <Button disabled sx={{ fontSize: 12, minHeight: 26, minWidth: 0, px: 0.75 }}>確認中…</Button> : null}
        {pipelineRequested && (pipelineResult.error || pipelineConfirmationMissing) ? <Button onClick={() => pipelineResult.refresh()} sx={{ fontSize: 12, minHeight: 26, minWidth: 0, px: 0.75 }}>再試行</Button> : null}
        {pipeline?.webUrl ? <Tooltip title="CIパイプラインを開く"><IconButton aria-label={`!${mergeRequest.iid}のCIパイプラインを開く`} onClick={() => void onOpenPipeline(pipeline.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
        <Tooltip title={pinned ? '固定を解除' : 'MRを固定'}>
          <IconButton aria-label={`!${mergeRequest.iid}を${pinned ? '固定解除' : '固定'}`} color={pinned ? 'primary' : 'default'} onClick={() => personalWorkspace.togglePinned(ref)}>
            {pinned ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}
          </IconButton>
        </Tooltip>
      </>}
      leading={<MergeRequestStateIcon state={mergeRequest.state} />}
      onOpen={() => onOpenMergeRequest(mergeRequest)}
      selected={selected}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
        <Typography color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`} !{mergeRequest.iid}</Typography>
        <RelativeTime value={mergeRequest.updatedAt} />
      </Stack>
      <Typography sx={{ display: '-webkit-box', fontWeight: hasUnread || selected ? 600 : 500, lineHeight: 1.45, mt: 0.25, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{mergeRequest.title}</Typography>
      <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, flexWrap: 'wrap', minWidth: 0, mt: 0.5, rowGap: 0.25 }}>
        <Typography color="text.secondary" variant="caption">{mergeRequest.author.name}</Typography>
        {pinned ? <StarRoundedIcon aria-label="固定済み" color="primary" sx={{ fontSize: 14 }} /> : null}
        {mergeRequest.draft ? <Chip label="Draft" size="small" variant="outlined" /> : null}
        {pipeline ? <PipelineStatus status={pipeline.status} /> : null}
        {hasUnread ? <Tooltip title="既知のコメントの未読数です。未取得のコメントは含みません。"><Chip color="primary" label={`未読 ${unread}`} size="small" /></Tooltip> : null}
        {(mergeRequest.labels ?? []).map((label) => <Chip key={label} label={label} size="small" sx={{ maxWidth: '100%' }} variant="outlined" />)}
      </Stack>
      {people ? <Typography color="text.secondary" component="div" noWrap sx={{ mt: 0.25 }} variant="caption">{people}</Typography> : null}
      {pipelineConfirmedEmpty ? <Typography aria-label="CI情報なし" color="text.secondary" component="div" variant="caption">CI情報なし</Typography> : null}
      {pipelineRequested && pipelineResult.loading ? <Typography color="text.secondary" component="div" variant="caption">CI情報を確認中…</Typography> : null}
      {pipelineResult.error ? <Typography color="error.main" component="div" role="alert" variant="caption">CI状態を取得できませんでした: {pipelineResult.error.message}</Typography> : null}
      {pipelineConfirmationMissing ? <Typography color="error.main" component="div" role="alert" variant="caption">MR詳細の応答を確認できませんでした。</Typography> : null}
    </ListRow>
  )
}

function LoadingRows() {
  return <Box aria-label="MRを読み込み中" role="status" sx={{ p: 1.5 }}><Stack spacing={1.25}>{[0, 1, 2, 3].map((index) => <Stack key={index} spacing={0.5}><Box sx={{ bgcolor: 'action.hover', borderRadius: 0.5, height: 10, width: '40%' }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 0.5, height: 14, width: '90%' }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 0.5, height: 10, width: '60%' }} /></Stack>)}<Typography color="text.secondary" variant="caption">MRを読み込み中…</Typography></Stack></Box>
}

function focusMergeRequestRow(event: KeyboardEvent<HTMLElement>): void {
  if (isEditableTarget(event.target)) return
  const direction = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0
  if (!direction) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-mr-open="true"]'))
  if (rows.length === 0) return
  event.preventDefault()
  const activeIndex = rows.indexOf(document.activeElement as HTMLButtonElement)
  const nextIndex = activeIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, activeIndex + direction))
  rows[nextIndex]?.focus()
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}

export function buildQuery(filters: AppliedSearch, currentUserId?: string): MergeRequestsQuery {
  if (filters.assignee === 'self' && !isPositiveDecimalId(currentUserId ?? '')) throw new Error('接続ユーザーIDが不明なため、自分の担当MRを検索できません。')
  const query: MergeRequestsQuery = {
    kind: 'mrs',
    orderBy: filters.orderBy,
    page: filters.page,
    search: filters.search.trim(),
    sort: filters.sort,
    state: filters.state,
  }
  const projectId = cleanOptional(filters.projectId)
  const authorId = cleanOptional(filters.authorId)
  const reviewerId = filters.reviewer === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.reviewer)
  const assigneeId = filters.assignee === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.assignee)
  const updatedAfter = cleanOptional(filters.updatedAfter)
  const updatedBefore = cleanOptional(filters.updatedBefore)
  if (projectId) query.projectId = projectId
  if (authorId) query.authorId = authorId
  if (reviewerId) query.reviewerId = reviewerId
  if (assigneeId) query.assigneeId = assigneeId
  if (updatedAfter) query.updatedAfter = toGitLabDate(updatedAfter, false)
  if (updatedBefore) query.updatedBefore = toGitLabDate(updatedBefore, true)
  return query
}

export function serializeSearch(filters: AppliedSearch): Record<string, string> {
  const params: Record<string, string> = { page: String(filters.page), state: filters.state }
  addParam(params, 'search', filters.search)
  addParam(params, 'authorId', filters.authorId)
  addParam(params, 'assignee', filters.assignee)
  addParam(params, 'reviewer', filters.reviewer)
  addParam(params, 'updatedAfter', filters.updatedAfter)
  addParam(params, 'updatedBefore', filters.updatedBefore)
  addParam(params, 'projectId', filters.projectId)
  addParam(params, 'orderBy', filters.orderBy)
  addParam(params, 'sort', filters.sort)
  return params
}

function makeInitialState(params: Record<string, string>, initialQuery: string, projectId: string | undefined, currentUserId: string | undefined): { applied: AppliedSearch; draft: SearchDraft; error: string | null } {
  const state = isState(params.state) ? params.state : 'all'
  const draft: SearchDraft = {
    assignee: params.assignee ?? params.assigneeId ?? '',
    authorId: params.authorId ?? params.author ?? '',
    projectId: params.projectId ?? params.project ?? projectId ?? '',
    reviewer: params.reviewer ?? params.reviewerId ?? '',
    search: params.search ?? initialQuery,
    state,
    updatedAfter: params.updatedAfter ?? '',
    updatedBefore: params.updatedBefore ?? '',
    orderBy: validOrderBy(params.orderBy) ? params.orderBy : 'updated_at',
    sort: validSort(params.sort) ? params.sort : 'desc',
  }
  const page = parsePage(params.page)
  const error = validateDraft(draft, currentUserId)
  return { applied: { ...draft, page }, draft, error }
}

function validateDraft(draft: SearchDraft, currentUserId?: string): string | null {
  if (!isState(draft.state)) return 'MRの状態が不正です。'
  if (draft.projectId.trim() && !isPositiveDecimalId(draft.projectId)) return 'プロジェクトIDは1以上の数字で入力してください。'
  if (draft.authorId.trim() && !isPositiveDecimalId(draft.authorId)) return '作者IDは1以上の数字で入力してください。'
  if (draft.reviewer.trim() && draft.reviewer !== 'self' && !isPositiveDecimalId(draft.reviewer)) return 'レビュー担当者IDは1以上の数字で入力してください。'
  if (draft.reviewer === 'self' && currentUserId && !isPositiveDecimalId(currentUserId)) return '接続ユーザーIDを確認できないため、レビュー待ちを検索できません。'
  if (draft.assignee.trim() && draft.assignee !== 'self' && !isPositiveDecimalId(draft.assignee)) return '担当者IDは1以上の数字で入力してください。'
  if (draft.assignee === 'self' && !isPositiveDecimalId(currentUserId ?? '')) return '接続ユーザーIDを確認できないため、自分の担当MRを検索できません。'
  if (draft.updatedAfter && !isIsoDateValue(draft.updatedAfter)) return '更新日（開始）はISO形式の日付を入力してください。'
  if (draft.updatedBefore && !isIsoDateValue(draft.updatedBefore)) return '更新日（終了）はISO形式の日付を入力してください。'
  if (draft.updatedAfter && draft.updatedBefore && Date.parse(toGitLabDate(draft.updatedAfter, false)) > Date.parse(toGitLabDate(draft.updatedBefore, true))) return '更新日の開始は終了以前にしてください。'
  return null
}

function isPositiveDecimalId(value: string): boolean {
  return /^[1-9]\d*$/u.test(value.trim())
}

function isIsoDateValue(value: string): boolean {
  const normalized = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    const date = new Date(`${normalized}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(normalized)
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(normalized)) return false
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) return false
  const canonical = normalized.includes('.') ? normalized : normalized.replace(/Z$/u, '.000Z')
  return new Date(timestamp).toISOString() === canonical
}

function toGitLabDate(value: string, endOfDay: boolean): string {
  const normalized = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return `${normalized}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
  return normalized
}

function toDateInputValue(value: string): string {
  return value.trim().slice(0, 10)
}

function personSelectValue(value: string): string {
  if (value === '' || value === 'self') return value
  return 'id'
}

function parsePage(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/u.test(value)) return 1
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

function isState(value: string | undefined): value is MergeRequestState {
  return value === 'all' || value === 'opened' || value === 'closed' || value === 'merged'
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed || undefined
}

function addParam(params: Record<string, string>, key: string, value: string | undefined): void {
  const clean = cleanOptional(value)
  if (clean) params[key] = clean
}

function sameSavedSearch(left: SavedMergeRequestSearch, right: SavedMergeRequestSearch): boolean {
  return left.query === right.query
    && left.state === right.state
    && left.projectId === right.projectId
    && left.authorId === right.authorId
    && left.assignee === right.assignee
    && left.reviewer === right.reviewer
    && (left.orderBy ?? 'updated_at') === (right.orderBy ?? 'updated_at')
    && (left.sort ?? 'desc') === (right.sort ?? 'desc')
    && left.updatedAfter === right.updatedAfter
    && left.updatedBefore === right.updatedBefore
}

function defaultSearchLabel(draft: SearchDraft): string {
  return draft.search.trim() || `${draft.state} MR`
}

function validOrderBy(value: string | undefined): value is OrderBy {
  return value === 'updated_at' || value === 'created_at'
}

function validSort(value: string | undefined): value is SortDirection {
  return value === 'asc' || value === 'desc'
}

function formatFetchedAt(timestamp?: number): string {
  if (!timestamp) return '時刻不明'
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
