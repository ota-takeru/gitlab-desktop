import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import MarkChatUnreadRoundedIcon from '@mui/icons-material/MarkChatUnreadRounded'
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined'
import ThumbUpRoundedIcon from '@mui/icons-material/ThumbUpRounded'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ListRow } from '../../components/ListRow'
import { MergeRequestStateIcon } from '../../components/MergeRequestStateIcon'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { delayedRevealSx, paneResultsSx } from '../../components/paneSx'
import { Pager } from '../../components/Pager'
import { PipelineStatus } from '../../components/PipelineStatus'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon } from '../../components/StateIcon'
import type { MergeRequest, MergeRequestState, MergeRequestsQuery, MrApprovalsQuery } from '../../types/gitlab'
import { formatFetchedAt } from '../../lib/format'
import { normalizeGitLabError, openGitLabUrl } from '../../lib/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { preferenceScope, readSavedSearches, type SavedMergeRequestSearch, writeSavedSearches } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { usePersonalWorkspace, type MrRef } from '../shared/personalWorkspace'
import { listTitle } from './listTitle'
import { MergeRequestPreview, type PointerSpot } from './MergeRequestPreview'
import { personalQueueFor, type PersonalQueue } from './personalQueue'
import { GroupSearchPicker, ProjectSearchPicker, UserSearchPicker } from './SearchPickers'

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
  /** Leaves a personal queue for the search of all MRs, keeping the text typed so far. */
  onSearchAll?: (search: string) => void
  /** Tabs to the sibling lists, shown in place of the title. */
  navigation?: ReactNode
  /** The MR just returned from, as `<projectId>-<iid>`; its row keeps the selected look. */
  recentMrId?: string | null
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
  groupId: string
  labels: string
  sourceBranch: string
  targetBranch: string
  orderBy: OrderBy
  sort: SortDirection
}

interface AppliedSearch extends SearchDraft {
  page: number
}

export function MergeRequestList({ initialQuery = '', initialParams = {}, navigation, onOpenMergeRequest, onSearchAll, onSearchStateChange, projectId, projectName, recentMrId = null, selected }: MergeRequestListProps) {
  const { session } = useConnection()
  const personalWorkspace = usePersonalWorkspace(session)
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const initial = useMemo(() => makeInitialState(initialParams, initialQuery, projectId, session?.user.id), [initialParams, initialQuery, projectId, session?.user.id])
  const [draft, setDraft] = useState<SearchDraft>(initial.draft)
  // A project's branch shows as its own chip, so it does not open the detailed conditions.
  // Applied conditions show as chips, so the form to edit them starts closed.
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Choosing 「…を指定」 opens the person picker; the condition stays unset until a person is chosen.
  const [pickingReviewer, setPickingReviewer] = useState(false)
  const [pickingAssignee, setPickingAssignee] = useState(false)
  const [preview, setPreview] = useState<RowPreview | null>(null)
  const [applied, setApplied] = useState<AppliedSearch | null>(initial.error ? null : initial.applied)
  const [filterError, setFilterError] = useState<string | null>(initial.error)
  const [savedSearches, setSavedSearches] = useState<StoredSearch[]>(() => readSavedSearches(scope))
  const [saveLabel, setSaveLabel] = useState('')
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false)
  const [renameLabels, setRenameLabels] = useState<Record<string, string>>({})
  const [pipelineOpenError, setPipelineOpenError] = useState<string | null>(null)
  // Full paths of groups chosen in the picker; the condition itself keeps the ID.
  const [groupPaths, setGroupPaths] = useState<Record<string, string>>({})
  const query = useMemo<MergeRequestsQuery | null>(() => applied && session ? buildQuery(applied, session.user.id) : null, [applied, session])
  const result = useGitLabQuery(session?.id ?? null, query, { keepPrevious: true })

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
    setShowAdvanced(false)
  }

  // Saves the conditions the list shows, not text typed but not yet searched.
  const saveSearch = (): boolean => {
    if (!applied) {
      setFilterError('保存する前に検索条件を適用してください。')
      return false
    }
    const nextSearch: StoredSearch = {
      assignee: cleanOptional(applied.assignee),
      authorId: cleanOptional(applied.authorId),
      groupId: cleanOptional(applied.groupId),
      id: `search-${Date.now()}`,
      labels: canonicalLabels(applied.labels),
      label: cleanOptional(saveLabel) ?? defaultSearchLabel(applied),
      orderBy: applied.orderBy,
      projectId: cleanOptional(applied.projectId),
      query: applied.search.trim(),
      reviewer: cleanOptional(applied.reviewer),
      sort: applied.sort,
      sourceBranch: cleanOptional(applied.sourceBranch),
      state: applied.state,
      targetBranch: cleanOptional(applied.targetBranch),
      updatedAfter: cleanOptional(applied.updatedAfter),
      updatedBefore: cleanOptional(applied.updatedBefore),
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
      groupId: saved.groupId ?? '',
      labels: saved.labels ?? '',
      projectId: saved.projectId ?? (saved.groupId ? '' : projectId ?? ''),
      reviewer: saved.reviewer ?? '',
      search: saved.query,
      sourceBranch: saved.sourceBranch ?? '',
      state: saved.state,
      targetBranch: saved.targetBranch ?? '',
      updatedAfter: saved.updatedAfter ?? '',
      updatedBefore: saved.updatedBefore ?? '',
      orderBy: validOrderBy(saved.orderBy) ? saved.orderBy : 'updated_at',
      sort: validSort(saved.sort) ? saved.sort : 'desc',
    }
    const error = validateDraft(nextDraft, session?.user.id)
    setDraft(nextDraft)
    setPickingReviewer(false)
    setPickingAssignee(false)
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

  /**
   * Applies one condition at once, on top of what the list shows: pills and
   * chips change the results immediately, while typed text and the detailed
   * conditions wait for Enter or 「条件を適用」.
   */
  const applyConditions = (patch: Partial<SearchDraft>) => {
    const nextDraft = { ...draft, ...patch }
    const next: AppliedSearch = { ...(applied ?? nextDraft), ...patch, page: 1 }
    setDraft(nextDraft)
    const error = validateDraft(next, session?.user.id)
    if (error) {
      setFilterError(error)
      return
    }
    setFilterError(null)
    setApplied(next)
    emitApplied(next)
  }
  const closePreview = useCallback(() => setPreview(null), [])
  const openMergeRequest = (mergeRequest: MergeRequest) => {
    setPreview(null)
    onOpenMergeRequest(mergeRequest)
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
    return <PaneEmpty description="GitLabに接続すると、レビュー対象を検索できます。" title="GitLabに接続してください"><Button href="#client/settings" variant="contained">設定を開く</Button></PaneEmpty>
  }

  const personalQueue = personalQueueFor(initialParams, session.user.id)
  // A personal queue keeps its people condition; changing who is involved
  // belongs to MR search, so the queue's tab never changes under the reader.
  const fixedQueue = personalQueue !== null
  const title = projectName ?? (personalQueue === 'assigned' ? '担当しているMR' : personalQueue === 'created' ? '作成したMR' : personalQueue === 'waiting' ? 'レビュー依頼' : 'MR検索')
  const chips = !fixedQueue && applied ? conditionChips(applied, projectId, result.data ?? [], groupPaths) : []
  const advancedActive = hasAdvancedFilters(projectName ? { ...draft, sourceBranch: '' } : draft, projectName ? projectId : undefined)
  const page = applied?.page ?? 1
  const freshness = result.stale ? `保存済み · ${formatFetchedAt(result.snapshot?.fetchedAt)}` : result.refreshing ? '更新中…' : null
  // GitLab finds an MR by number (!123) only in a project's list.
  const projectScoped = Boolean(cleanOptional(draft.projectId))
  const numberOutsideProject = !projectScoped && /^!\d+$/u.test(draft.search.trim())
  const searchTarget = projectScoped ? '検索対象はタイトル・説明・MR番号（!123）です。' : '検索対象はタイトルと説明です。'
  const defaults = defaultConditions(projectId, personalQueue, session.user.id)
  const conditionsChanged = !sameConditions(applied ?? draft, defaults) || !sameConditions(draft, defaults)
  const resetConditions = () => {
    const next: AppliedSearch = { ...defaults, page: 1 }
    setDraft(defaults)
    setPickingReviewer(false)
    setPickingAssignee(false)
    setFilterError(null)
    setApplied(next)
    emitApplied(next)
  }
  const choosePerson = (field: 'reviewer' | 'assignee', value: string) => {
    const setPicking = field === 'reviewer' ? setPickingReviewer : setPickingAssignee
    if (value === 'id') {
      setPicking(true)
      return
    }
    setPicking(false)
    applyConditions({ [field]: value })
  }
  const showReviewerPicker = !fixedQueue && (pickingReviewer || (draft.reviewer !== '' && draft.reviewer !== 'self'))
  const showAssigneePicker = !fixedQueue && (pickingAssignee || (draft.assignee !== '' && draft.assignee !== 'self'))

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<>
          {fixedQueue ? null : <Tooltip title="保存済み検索"><IconButton aria-label={`保存済み検索を管理（${savedSearches.length}）`} onClick={() => setSavedSearchesOpen(true)}><BookmarksOutlinedIcon /></IconButton></Tooltip>}
          <Tooltip title="更新"><span><IconButton aria-label="更新" disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        </>}
        navigation={navigation}
        subtitle={projectName ? 'プロジェクトのマージリクエスト' : undefined}
        title={title}
      >
        <Box component="form" onSubmit={(event) => { event.preventDefault(); applyDraft() }}>
          <TextField
            fullWidth
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            helperText={numberOutsideProject ? 'MR番号での検索はプロジェクト内で使えます' : undefined}
            placeholder={fixedQueue ? `${title}の中を検索` : projectScoped ? 'タイトル・説明・MR番号（!123）を検索' : 'タイトル・説明を検索'}
            slotProps={{
              htmlInput: { 'aria-label': fixedQueue ? `${title}をタイトル・説明で検索` : projectScoped ? 'MRをタイトル・説明・MR番号で検索' : 'MRをタイトル・説明で検索' },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title="検索 (Enter)"><IconButton aria-label="検索" edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            inputRef={searchInputRef}
            value={draft.search}
          />
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            <Select aria-label="MRの状態" onChange={(event) => applyConditions({ state: event.target.value as MergeRequestState })} sx={pillSelectSx} value={draft.state}>
              <MenuItem value="all">すべての状態</MenuItem>
              <MenuItem value="opened">Open</MenuItem>
              <MenuItem value="merged">Merged</MenuItem>
              <MenuItem value="closed">Closed</MenuItem>
            </Select>
            {fixedQueue ? null : <>
            <Select aria-label="レビュー担当" displayEmpty onChange={(event) => choosePerson('reviewer', event.target.value)} sx={pillSelectSx} value={personSelectValue(draft.reviewer, pickingReviewer)}>
              <MenuItem value="">レビュアー: すべて</MenuItem>
              <MenuItem value="self">自分がレビュアー</MenuItem>
              <MenuItem value="id">レビュアーを指定</MenuItem>
            </Select>
            <Select aria-label="MR担当者" displayEmpty onChange={(event) => choosePerson('assignee', event.target.value)} sx={pillSelectSx} value={personSelectValue(draft.assignee, pickingAssignee)}>
              <MenuItem value="">担当者: すべて</MenuItem>
              <MenuItem value="self">自分が担当</MenuItem>
              <MenuItem value="id">担当者を指定</MenuItem>
            </Select>
            </>}
            <Select aria-label="MRの並び順" displayEmpty onChange={(event) => applyConditions({ orderBy: event.target.value as OrderBy })} sx={pillSelectSx} value={draft.orderBy}>
              <MenuItem value="updated_at">更新日時</MenuItem>
              <MenuItem value="created_at">作成日時</MenuItem>
            </Select>
            <Select aria-label="並び順の方向" onChange={(event) => applyConditions({ sort: event.target.value as SortDirection })} sx={pillSelectSx} value={draft.sort}>
              <MenuItem value="desc">新しい順</MenuItem>
              <MenuItem value="asc">古い順</MenuItem>
            </Select>
            {conditionsChanged ? <Button onClick={resetConditions} sx={{ color: 'text.secondary', px: 1 }}>条件をクリア</Button> : null}
            {fixedQueue && onSearchAll ? <Button onClick={() => onSearchAll(draft.search.trim())} startIcon={<SearchRoundedIcon />} sx={{ ml: 'auto', px: 1 }}>{draft.search.trim() ? `すべてのMRから「${shorten(draft.search.trim(), 24)}」を検索` : 'すべてのMRから検索'}</Button> : null}
            {fixedQueue ? null : <Button aria-controls="mr-advanced-filters" aria-expanded={showAdvanced} color={advancedActive ? 'primary' : 'inherit'} onClick={() => setShowAdvanced((current) => !current)} startIcon={<TuneRoundedIcon />} sx={{ color: advancedActive ? undefined : 'text.secondary', minHeight: 26, px: 1 }}>詳細条件</Button>}
          </Stack>
          {/* Every applied condition beyond the pills is a chip, wherever the list was opened from. */}
          {chips.length ? <Stack aria-label="適用中の条件" direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {chips.map((chip) => <Chip color="primary" deleteIcon={<CancelRoundedIcon aria-label={`${chip.name}の絞り込みを解除`} />} key={chip.name} label={chip.label} onClick={() => setShowAdvanced(true)} onDelete={() => applyConditions(chip.clear)} size="small" sx={{ fontFamily: chip.code ? 'code.fontFamily' : undefined, maxWidth: '100%' }} variant="outlined" />)}
          </Stack> : null}
          {/* A chosen person applies at once, like the pill that opened the picker. */}
          {showReviewerPicker ? <Box sx={{ mt: 1 }}><UserSearchPicker ariaLabel="MRのレビュアー" label="レビュアー" onChange={(id) => applyConditions({ reviewer: id })} value={draft.reviewer} /></Box> : null}
          {showAssigneePicker ? <Box sx={{ mt: 1 }}><UserSearchPicker ariaLabel="MRの担当者" label="担当者" onChange={(id) => applyConditions({ assignee: id })} value={draft.assignee} /></Box> : null}
          <Collapse in={showAdvanced && !fixedQueue}>
            {/* Bounded so a short window keeps room for the results; the panel scrolls inside. */}
            <Box id="mr-advanced-filters" sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxHeight: '40vh', overflowY: 'auto', pr: 0.5, pt: 1.5 }}>
              <Box sx={{ gridColumn: '1 / -1' }}><UserSearchPicker ariaLabel="MRの作者" label="作者" onChange={(id) => setDraft((current) => ({ ...current, authorId: id }))} value={draft.authorId} /></Box>
              <TextField label="更新日（開始）" onChange={(event) => setDraft((current) => ({ ...current, updatedAfter: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（開始）' }, inputLabel: { shrink: true } }} type="date" value={toDateInputValue(draft.updatedAfter)} />
              <TextField label="更新日（終了）" onChange={(event) => setDraft((current) => ({ ...current, updatedBefore: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（終了）' }, inputLabel: { shrink: true } }} type="date" value={toDateInputValue(draft.updatedBefore)} />
              <TextField label="ラベル" onChange={(event) => setDraft((current) => ({ ...current, labels: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRのラベル' } }} helperText="複数指定する場合はカンマで区切ります。" value={draft.labels} />
              <TextField helperText="ブランチ名の完全一致" label="ソースブランチ" onChange={(event) => setDraft((current) => ({ ...current, sourceBranch: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRのソースブランチ' } }} value={draft.sourceBranch} />
              <TextField helperText="ブランチ名の完全一致" label="ターゲットブランチ" onChange={(event) => setDraft((current) => ({ ...current, targetBranch: event.target.value }))} slotProps={{ htmlInput: { 'aria-label': 'MRのターゲットブランチ' } }} value={draft.targetBranch} />
              <Box sx={{ gridColumn: '1 / -1' }}><ProjectSearchPicker ariaLabel="MRのプロジェクト" label="プロジェクト" onChange={(id) => setDraft((current) => ({ ...current, groupId: '', projectId: id }))} value={draft.projectId} /></Box>
              <Box sx={{ gridColumn: '1 / -1' }}><GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={(id, fullPath) => { if (fullPath) setGroupPaths((current) => ({ ...current, [id]: fullPath })); setDraft((current) => ({ ...current, groupId: id, projectId: '' })) }} selectedPath={groupPaths[draft.groupId]} value={draft.groupId} /></Box>
            </Box>
            <Stack direction="row" sx={{ justifyContent: 'flex-end', pt: 1 }}><Button type="submit" variant="contained">条件を適用</Button></Stack>
          </Collapse>
          {filterError ? <Alert severity="error" sx={{ mt: 1 }}>{filterError}</Alert> : null}
        </Box>
      </PaneHeader>

      <Dialog fullWidth maxWidth="sm" onClose={() => setSavedSearchesOpen(false)} open={savedSearchesOpen}>
        <DialogTitle>保存済み検索</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box>
              <Typography color="textSecondary" sx={{ display: 'block', mb: 1 }} variant="overline">適用中の条件を保存</Typography>
              <Stack direction="row" spacing={1}>
                <TextField fullWidth label="保存名（任意）" onChange={(event) => setSaveLabel(event.target.value)} value={saveLabel} />
                <Button onClick={() => { if (saveSearch()) setSavedSearchesOpen(false) }} startIcon={<SaveRoundedIcon />} type="button" variant="contained">検索を保存</Button>
              </Stack>
            </Box>
            <Box>
              <Typography color="textSecondary" sx={{ display: 'block', mb: 1 }} variant="overline">保存済み（{savedSearches.length}）</Typography>
              {savedSearches.length === 0 ? <Typography color="textSecondary" variant="body2">保存済み検索はありません。</Typography> : (
                <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {savedSearches.map((saved) => (
                    <Stack key={saved.id} spacing={1} sx={{ p: 1 }}>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Button onClick={() => { applySavedSearch(saved); setSavedSearchesOpen(false) }} sx={{ flex: 1, justifyContent: 'flex-start', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left', whiteSpace: 'normal' }}>
                          {saved.label}
                        </Button>
                        <Tooltip title="削除"><IconButton aria-label={`${saved.label}を削除`} onClick={() => deleteSavedSearch(saved.id)}><DeleteOutlineRoundedIcon /></IconButton></Tooltip>
                      </Stack>
                      <Stack direction="row" spacing={1}>
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

      <PaneStatus announcement={result.data && !result.previous ? `MR ${result.data.length}件（ページ ${page}）` : null}>{result.data && !result.previous ? <>{result.data.length}件取得{page > 1 || result.snapshot?.nextPage ? ` · ページ ${page}` : ''}{freshness ? ` · ${freshness}` : ''}</> : result.loading || result.previous ? 'MRを読み込み中…' : result.error ? '取得に失敗しました' : null}</PaneStatus>
      {/* The preview sits beside the results, so it hides none of them. */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box aria-busy={result.previous} sx={paneResultsSx(result.previous)}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="warning" sx={{ m: 1.5 }}>保存済みの結果を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {pipelineOpenError ? <Alert onClose={() => setPipelineOpenError(null)} severity="error" sx={{ m: 1.5 }}>CIパイプラインを開けませんでした: {pipelineOpenError}</Alert> : null}
        {result.loading && !result.data ? <LoadingRows /> : null}
        {!result.loading && !result.data && !result.error && !filterError ? <PaneEmpty description={`検索語や状態を変えてください。${searchTarget}`} title="MRがありません" /> : null}
        {result.data && result.data.length === 0 ? <PaneEmpty description={<>適用中の条件: {conditionSummary(applied ?? { ...draft, page }, personalQueue, projectId)}<br />{searchTarget}</>} title="条件に一致するMRがありません">{conditionsChanged ? <Button onClick={resetConditions} variant="outlined">条件をクリア</Button> : null}</PaneEmpty> : null}
        {result.data?.length ? <MergeRequestResults currentUserId={session.user.id} grouping={personalQueue === 'waiting' ? 'mine' : personalQueue ? 'any' : null} mergeRequests={result.data} onFocusRow={(next) => setPreview((current) => current ? next : current)} onOpenMergeRequest={openMergeRequest} onOpenPipeline={openPipeline} onPreview={(next) => setPreview((current) => current?.mergeRequest.id === next.mergeRequest.id ? null : next)} orderBy={applied?.orderBy ?? 'updated_at'} personalWorkspace={personalWorkspace} previewing={preview?.mergeRequest ?? null} recentMrId={recentMrId} selected={selected ?? null} sessionId={session.id} showProject={!projectName} /> : null}
      </Box>
      {preview ? <MergeRequestPreview approval={preview.approval} closeAt={preview.closeAt} mergeRequest={preview.mergeRequest} onClose={closePreview} onOpen={() => openMergeRequest(preview.mergeRequest)} /> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager hasNext={(result.snapshot?.nextPage ?? null) !== null} hasPrevious={page > 1} onNext={() => updatePage(page + 1)} onPrevious={() => updatePage(Math.max(1, page - 1))} page={page} /></Box> : null}
    </Box>
  )
}

/** Condition selects are the theme's small Select on the pane surface, with caption-sized text. */
// Body-size text and an 18px arrow, so the text is not lost inside the 32px control.
const pillSelectSx = { bgcolor: 'transparent', typography: 'body2', '& .MuiSelect-icon': { fontSize: 18 } } as const

/** The approval line of the preview, saying what the row's approval mark says. */
function approvalText(approval: RowApproval | null, state: string): string | null {
  if (!approval) return null
  if (approval.count === 0) return state === 'opened' ? '未承認' : null
  return approval.byMe ? `自分を含む${approval.count}人が承認済み` : `${approval.count}人が承認済み`
}

interface ConditionChip { name: string; label: string; clear: Partial<SearchDraft>; code?: boolean }

/**
 * Applied conditions other than the text, state, order and people pills.
 * IDs are named from the fetched rows when they say who or what the ID is.
 */
function conditionChips(applied: AppliedSearch, fixedProjectId: string | undefined, rows: MergeRequest[], groupPaths: Record<string, string> = {}): ConditionChip[] {
  const chips: ConditionChip[] = []
  if (applied.projectId && applied.projectId !== fixedProjectId) {
    const path = rows.find((row) => row.projectId === applied.projectId)?.projectPath
    chips.push({ clear: { projectId: '' }, label: `プロジェクト: ${path || `ID ${applied.projectId}`}`, name: 'プロジェクト' })
  }
  if (applied.groupId) chips.push({ clear: { groupId: '' }, label: `グループ: ${groupPaths[applied.groupId] ?? (/^\d+$/u.test(applied.groupId) ? `ID ${applied.groupId}` : applied.groupId)}`, name: 'グループ' })
  if (applied.authorId) {
    const author = rows.find((row) => row.author.id === applied.authorId)?.author.name
    chips.push({ clear: { authorId: '' }, label: `作者: ${author ?? `ID ${applied.authorId}`}`, name: '作者' })
  }
  if (applied.labels) chips.push({ clear: { labels: '' }, label: `ラベル: ${parseLabels(applied.labels).join(', ')}`, name: 'ラベル' })
  if (applied.sourceBranch) chips.push({ clear: { sourceBranch: '' }, code: true, label: `ブランチ: ${applied.sourceBranch}`, name: 'ブランチ' })
  if (applied.targetBranch) chips.push({ clear: { targetBranch: '' }, code: true, label: `ターゲット: ${applied.targetBranch}`, name: 'ターゲットブランチ' })
  if (applied.updatedAfter || applied.updatedBefore) chips.push({ clear: { updatedAfter: '', updatedBefore: '' }, label: `更新日: ${toDateInputValue(applied.updatedAfter)}〜${toDateInputValue(applied.updatedBefore)}`, name: '更新日' })
  return chips
}

const stateLabels: Record<MergeRequestState, string> = { all: 'すべての状態', closed: 'Closed', merged: 'Merged', opened: 'Open' }
const queueConditions: Record<PersonalQueue, string> = { assigned: '自分が担当（固定）', created: '自分が作成（固定）', waiting: '自分がレビュアー（固定）' }

/** Every condition behind an empty result, including the one a personal queue fixes. */
function conditionSummary(applied: AppliedSearch, personalQueue: PersonalQueue | null, fixedProjectId: string | undefined): string {
  const parts = [personalQueue ? queueConditions[personalQueue] : null, `状態: ${stateLabels[applied.state]}`, applied.search.trim() ? `検索語「${applied.search.trim()}」` : null]
  if (!personalQueue) {
    parts.push(personLabel('レビュアー', applied.reviewer), personLabel('担当者', applied.assignee), ...conditionChips(applied, fixedProjectId, []).map((chip) => chip.label))
  }
  return parts.filter(Boolean).join(' · ')
}

function personLabel(role: string, value: string): string | null {
  if (!value) return null
  return value === 'self' ? `${role}: 自分` : `${role}: ID ${value}`
}

/** What 「条件をクリア」 returns to: the list as first opened, keeping a queue's person and a project's scope. */
function defaultConditions(projectId: string | undefined, personalQueue: PersonalQueue | null, currentUserId: string): SearchDraft {
  const base: SearchDraft = { assignee: '', authorId: '', groupId: '', labels: '', orderBy: 'updated_at', projectId: projectId ?? '', reviewer: '', search: '', sort: 'desc', sourceBranch: '', state: 'all', targetBranch: '', updatedAfter: '', updatedBefore: '' }
  if (personalQueue === 'waiting') return { ...base, reviewer: 'self', state: 'opened' }
  if (personalQueue === 'assigned') return { ...base, assignee: 'self', state: 'opened' }
  if (personalQueue === 'created') return { ...base, authorId: currentUserId, state: 'opened' }
  return base
}

function sameConditions(left: SearchDraft, right: SearchDraft): boolean {
  return (Object.keys(right) as Array<keyof SearchDraft>).every((key) => key === 'labels' ? canonicalLabels(left.labels) === canonicalLabels(right.labels) : left[key].trim() === right[key].trim())
}

function hasAdvancedFilters(draft: SearchDraft, projectId?: string) {
  return Boolean(draft.authorId || draft.groupId || draft.labels || draft.sourceBranch || draft.targetBranch || draft.updatedAfter || draft.updatedBefore || (draft.projectId && draft.projectId !== projectId))
}

/** Approval of one row: who approved, or null while unknown. */
interface RowApproval { byMe: boolean; count: number }

/**
 * Personal queues are split by approval like GitLab's dashboard: the review
 * queue by whether you approved, your own MRs by whether anyone has. Approvals
 * of the whole page come from one request; until they arrive the grouped queues
 * show placeholders instead of a flat list that would then reorder.
 */
/** `closeAt` is where the pointer opened the preview, so a second click there closes it. */
interface RowPreview { approval: string | null; closeAt?: PointerSpot; mergeRequest: MergeRequest }

function MergeRequestResults({ currentUserId, grouping, mergeRequests, onFocusRow, onOpenMergeRequest, onOpenPipeline, onPreview, orderBy, personalWorkspace, previewing, recentMrId, selected, sessionId, showProject }: { currentUserId: string; grouping: 'mine' | 'any' | null; mergeRequests: MergeRequest[]; onFocusRow: (preview: RowPreview) => void; onOpenMergeRequest: (mergeRequest: MergeRequest) => void; onOpenPipeline: (url: string) => Promise<void>; onPreview: (preview: RowPreview) => void; orderBy: OrderBy; personalWorkspace: ReturnType<typeof usePersonalWorkspace>; previewing: MergeRequest | null; recentMrId: string | null; selected: MrRef | null; sessionId: string; showProject: boolean }) {
  const itemsKey = mergeRequests.filter((mergeRequest) => mergeRequest.projectPath).map((mergeRequest) => `${mergeRequest.projectPath}!${mergeRequest.iid}`).join(' ')
  const approvalsQuery = useMemo<MrApprovalsQuery | null>(() => itemsKey
    ? { items: itemsKey.split(' ').map((key) => { const at = key.lastIndexOf('!'); return { iid: key.slice(at + 1), projectPath: key.slice(0, at) } }), kind: 'mrApprovals' }
    : null, [itemsKey])
  const approvals = useGitLabQuery<MrApprovalsQuery>(sessionId, approvalsQuery)
  const approvalOf = (mergeRequest: MergeRequest): RowApproval | null => {
    const approvedBy = approvals.data?.find((item) => item.projectPath === mergeRequest.projectPath && item.iid === mergeRequest.iid)?.approvedBy
    return approvedBy ? { byMe: approvedBy.includes(currentUserId), count: approvedBy.length } : null
  }

  // Rows show at once; only their approval mark waits for the approvals request.
  const approvalPending = Boolean(approvalsQuery) && !approvals.data && approvals.loading
  const row = (mergeRequest: MergeRequest) => <MergeRequestResultRow
    approval={approvalOf(mergeRequest)}
    approvalPending={approvalPending}
    key={`${mergeRequest.projectId}:${mergeRequest.iid}`}
    onFocusRow={() => onFocusRow({ approval: approvalText(approvalOf(mergeRequest), mergeRequest.state), mergeRequest })}
    onPreview={(closeAt) => onPreview({ approval: approvalText(approvalOf(mergeRequest), mergeRequest.state), closeAt, mergeRequest })}
    mergeRequest={mergeRequest}
    onOpenMergeRequest={onOpenMergeRequest}
    onOpenPipeline={onOpenPipeline}
    orderBy={orderBy}
    personalWorkspace={personalWorkspace}
    previewing={previewing?.id === mergeRequest.id}
    // The MR just returned from keeps the selected look, so the reader sees where they were.
    selected={(selected?.projectId === mergeRequest.projectId && selected.iid === mergeRequest.iid) || recentMrId === `${mergeRequest.projectId}-${mergeRequest.iid}`}
    showProject={showProject}
  />
  if (!grouping || !approvals.data) {
    return <>
      {approvals.error && !approvals.data ? <Typography color="textSecondary" component="div" sx={{ px: 1.5, py: 1 }} variant="caption">承認状態を取得できませんでした: {approvals.error.message}</Typography> : null}
      <Box aria-label="MR検索結果" component="ul" onKeyDown={moveListRowFocus} role="list" sx={{ m: 0, p: 0 }}>{mergeRequests.map(row)}</Box>
    </>
  }
  const [waitingLabel, doneLabel] = grouping === 'mine' ? ['自分の承認待ち', '自分が承認済み'] : ['承認待ち', '承認あり']
  const sections: Array<[string, MergeRequest[]]> = [[waitingLabel, []], [doneLabel, []], ['承認状態を確認できないMR', []]]
  for (const mergeRequest of mergeRequests) {
    const approval = approvalOf(mergeRequest)
    const done = approval && (grouping === 'mine' ? approval.byMe : approval.count > 0)
    sections[approval ? done ? 1 : 0 : 2][1].push(mergeRequest)
  }
  return (
    <Box aria-label="MR検索結果" onKeyDown={moveListRowFocus} role="group">
      {sections.filter(([label, items]) => items.length > 0 || label !== '承認状態を確認できないMR').map(([label, items]) => (
        <Box aria-label={label} component="section" key={label}>
          <Typography color="textSecondary" component="h2" sx={{ bgcolor: 'surface.nav', borderBottom: 1, borderColor: 'divider', display: 'block', px: 1.5, py: 0.5 }} variant="overline">{label} · {items.length}件</Typography>
          {items.length ? <Box aria-label={label} component="ul" role="list" sx={{ m: 0, p: 0 }}>{items.map(row)}</Box> : null}
        </Box>
      ))}
    </Box>
  )
}

/** Room on a row's last line for its buttons (preview, CI, pin), so they never cover a label. */
const ROW_ACTIONS_SPACE = 12

/** Labels shown on a row before the rest fold into 「+N」. */
const ROW_LABELS = 3

function MergeRequestResultRow({ approval, approvalPending, mergeRequest, onFocusRow, onOpenMergeRequest, onOpenPipeline, onPreview, orderBy, personalWorkspace, previewing, selected, showProject }: { approval: RowApproval | null; approvalPending: boolean; mergeRequest: MergeRequest; onFocusRow: () => void; onOpenMergeRequest: (mergeRequest: MergeRequest) => void; onOpenPipeline: (url: string) => Promise<void>; onPreview: (closeAt?: PointerSpot) => void; orderBy: OrderBy; personalWorkspace: ReturnType<typeof usePersonalWorkspace>; previewing: boolean; selected: boolean; showProject: boolean }) {
  const ref = { iid: mergeRequest.iid, projectId: mergeRequest.projectId }
  const labels = mergeRequest.labels ?? []
  const hiddenLabels = labels.slice(ROW_LABELS)
  // The time matches the order of the list; GitLab's creation time is used once the MR carries it.
  const createdAt = mergeRequest.createdAt
  const byCreation = orderBy === 'created_at' && Boolean(createdAt)
  const pinned = personalWorkspace.isPinned(ref)
  const unread = personalWorkspace.unreadCount(ref)
  // CI is shown only when GitLab included it; the row does not offer a lookup.
  const pipeline = mergeRequest.pipeline
  const hasUnread = unread !== undefined && unread > 0
  const pinButton = <Tooltip title={pinned ? '固定を外す' : 'サイドバーに固定'}><IconButton aria-label={pinned ? `!${mergeRequest.iid}の固定を外す` : `!${mergeRequest.iid}をサイドバーに固定`} color={pinned ? 'primary' : 'default'} onClick={() => personalWorkspace.togglePinned(ref, { projectPath: mergeRequest.projectPath ?? '', state: mergeRequest.state, title: mergeRequest.title })}>{pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}</IconButton></Tooltip>

  return (
    <ListRow
      actions={<>
        {previewing
          ? <Tooltip title="概要を閉じる (Space / Esc)"><IconButton aria-label={`!${mergeRequest.iid}の概要を閉じる`} aria-pressed color="primary" onClick={() => onPreview()}><VisibilityOffOutlinedIcon /></IconButton></Tooltip>
          : <Tooltip title="概要をプレビュー (Space)"><IconButton aria-label={`!${mergeRequest.iid}の概要をプレビュー`} onClick={(event) => onPreview(event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined)}><VisibilityOutlinedIcon /></IconButton></Tooltip>}
        {pipeline?.webUrl ? <Tooltip title="CIパイプラインを開く"><IconButton aria-label={`!${mergeRequest.iid}のCIパイプラインを開く`} onClick={() => void onOpenPipeline(pipeline.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
        {pinned ? null : pinButton}
      </>}
      // The state leads the row as an icon, so a list reads by shape and colour before words.
      leading={<MergeRequestStateIcon state={mergeRequest.state} />}
      // A pinned row keeps its pin in view: the mark and the button to unpin are one control.
      stickyActions={pinned ? pinButton : undefined}
      mrId={`${mergeRequest.projectId}-${mergeRequest.iid}`}
      onFocus={onFocusRow}
      onOpen={() => onOpenMergeRequest(mergeRequest)}
      onPreview={() => onPreview()}
      previewing={previewing}
      // The last line keeps ROW_ACTIONS_SPACE for the buttons itself.
      reserveActionsSpace={false}
      selected={selected}
    >
      {/* The time follows the MR's name instead of sitting at the far edge of a wide row. */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
        <Tooltip title={`${showProject ? `${mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`} ` : ''}!${mergeRequest.iid}`}><Typography color="textSecondary" noWrap sx={{ minWidth: 0 }} variant="caption">{showProject ? `${mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`} ` : ''}!{mergeRequest.iid}</Typography></Tooltip>
        <Typography aria-hidden color="textSecondary" variant="caption">·</Typography>
        <RelativeTime prefix={byCreation ? '作成' : '更新'} value={byCreation && createdAt ? createdAt : mergeRequest.updatedAt} />
      </Stack>
      <Typography sx={{ display: '-webkit-box', mt: 0.25, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="subtitle1">{listTitle(mergeRequest)}</Typography>
      <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, flexWrap: 'wrap', minWidth: 0, mt: 0.5, pr: ROW_ACTIONS_SPACE, rowGap: 0.25 }}>
        {/* States first, as icons with counts; their names are in the tooltips. */}
        {mergeRequest.draft ? <StateIcon icon={<EditNoteRoundedIcon fontSize="inherit" />} label="Draft" /> : null}
        {pipeline ? <PipelineStatus compact status={pipeline.status} /> : null}
        <ApprovalStatus approval={approval} pending={approvalPending} state={mergeRequest.state} />
        {hasUnread ? <Tooltip title={`未読 ${unread}件（既知のコメントの未読数です。未取得のコメントは含みません）`}><Chip aria-label={`未読 ${unread}`} color="primary" icon={<MarkChatUnreadRoundedIcon />} label={unread} size="small" /></Tooltip> : null}
        <Typography sx={{ fontWeight: 500 }} variant="caption">{mergeRequest.author.name}</Typography>
        {labels.slice(0, ROW_LABELS).map((label) => <Chip key={label} label={label} size="small" sx={{ maxWidth: '100%' }} variant="outlined" />)}
        {hiddenLabels.length ? <Tooltip title={hiddenLabels.join(', ')}><Chip aria-label={`ほかのラベル ${hiddenLabels.length}件: ${hiddenLabels.join(', ')}`} label={`+${hiddenLabels.length}`} size="small" variant="outlined" /></Tooltip> : null}
      </Stack>
    </ListRow>
  )
}

/** Approval beside the state: who approved, or that an open MR has none yet. A placeholder while loading; nothing when unknown. */
function ApprovalStatus({ approval, pending, state }: { approval: RowApproval | null; pending: boolean; state: string }) {
  if (!approval && pending) return <Box aria-label="承認状態を確認中" role="img" sx={{ bgcolor: 'action.hover', borderRadius: 1, flexShrink: 0, height: 10, width: 24 }} />
  if (!approval) return null
  if (approval.count === 0) {
    if (state !== 'opened') return null
    return <StateIcon count={0} icon={<ThumbUpOutlinedIcon fontSize="inherit" />} label="未承認" />
  }
  const label = approval.byMe ? '自分が承認済み' : `${approval.count}人が承認済み`
  // A filled thumb is the user's own approval; the count is everyone's.
  return <StateIcon count={approval.count} icon={approval.byMe ? <ThumbUpRoundedIcon fontSize="inherit" /> : <ThumbUpOutlinedIcon fontSize="inherit" />} label={label} tone="success" />
}

function LoadingRows() {
  return <Box aria-label="MRを読み込み中" role="status" sx={{ ...delayedRevealSx, p: 1.5 }}><Stack spacing={1.5}>{[0, 1, 2, 3].map((index) => <Stack key={index} spacing={0.5}><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 10, width: '40%' }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 14, width: '90%' }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 10, width: '60%' }} /></Stack>)}</Stack></Box>
}

function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text
}

export function buildQuery(filters: AppliedSearch, currentUserId?: string): MergeRequestsQuery {
  if (filters.assignee === 'self' && !isPositiveDecimalId(currentUserId ?? '')) throw new Error('接続ユーザーIDが不明なため、自分の担当MRを検索できません。')
  const projectId = cleanOptional(filters.projectId)
  const groupId = cleanOptional(filters.groupId)
  if (projectId && groupId) throw new Error('グループとプロジェクトは同時に指定できません。')
  if (groupId && !isValidGroupId(groupId)) throw new Error('グループIDまたはグループパスを確認してください。')
  const query: MergeRequestsQuery = {
    kind: 'mrs',
    orderBy: filters.orderBy,
    page: filters.page,
    search: filters.search.trim(),
    sort: filters.sort,
    state: filters.state,
  }
  const labels = parseLabels(filters.labels)
  const sourceBranch = cleanOptional(filters.sourceBranch)
  const targetBranch = cleanOptional(filters.targetBranch)
  const authorId = cleanOptional(filters.authorId)
  const reviewerId = filters.reviewer === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.reviewer)
  const assigneeId = filters.assignee === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.assignee)
  const updatedAfter = cleanOptional(filters.updatedAfter)
  const updatedBefore = cleanOptional(filters.updatedBefore)
  if (projectId) query.projectId = projectId
  if (groupId) query.groupId = groupId
  if (labels.length) query.labels = labels
  if (sourceBranch) query.sourceBranch = sourceBranch
  if (targetBranch) query.targetBranch = targetBranch
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
  addParam(params, 'groupId', filters.groupId)
  addParam(params, 'labels', canonicalLabels(filters.labels))
  addParam(params, 'sourceBranch', filters.sourceBranch)
  addParam(params, 'targetBranch', filters.targetBranch)
  addParam(params, 'orderBy', filters.orderBy)
  addParam(params, 'sort', filters.sort)
  return params
}

function makeInitialState(params: Record<string, string>, initialQuery: string, projectId: string | undefined, currentUserId: string | undefined): { applied: AppliedSearch; draft: SearchDraft; error: string | null } {
  const state = isState(params.state) ? params.state : 'all'
  const groupId = params.groupId ?? params.group ?? ''
  const draft: SearchDraft = {
    assignee: params.assignee ?? params.assigneeId ?? '',
    authorId: params.authorId ?? params.author ?? '',
    groupId,
    labels: params.labels ?? '',
    projectId: params.projectId ?? params.project ?? (groupId ? '' : projectId ?? ''),
    reviewer: params.reviewer ?? params.reviewerId ?? '',
    search: params.search ?? initialQuery,
    sourceBranch: params.sourceBranch ?? '',
    state,
    targetBranch: params.targetBranch ?? '',
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
  if (draft.projectId.trim() && draft.groupId.trim()) return 'グループとプロジェクトは同時に指定できません。'
  if (draft.projectId.trim() && !isPositiveDecimalId(draft.projectId)) return 'プロジェクトIDは1以上の数字で入力してください。'
  if (draft.groupId.trim() && !isValidGroupId(draft.groupId.trim())) return 'グループIDまたはグループパスを確認してください。'
  if (draft.authorId.trim() && !isPositiveDecimalId(draft.authorId)) return '作者IDは1以上の数字で入力してください。'
  if (draft.reviewer.trim() && draft.reviewer !== 'self' && !isPositiveDecimalId(draft.reviewer)) return 'レビュー担当者IDは1以上の数字で入力してください。'
  if (draft.reviewer === 'self' && currentUserId && !isPositiveDecimalId(currentUserId)) return '接続ユーザーIDを確認できないため、レビュー待ちを検索できません。'
  if (draft.assignee.trim() && draft.assignee !== 'self' && !isPositiveDecimalId(draft.assignee)) return '担当者IDは1以上の数字で入力してください。'
  if (draft.assignee === 'self' && !isPositiveDecimalId(currentUserId ?? '')) return '接続ユーザーIDを確認できないため、自分の担当MRを検索できません。'
  if (draft.updatedAfter && !isIsoDateValue(draft.updatedAfter)) return '更新日（開始）は日付を正しく入力してください（例: 2026-10-01）。'
  if (draft.updatedBefore && !isIsoDateValue(draft.updatedBefore)) return '更新日（終了）は日付を正しく入力してください（例: 2026-10-01）。'
  if (draft.updatedAfter && draft.updatedBefore && Date.parse(toGitLabDate(draft.updatedAfter, false)) > Date.parse(toGitLabDate(draft.updatedBefore, true))) return '更新日の開始は終了以前にしてください。'
  return null
}

function isPositiveDecimalId(value: string): boolean {
  return /^[1-9]\d*$/u.test(value.trim())
}

function isValidGroupId(value: string): boolean {
  const normalized = value.trim()
  if (/^\d+$/u.test(normalized)) return isPositiveDecimalId(normalized)
  return normalized.split('/').every((segment) => /^[A-Za-z0-9_.-]+$/u.test(segment) && segment !== '.' && segment !== '..')
}

function parseLabels(value: string): string[] {
  return [...new Set(value.split(',').map((label) => label.trim()).filter(Boolean))]
}

function canonicalLabels(value: string | undefined): string | undefined {
  const labels = parseLabels(value ?? '')
  return labels.length ? labels.join(',') : undefined
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

function personSelectValue(value: string, picking: boolean): string {
  if (picking) return 'id'
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
    && left.groupId === right.groupId
    && canonicalLabels(left.labels) === canonicalLabels(right.labels)
    && left.sourceBranch === right.sourceBranch
    && left.targetBranch === right.targetBranch
    && left.authorId === right.authorId
    && left.assignee === right.assignee
    && left.reviewer === right.reviewer
    && (left.orderBy ?? 'updated_at') === (right.orderBy ?? 'updated_at')
    && (left.sort ?? 'desc') === (right.sort ?? 'desc')
    && left.updatedAfter === right.updatedAfter
    && left.updatedBefore === right.updatedBefore
}

/** A saved search's name when none is given, such as 「Merged · 検索語」. */
function defaultSearchLabel(search: SearchDraft): string {
  const detail = search.search.trim() || (cleanOptional(search.groupId) ? `グループ ${search.groupId.trim()}` : null)
  return [stateLabels[search.state], detail].filter(Boolean).join(' · ')
}

function validOrderBy(value: string | undefined): value is OrderBy {
  return value === 'updated_at' || value === 'created_at'
}

function validSort(value: string | undefined): value is SortDirection {
  return value === 'asc' || value === 'desc'
}
