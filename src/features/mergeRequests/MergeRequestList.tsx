import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState } from '../../components/EmptyState'
import { StatusPill, type StatusTone } from '../../components/StatusPill'
import type { MergeRequest, MergeRequestState, MergeRequestsQuery } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { preferenceScope, readSavedSearches, type SavedMergeRequestSearch, writeSavedSearches } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'

export interface MergeRequestListProps {
  projectId?: string
  projectName?: string
  initialQuery?: string
  initialParams?: Record<string, string>
  onOpenMergeRequest: (mergeRequest: MergeRequest) => void
  onSearchStateChange?: (params: Record<string, string>) => void
}

interface SearchDraft {
  search: string
  state: MergeRequestState
  authorId: string
  reviewer: string
  updatedAfter: string
  updatedBefore: string
  projectId: string
}

interface AppliedSearch extends SearchDraft {
  page: number
}

export function MergeRequestList({ initialQuery = '', initialParams = {}, onOpenMergeRequest, onSearchStateChange, projectId, projectName }: MergeRequestListProps) {
  const { session } = useConnection()
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const initial = useMemo(() => makeInitialState(initialParams, initialQuery, projectId, session?.user.id), [initialParams, initialQuery, projectId, session?.user.id])
  const [draft, setDraft] = useState<SearchDraft>(initial.draft)
  const [applied, setApplied] = useState<AppliedSearch | null>(initial.error ? null : initial.applied)
  const [filterError, setFilterError] = useState<string | null>(initial.error)
  const [savedSearches, setSavedSearches] = useState(() => readSavedSearches(scope))
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

  const saveSearch = () => {
    const error = validateDraft(draft, session?.user.id)
    if (error) {
      setFilterError(error)
      return
    }
    const nextSearch: SavedMergeRequestSearch = {
      authorId: cleanOptional(draft.authorId),
      id: `search-${Date.now()}`,
      label: draft.search.trim() || `${draft.state} MR`,
      projectId: cleanOptional(draft.projectId),
      query: draft.search.trim(),
      reviewer: cleanOptional(draft.reviewer),
      state: draft.state,
      updatedAfter: cleanOptional(draft.updatedAfter),
      updatedBefore: cleanOptional(draft.updatedBefore),
    }
    const next = [nextSearch, ...savedSearches.filter((item) => !sameSavedSearch(item, nextSearch))].slice(0, 20)
    setSavedSearches(next)
    writeSavedSearches(scope, next)
    setFilterError(null)
  }

  const applySavedSearch = (saved: SavedMergeRequestSearch) => {
    const nextDraft: SearchDraft = {
      authorId: saved.authorId ?? '',
      projectId: saved.projectId ?? '',
      reviewer: saved.reviewer ?? '',
      search: saved.query,
      state: saved.state,
      updatedAfter: saved.updatedAfter ?? '',
      updatedBefore: saved.updatedBefore ?? '',
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

  if (!session) {
    return <Stack spacing={1.5}><Typography component="h1" variant="h1">Merge requests</Typography><EmptyState description="GitLab の接続設定が完了すると、ここにレビュー対象を表示できます。現在はデータを読み込んでいません。" title="Merge requests は未接続です" /></Stack>
  }

  return (
    <Box component="main" sx={{ minHeight: '100%', maxWidth: 1180, mx: 'auto' }}>
      <Stack spacing={2}>
        <Stack direction={{ md: 'row', xs: 'column' }} spacing={1.5} sx={{ alignItems: { md: 'end' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography color="primary.main" variant="overline">{projectName ? 'Project review' : 'Merge requests'}</Typography>
            <Typography component="h1" variant="h1">{projectName ?? 'Merge requests'}</Typography>
            <Typography color="text.secondary" variant="body2">タイトルと説明を検索し、状態を明示してレビュー対象を開きます。</Typography>
          </Box>
          <Button disabled={result.loading || result.refreshing} onClick={result.refresh} size="small" startIcon={<RefreshRoundedIcon />} variant="outlined">更新</Button>
        </Stack>

        <Paper component="form" onSubmit={(event) => { event.preventDefault(); applyDraft() }} sx={{ p: 1.5 }} variant="outlined">
          <Stack spacing={1.25}>
            <Stack direction={{ md: 'row', xs: 'column' }} spacing={1}>
              <TextField
                fullWidth
                label="MRを検索"
                onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
                placeholder="タイトルまたは説明"
                slotProps={{ htmlInput: { 'aria-label': 'MRをタイトル・説明で検索' }, input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> } }}
                inputRef={searchInputRef}
                value={draft.search}
              />
              <Select aria-label="MRの状態" onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as MergeRequestState }))} sx={{ minWidth: 150 }} value={draft.state}>
                <MenuItem value="all">すべて</MenuItem>
                <MenuItem value="opened">Open</MenuItem>
                <MenuItem value="merged">Merged</MenuItem>
                <MenuItem value="closed">Closed</MenuItem>
              </Select>
              <Button startIcon={<SearchRoundedIcon />} sx={{ minWidth: 112 }} type="submit" variant="contained">検索</Button>
              <Button onClick={saveSearch} startIcon={<SaveRoundedIcon />} sx={{ minWidth: 130 }} type="button" variant="outlined">検索を保存</Button>
            </Stack>
            <Stack direction={{ lg: 'row', xs: 'column' }} spacing={1}>
              <TextField
                label="作者ID"
                onChange={(event) => setDraft((current) => ({ ...current, authorId: event.target.value }))}
                placeholder="例: 42"
                slotProps={{ htmlInput: { 'aria-label': 'MRの作者ID' } }}
                value={draft.authorId}
              />
              <Select aria-label="レビュー担当" onChange={(event) => setDraft((current) => ({ ...current, reviewer: event.target.value }))} sx={{ minWidth: 190 }} value={reviewerSelectValue(draft.reviewer)}>
                <MenuItem value="">担当なし</MenuItem>
                <MenuItem value="self">自分へのレビュー待ち</MenuItem>
                <MenuItem value="id">指定した担当者ID</MenuItem>
              </Select>
              {draft.reviewer !== '' && draft.reviewer !== 'self' ? <TextField label="担当者ID" onChange={(event) => setDraft((current) => ({ ...current, reviewer: event.target.value }))} placeholder="例: 42" slotProps={{ htmlInput: { 'aria-label': 'MRのレビュー担当者ID' } }} value={draft.reviewer} /> : null}
              <TextField label="更新日（開始）" onChange={(event) => setDraft((current) => ({ ...current, updatedAfter: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（開始）' } }} type="date" value={toDateInputValue(draft.updatedAfter)} />
              <TextField label="更新日（終了）" onChange={(event) => setDraft((current) => ({ ...current, updatedBefore: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（終了）' } }} type="date" value={toDateInputValue(draft.updatedBefore)} />
              <TextField label="プロジェクトID" onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))} placeholder="例: 7" slotProps={{ htmlInput: { 'aria-label': 'MRのプロジェクトID' } }} value={draft.projectId} />
            </Stack>
            {filterError ? <Alert severity="error">{filterError}</Alert> : null}
            {savedSearches.length > 0 ? (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
                <HistoryRoundedIcon color="disabled" fontSize="small" />
                <Typography color="text.secondary" variant="caption">保存済み</Typography>
                {savedSearches.slice(0, 6).map((saved) => <Chip clickable key={saved.id} label={saved.label} onClick={() => applySavedSearch(saved)} size="small" variant="outlined" />)}
              </Stack>
            ) : null}
          </Stack>
        </Paper>

        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh} size="small">再試行</Button>} severity="error">{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert severity="warning">保存済みの結果を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {result.stale && result.data ? <Typography color="text.secondary" variant="caption">保存済みデータを表示中 · {formatFetchedAt(result.snapshot?.fetchedAt)}</Typography> : null}
        {result.loading && !result.data ? <LoadingRows /> : null}
        {!result.loading && !result.data && !result.error && !filterError ? <EmptyState description="検索語や状態を変えてください。検索対象はタイトルと説明です。" title="MRがありません" /> : null}
        {result.data ? <MergeRequestResults mergeRequests={result.data} nextPage={result.snapshot?.nextPage ?? null} onNext={() => updatePage((applied?.page ?? 1) + 1)} onOpenMergeRequest={onOpenMergeRequest} onPrevious={() => updatePage(Math.max(1, (applied?.page ?? 1) - 1))} page={applied?.page ?? 1} /> : null}
      </Stack>
    </Box>
  )
}

function MergeRequestResults({ mergeRequests, nextPage, onNext, onOpenMergeRequest, onPrevious, page }: { mergeRequests: MergeRequest[]; nextPage: number | null; onNext: () => void; onOpenMergeRequest: (mergeRequest: MergeRequest) => void; onPrevious: () => void; page: number }) {
  return (
    <Paper variant="outlined">
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.5, py: 1 }}>
        <Typography sx={{ fontWeight: 700 }} variant="body2">検索結果</Typography>
        <Chip label={`${mergeRequests.length}件取得`} size="small" variant="outlined" />
      </Stack>
      <Divider />
      <List disablePadding>
        {mergeRequests.map((mergeRequest) => (
          <ListItemButton key={`${mergeRequest.projectId}:${mergeRequest.iid}`} onClick={() => onOpenMergeRequest(mergeRequest)} sx={{ alignItems: 'flex-start', px: 1.5, py: 1.25 }}>
            <ListItemText
              primary={<Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Typography sx={{ fontWeight: 700 }} variant="body2">{mergeRequest.title}</Typography><StatusPill label={formatState(mergeRequest.state)} size="small" tone={stateTone(mergeRequest.state)} /></Stack>}
              secondary={<Stack spacing={0.25} sx={{ mt: 0.35 }}><Typography color="text.secondary" variant="caption">{mergeRequest.projectId} · !{mergeRequest.iid} · {mergeRequest.author.name} · 更新 {formatDate(mergeRequest.updatedAt)}</Typography><Typography color="text.secondary" noWrap variant="body2">{mergeRequest.description || '説明はありません'}</Typography></Stack>}
            />
          </ListItemButton>
        ))}
        {mergeRequests.length === 0 ? <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary" variant="body2">条件に一致するMRがありません。</Typography></Box> : null}
      </List>
      <Divider />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end', p: 1 }}>
        <Typography color="text.secondary" sx={{ mr: 'auto' }} variant="caption">ページ {page}</Typography>
        <Button disabled={page <= 1} onClick={onPrevious} size="small">前へ</Button>
        <Button disabled={nextPage === null} onClick={onNext} size="small" variant="outlined">次へ</Button>
      </Stack>
    </Paper>
  )
}

function LoadingRows() {
  return <Paper aria-label="MRを読み込み中" sx={{ p: 2 }} variant="outlined"><Stack spacing={1}><Typography color="text.secondary" variant="body2">MRを読み込み中…</Typography><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 48 }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 48 }} /></Stack></Paper>
}

export function buildQuery(filters: AppliedSearch, currentUserId?: string): MergeRequestsQuery {
  const query: MergeRequestsQuery = {
    kind: 'mrs',
    page: filters.page,
    search: filters.search.trim(),
    state: filters.state,
  }
  const projectId = cleanOptional(filters.projectId)
  const authorId = cleanOptional(filters.authorId)
  const reviewerId = filters.reviewer === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.reviewer)
  const updatedAfter = cleanOptional(filters.updatedAfter)
  const updatedBefore = cleanOptional(filters.updatedBefore)
  if (projectId) query.projectId = projectId
  if (authorId) query.authorId = authorId
  if (reviewerId) query.reviewerId = reviewerId
  if (updatedAfter) query.updatedAfter = toGitLabDate(updatedAfter, false)
  if (updatedBefore) query.updatedBefore = toGitLabDate(updatedBefore, true)
  return query
}

export function serializeSearch(filters: AppliedSearch): Record<string, string> {
  const params: Record<string, string> = { page: String(filters.page), state: filters.state }
  addParam(params, 'search', filters.search)
  addParam(params, 'authorId', filters.authorId)
  addParam(params, 'reviewer', filters.reviewer)
  addParam(params, 'updatedAfter', filters.updatedAfter)
  addParam(params, 'updatedBefore', filters.updatedBefore)
  addParam(params, 'projectId', filters.projectId)
  return params
}

function makeInitialState(params: Record<string, string>, initialQuery: string, projectId: string | undefined, currentUserId: string | undefined): { applied: AppliedSearch; draft: SearchDraft; error: string | null } {
  const state = isState(params.state) ? params.state : 'all'
  const draft: SearchDraft = {
    authorId: params.authorId ?? params.author ?? '',
    projectId: params.projectId ?? params.project ?? projectId ?? '',
    reviewer: params.reviewer ?? params.reviewerId ?? '',
    search: params.search ?? initialQuery,
    state,
    updatedAfter: params.updatedAfter ?? '',
    updatedBefore: params.updatedBefore ?? '',
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

function reviewerSelectValue(value: string): string {
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
    && left.reviewer === right.reviewer
    && left.updatedAfter === right.updatedAfter
    && left.updatedBefore === right.updatedBefore
}

function formatState(state: string): string {
  if (state === 'opened' || state === 'open') return 'Open'
  if (state === 'merged') return 'Merged'
  if (state === 'closed') return 'Closed'
  return state || 'Unknown'
}

function stateTone(state: string): StatusTone {
  if (state === 'opened' || state === 'open') return 'success'
  if (state === 'merged') return 'info'
  if (state === 'closed') return 'default'
  return 'warning'
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

function formatFetchedAt(timestamp?: number): string {
  if (!timestamp) return '時刻不明'
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
