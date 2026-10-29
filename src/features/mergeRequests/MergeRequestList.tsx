import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
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
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { ListRow } from '../../components/ListRow'
import { MergeRequestStateIcon } from '../../components/MergeRequestStateIcon'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { delayedRevealSx, paneGutter, paneResultsSx } from '../../components/paneSx'
import { PipelineStatus } from '../../components/PipelineStatus'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon } from '../../components/StateIcon'
import { translate, type MessageKey } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import type { GitLabCommandError, GitLabUser, MergeRequest, MergeRequestsQuery, MrApproval, MrApprovalsQuery } from '../../types/gitlab'
import { formatFetchedAt } from '../../lib/format'
import { normalizeGitLabError, openGitLabUrl } from '../../lib/gitlab'
import { useConnection } from '../connections/connectionContext'
import { preferenceScope, readSavedSearches, type SavedMergeRequestSearch, writeSavedSearches } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { usePersonalWorkspace, type MrRef } from '../shared/personalWorkspace'
import { listTitle } from './listTitle'
import { MergeRequestPreview, type PointerSpot } from './MergeRequestPreview'
import { personalQueueFor, type PersonalQueue } from './personalQueue'
import { CONDITION_KINDS, CONDITION_NAMES, STATE_NAMES, type ConditionKind } from './conditionNames'
import { ConditionEditor } from './SearchConditions'
import { type AppliedSearch, buildQuery, canonicalLabels, cleanOptional, defaultSearchLabel, makeInitialState, type OrderBy, parseLabels, sameSavedSearch, type SearchDraft, serializeSearch, type SortDirection, toDateInputValue, validateDraft, validOrderBy, validSort } from './mergeRequestSearch'

type StoredSearch = SavedMergeRequestSearch & { orderBy?: OrderBy; sort?: SortDirection }

export interface MergeRequestListProps {
  /** The MR currently shown in the detail pane. */
  selected?: MrRef | null
  projectId?: string
  projectName?: string
  /** Fixes the list to merge requests authored by this user. */
  author?: GitLabUser
  initialQuery?: string
  initialParams?: Record<string, string>
  onOpenMergeRequest: (mergeRequest: MergeRequest) => void
  onSearchStateChange?: (params: Record<string, string>) => void
  /** Tabs to the sibling lists, shown in place of the title. */
  navigation?: ReactNode
  /** One-off actions of the screen, beside the list's own. */
  actions?: ReactNode
  /** The MR just returned from, as `<projectId>-<iid>`; its row keeps the selected look. */
  recentMrId?: string | null
}


export function MergeRequestList(props: MergeRequestListProps) {
  // Switching the fixed author must not carry one person's draft or applied filters to another.
  return <MergeRequestListContent key={props.author ? `author:${props.author.id}` : 'all-authors'} {...props} />
}

function MergeRequestListContent({ actions, author, initialQuery = '', initialParams = {}, navigation, onOpenMergeRequest, onSearchStateChange, projectId, projectName, recentMrId = null, selected }: MergeRequestListProps) {
  const t = useT()
  const { session } = useConnection()
  const fixedAuthorId = author?.id
  const personalWorkspace = usePersonalWorkspace(session)
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const initial = useMemo(() => makeInitialState(fixedAuthorId !== undefined ? { ...initialParams, authorId: fixedAuthorId } : initialParams, initialQuery, projectId, session?.user.id), [fixedAuthorId, initialParams, initialQuery, projectId, session?.user.id])
  const [draft, setDraft] = useState<SearchDraft>(initial.draft)
  // Every condition is a tag inside the search field; the field's options and a tag open the same editor for one condition.
  const searchFieldRef = useRef<HTMLDivElement>(null)
  const searchOptionsRef = useRef<HTMLDivElement>(null)
  const [searchOptions, setSearchOptions] = useState<{ anchor: HTMLElement; keyboard: boolean; width: number } | null>(null)
  const [editing, setEditing] = useState<{ anchor: HTMLElement; kind: ConditionKind } | null>(null)
  // Names of people and projects chosen in the editor, keyed by `<kind>:<id>`; the condition keeps the ID.
  const [conditionNames, setConditionNames] = useState<Record<string, string>>({})
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
  const query = useMemo<MergeRequestsQuery | null>(() => applied && session ? buildQuery(fixedAuthorId !== undefined ? { ...applied, authorId: fixedAuthorId } : applied, session.user.id) : null, [applied, fixedAuthorId, session])
  const result = useGitLabQuery(session?.id ?? null, query, { keepPrevious: true })
  // Pages after the first are loaded as the list is scrolled, for the conditions they were loaded with.
  const pagesKey = useMemo(() => query ? JSON.stringify(query) : '', [query])
  const [more, setMore] = useState({ count: 0, key: '' })
  const morePages = more.key === pagesKey ? more.count : 0
  const [moreResults, setMoreResults] = useState<Record<string, PageResult>>({})
  const reportPage = useCallback((entry: string, next: PageResult | null) => setMoreResults((current) => withEntry(current, entry, next)), [])
  const [refreshes, setRefreshes] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const focus = () => searchInputRef.current?.focus()
    globalThis.addEventListener('gitlab-focus-project-search', focus)
    return () => globalThis.removeEventListener('gitlab-focus-project-search', focus)
  }, [])

  const emitApplied = (next: AppliedSearch) => {
    onSearchStateChange?.(serializeSearch(next))
  }

  const applyDraft = () => {
    const nextDraft = author ? { ...draft, authorId: author.id } : draft
    const error = validateDraft(nextDraft, session?.user.id)
    if (error) {
      setFilterError(error)
      return
    }
    const next: AppliedSearch = { ...nextDraft, page: 1 }
    setDraft(nextDraft)
    setFilterError(null)
    setApplied(next)
    emitApplied(next)
  }

  // Saves the conditions the list shows, not text typed but not yet searched.
  const saveSearch = (): boolean => {
    if (!applied) {
      setFilterError(t('mrList.saved.applyFirst'))
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
      authorId: author?.id ?? saved.authorId ?? '',
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
   * Applies one condition at once, on top of what the list shows: tags and the
   * order change the results immediately, while typed text waits for Enter.
   */
  const applyConditions = (patch: Partial<SearchDraft>) => {
    const fixedPatch = author ? { ...patch, authorId: author.id } : patch
    const nextDraft = { ...draft, ...fixedPatch }
    const next: AppliedSearch = { ...(applied ?? nextDraft), ...fixedPatch, page: 1 }
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
    return <PaneEmpty description={t('mrList.noSession.description')} title={t('mrList.noSession.title')}><Button href="#client/settings" variant="contained">{t('mrList.noSession.openSettings')}</Button></PaneEmpty>
  }

  // Exactly one condition on the reader (with text, state and order) is a personal queue: it gets its title and grouping.
  const personalQueue = author ? null : personalQueueFor(applied ? serializeSearch(applied) : initialParams, session.user.id)
  const title = projectName ?? (author ? t('mrList.title.author', { name: author.name }) : personalQueue === 'assigned' ? t('mrList.title.assigned') : personalQueue === 'created' ? t('mrList.title.created') : personalQueue === 'waiting' ? t('mrList.title.waiting') : t('mrList.title.search'))
  const page = applied?.page ?? 1
  const pageEntry = (number: number) => `${pagesKey}#${number}`
  const loaded: Array<PageResult | undefined> = [
    { data: result.data, error: result.error, loading: result.loading, nextPage: result.snapshot?.nextPage ?? null, refresh: result.refresh },
    ...Array.from({ length: morePages }, (_, index) => moreResults[pageEntry(page + index + 1)]),
  ]
  // A row that moved to a later page while scrolling is shown once, where it was first seen.
  const seen = new Set<string>()
  const pages: MergeRequest[][] = []
  for (const entry of loaded) {
    if (!entry?.data) break
    pages.push(entry.data.filter((mergeRequest) => {
      const id = `${mergeRequest.projectId}:${mergeRequest.iid}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    }))
  }
  const rows = pages.flat()
  const last = loaded.at(-1)
  const hasNext = Boolean(last?.data && last.nextPage !== null)
  const canLoadMore = hasNext && !result.previous && loaded.length < MAX_LOADED_PAGES
  const chips = applied ? conditionChips(applied, { conditionNames, currentUserId: session.user.id, fixedAuthor: author, fixedProjectId: projectId, groupPaths, rows }) : []
  // A project's list keeps its project.
  const addableKinds = CONDITION_KINDS.filter((kind) => !(projectName && (kind === 'project' || kind === 'group')) && !(author && kind === 'author'))
  const shown = applied ?? draft
  // The chips switch between the reader's own MRs: one replaces another, and choosing the one shown removes it.
  const queueSwitches = projectName || author ? [] : QUEUE_SWITCHES.map(({ label: labelKey, queue }) => {
    const own = ownCondition(queue, session.user.id)
    const active = shown[own.key] === own.value
    const others = QUEUE_SWITCHES.map((other) => ownCondition(other.queue, session.user.id)).filter((other) => other.key !== own.key && shown[other.key] === other.value)
    const patch: Partial<SearchDraft> = active
      ? { [own.key]: '' }
      : { ...Object.fromEntries(others.map((other) => [other.key, ''])), [own.key]: own.value, ...(shown.state === 'all' ? { state: 'opened' as const } : {}) }
    return { active, label: t(labelKey), patch }
  })
  // The search word is the field's own text, so only the other conditions are tags in it.
  const fieldChips = chips.filter((chip) => chip.kind !== 'search')
  const freshness = result.stale ? t('mrList.status.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) }) : result.refreshing ? t('mrList.status.refreshing') : null
  const searchTarget = t('mrList.search.target')
  const defaults = defaultConditions(projectId, author?.id ?? '')
  const conditionsChanged = !sameConditions(applied ?? draft, defaults) || !sameConditions(draft, defaults)
  const resetConditions = () => {
    const next: AppliedSearch = { ...defaults, page: 1 }
    setDraft(defaults)
    setFilterError(null)
    setApplied(next)
    emitApplied(next)
  }
  const openSearchOptions = (keyboard: boolean) => {
    const anchor = searchFieldRef.current
    if (anchor && addableKinds.length) setSearchOptions({ anchor, keyboard, width: anchor.clientWidth })
  }
  // The options close when focus leaves both the field and the options.
  const closeSearchOptionsOnBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null
    if (next && (searchFieldRef.current?.contains(next) || searchOptionsRef.current?.contains(next))) return
    setSearchOptions(null)
  }
  const chooseSearchOption = (kind: ConditionKind) => {
    setSearchOptions(null)
    if (searchOptions) setEditing({ anchor: searchOptions.anchor, kind })
  }
  const applyEdited = (kind: ConditionKind, patch: Partial<SearchDraft>, name?: string) => {
    if (name) {
      const id = kind === 'group' ? patch.groupId : kind === 'project' ? patch.projectId : kind === 'author' ? patch.authorId : kind === 'reviewer' ? patch.reviewer : patch.assignee
      if (kind === 'group' && id) setGroupPaths((current) => ({ ...current, [id]: name }))
      else if (id) setConditionNames((current) => ({ ...current, [`${kind}:${id}`]: name }))
    }
    applyConditions(patch)
  }

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<>
          {actions}
          <Tooltip title={t('mrList.saved.title')}><IconButton aria-label={t('mrList.header.manageSaved', { count: savedSearches.length })} onClick={() => setSavedSearchesOpen(true)}><BookmarksOutlinedIcon /></IconButton></Tooltip>
          <Tooltip title={t('mrList.header.refresh')}><span><IconButton aria-label={t('mrList.header.refresh')} disabled={result.loading || result.refreshing} onClick={() => { result.refresh(); setRefreshes((count) => count + 1) }}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        </>}
        navigation={navigation}
        title={title}
      >
        <Box component="form" onSubmit={(event) => { event.preventDefault(); applyDraft() }}>
          <TextField
            fullWidth
            onChange={(event) => {
              setSearchOptions(null)
              setDraft((current) => ({ ...current, search: event.target.value }))
            }}
            placeholder={personalQueue ? t('mrList.search.placeholderIn', { title }) : t('mrList.search.placeholder')}
            ref={searchFieldRef}
            slotProps={{
              htmlInput: {
                // A text field that opens the conditions menu; as a combobox its open state may be announced.
                role: 'combobox',
                'aria-controls': searchOptions ? 'mr-search-options' : undefined,
                'aria-expanded': Boolean(searchOptions),
                'aria-haspopup': 'menu',
                'aria-label': personalQueue ? t('mrList.search.ariaIn', { title }) : t('mrList.search.aria'),
                onBlur: closeSearchOptionsOnBlur,
                onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    openSearchOptions(true)
                  } else if (event.key === 'Escape') setSearchOptions(null)
                },
              },
              input: {
                // Clicking the field, but not a tag in it, lists the conditions that can be added.
                onClick: (event) => { if (!(event.target as Element).closest('.MuiChip-root, button')) openSearchOptions(false) },
                startAdornment: <>
                  <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>
                  {/* Each applied condition shows its value as a tag in the field: a tag opens its editor, ✕ removes it. */}
                  {fieldChips.length ? <Box aria-label={t('mrList.search.applied')} role="group" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: '100%', mr: 0.5, py: 0.5 }}>
                    {fieldChips.map((chip) => {
                      const { clear, kind } = chip
                      const open = kind && kind !== 'search' ? (event: MouseEvent<HTMLElement>) => setEditing({ anchor: event.currentTarget, kind }) : undefined
                      return <Chip color={clear ? 'primary' : 'default'} deleteIcon={clear ? <CancelRoundedIcon aria-label={t('mrList.search.removeCondition', { name: chip.name })} /> : undefined} key={chip.name} label={chip.label} onClick={open} onDelete={clear ? () => applyConditions(clear) : undefined} size="small" sx={{ fontFamily: chip.code ? 'code.fontFamily' : undefined, maxWidth: '100%' }} variant="outlined" />
                    })}
                  </Box> : null}
                </>,
                endAdornment: <InputAdornment position="end"><Tooltip title={t('mrList.search.submitTooltip')}><IconButton aria-label={t('mrList.search.submit')} edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
                sx: { flexWrap: 'wrap', '& .MuiInputBase-input': { flex: 1, minWidth: 160, width: 'auto' } },
              },
            }}
            inputRef={searchInputRef}
            value={draft.search}
          />
          <Popper anchorEl={searchOptions?.anchor} open={Boolean(searchOptions)} placement="bottom-start" sx={{ width: searchOptions?.width, zIndex: 'modal' }}>
            <Paper ref={searchOptionsRef} sx={{ ...panelFrame(), boxShadow: 8, mt: 0.5, py: 0.5 }}>
              <Typography color="textSecondary" sx={{ display: 'block', px: 1.5 }} variant="overline">{t('mrList.search.addCondition')}</Typography>
              <MenuList
                aria-label={t('mrList.search.conditionsMenu')}
                autoFocusItem={searchOptions?.keyboard}
                dense
                id="mr-search-options"
                onBlur={closeSearchOptionsOnBlur}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  setSearchOptions(null)
                  searchInputRef.current?.focus()
                }}
              >
                {addableKinds.map((kind) => <MenuItem key={kind} onClick={() => chooseSearchOption(kind)}>{t(CONDITION_NAMES[kind])}</MenuItem>)}
              </MenuList>
            </Paper>
          </Popper>
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {queueSwitches.length ? <Stack aria-label={t('mrList.queue.group')} direction="row" role="group" sx={{ gap: 0.5, mr: 0.5 }}>
              {queueSwitches.map(({ active, label, patch }) => <Chip aria-pressed={active} color={active ? 'primary' : 'default'} key={label} label={label} onClick={() => applyConditions(patch)} size="small" variant={active ? 'filled' : 'outlined'} />)}
            </Stack> : null}
            {conditionsChanged ? <Button onClick={resetConditions} sx={{ color: 'text.secondary', minHeight: 24, px: 1 }}>{t('mrList.search.clear')}</Button> : null}
            {/* The order is not a condition, so it stays a pull-down beside the field. */}
            <Stack direction="row" sx={{ gap: 0.5, ml: 'auto' }}>
              <Select aria-label={t('mrList.order.aria')} displayEmpty onChange={(event) => applyConditions({ orderBy: event.target.value as OrderBy })} sx={pillSelectSx} value={draft.orderBy}>
                <MenuItem value="updated_at">{t('mrList.order.updated')}</MenuItem>
                <MenuItem value="created_at">{t('mrList.order.created')}</MenuItem>
              </Select>
              <Select aria-label={t('mrList.order.directionAria')} onChange={(event) => applyConditions({ sort: event.target.value as SortDirection })} sx={pillSelectSx} value={draft.sort}>
                <MenuItem value="desc">{t('mrList.order.desc')}</MenuItem>
                <MenuItem value="asc">{t('mrList.order.asc')}</MenuItem>
              </Select>
            </Stack>
          </Stack>
          <ConditionEditor
            anchorEl={editing?.anchor ?? null}
            currentUserId={session.user.id}
            groupPath={groupPaths[draft.groupId]}
            kind={editing?.kind ?? null}
            nameOf={(kind, id) => conditionName(kind, id, conditionNames, rows)}
            onApply={(patch, name) => { if (editing) applyEdited(editing.kind, patch, name) }}
            onClose={() => setEditing(null)}
            values={applied ?? draft}
          />
          {filterError ? <Alert severity="error" sx={{ mt: 1 }}>{filterError}</Alert> : null}
        </Box>
      </PaneHeader>

      <Dialog fullWidth maxWidth="sm" onClose={() => setSavedSearchesOpen(false)} open={savedSearchesOpen}>
        <DialogTitle>{t('mrList.saved.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box>
              <Typography color="textSecondary" sx={{ display: 'block', mb: 1 }} variant="overline">{t('mrList.saved.saveCurrent')}</Typography>
              <Stack direction="row" spacing={1}>
                <TextField fullWidth label={t('mrList.saved.nameOptional')} onChange={(event) => setSaveLabel(event.target.value)} value={saveLabel} />
                <Button onClick={() => { if (saveSearch()) setSavedSearchesOpen(false) }} startIcon={<SaveRoundedIcon />} type="button" variant="contained">{t('mrList.saved.save')}</Button>
              </Stack>
            </Box>
            <Box>
              <Typography color="textSecondary" sx={{ display: 'block', mb: 1 }} variant="overline">{t('mrList.saved.listHeading', { count: savedSearches.length })}</Typography>
              {savedSearches.length === 0 ? <Typography color="textSecondary" variant="body2">{t('mrList.saved.empty')}</Typography> : (
                <Stack divider={<Divider flexItem />} sx={{ ...panelFrame(), borderRadius: 1 }}>
                  {savedSearches.map((saved) => (
                    <Stack key={saved.id} spacing={1} sx={{ p: 1 }}>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Button onClick={() => { applySavedSearch(saved); setSavedSearchesOpen(false) }} sx={{ flex: 1, justifyContent: 'flex-start', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left', whiteSpace: 'normal' }}>
                          {saved.label}
                        </Button>
                        <Tooltip title={t('mrList.saved.delete')}><IconButton aria-label={t('mrList.saved.deleteAria', { name: saved.label })} onClick={() => deleteSavedSearch(saved.id)}><DeleteOutlineRoundedIcon /></IconButton></Tooltip>
                      </Stack>
                      <Stack direction="row" spacing={1}>
                        <TextField fullWidth label={t('mrList.saved.name')} onChange={(event) => setRenameLabels((current) => ({ ...current, [saved.id]: event.target.value }))} value={renameLabels[saved.id] ?? saved.label} />
                        <Button disabled={!cleanOptional(renameLabels[saved.id]) || (renameLabels[saved.id] ?? saved.label).trim() === saved.label} onClick={() => renameSavedSearch(saved)} startIcon={<EditOutlinedIcon />} sx={{ flexShrink: 0 }}>{t('mrList.saved.rename')}</Button>
                      </Stack>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setSavedSearchesOpen(false)}>{t('mrList.saved.close')}</Button></DialogActions>
      </Dialog>

      <PaneStatus announcement={result.data && !result.previous ? page > 1 ? t('mrList.status.announceFromPage', { count: rows.length, page }) : t('mrList.status.announce', { count: rows.length }) : null}>{result.data && !result.previous ? <>{page > 1 ? t('mrList.status.loadedFromPage', { count: rows.length, page }) : t('mrList.status.loaded', { count: rows.length })}{freshness ? ` · ${freshness}` : ''}</> : result.loading || result.previous ? t('mrList.status.loading') : result.error ? t('mrList.status.failed') : null}</PaneStatus>
      {/* The preview sits beside the results, so it hides none of them. */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box aria-busy={result.previous} ref={resultsRef} sx={paneResultsSx(result.previous)}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('mrList.results.retry')}</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('mrList.results.retry')}</Button>} severity="warning" sx={{ m: 1.5 }}>{t('mrList.results.staleError', { error: result.error.message })}</Alert> : null}
        {pipelineOpenError ? <Alert onClose={() => setPipelineOpenError(null)} severity="error" sx={{ m: 1.5 }}>{t('mrList.results.pipelineError', { error: pipelineOpenError })}</Alert> : null}
        {result.loading && !result.data ? <LoadingRows /> : null}
        {!result.loading && !result.data && !result.error && !filterError ? <PaneEmpty description={t('mrList.empty.description', { target: searchTarget })} title={t('mrList.empty.title')} /> : null}
        {result.data && result.data.length === 0 ? <PaneEmpty description={<>{t('mrList.empty.appliedConditions', { conditions: chips.length ? chips.map((chip) => chip.label).join(' · ') : t('mrList.empty.noConditions') })}<br />{searchTarget}</>} title={t('mrList.empty.noMatchTitle')}>{conditionsChanged ? <Button onClick={resetConditions} variant="outlined">{t('mrList.search.clear')}</Button> : null}</PaneEmpty> : null}
        {page > 1 && rows.length ? <Box sx={{ ...hairline('bottom'), px: 1, py: 0.5 }}><Button onClick={() => updatePage(1)} size="small">{t('mrList.results.fromFirstPage')}</Button></Box> : null}
        {rows.length ? <MergeRequestResults currentUserId={session.user.id} grouping={personalQueue === 'waiting' ? 'mine' : personalQueue ? 'any' : null} pages={pages} onFocusRow={(next) => setPreview((current) => current ? next : current)} onOpenMergeRequest={openMergeRequest} onOpenPipeline={openPipeline} onPreview={(next) => setPreview((current) => current?.mergeRequest.id === next.mergeRequest.id ? null : next)} orderBy={applied?.orderBy ?? 'updated_at'} personalWorkspace={personalWorkspace} previewing={preview?.mergeRequest ?? null} recentMrId={recentMrId} selected={selected ?? null} sessionId={session.id} showProject={!projectName} /> : null}
        {rows.length && (morePages > 0 || hasNext) ? <MoreRows
          capped={hasNext && loaded.length >= MAX_LOADED_PAGES}
          count={rows.length}
          error={last && !last.data ? last.error : null}
          loading={!last || (last.loading && !last.data)}
          onLoad={canLoadMore ? () => setMore({ count: morePages + 1, key: pagesKey }) : undefined}
          onRetry={() => last?.refresh()}
          rootRef={resultsRef}
        /> : null}
        {query ? Array.from({ length: morePages }, (_, index) => <MergeRequestPageLoader entry={pageEntry(page + index + 1)} key={pageEntry(page + index + 1)} onChange={reportPage} page={page + index + 1} query={query} refreshes={refreshes} sessionId={session.id} />) : null}
      </Box>
      {preview ? <MergeRequestPreview approval={preview.approval} closeAt={preview.closeAt} mergeRequest={preview.mergeRequest} onClose={closePreview} onOpen={() => openMergeRequest(preview.mergeRequest)} /> : null}
      </Box>
    </Box>
  )
}

/**
 * Pages kept by scrolling, the first included (300 rows). Each page and its
 * approvals are one request; beyond this the conditions narrow the list instead.
 */
const MAX_LOADED_PAGES = 10

/** One page of the list as far as it has loaded. */
interface PageResult { data: MergeRequest[] | null; error: GitLabCommandError | null; loading: boolean; nextPage: number | null; refresh: () => void }

/**
 * A page after the first. It refreshes only with the 更新 button, like older
 * discussion pages, so scrolling far does not add requests every minute.
 */
function MergeRequestPageLoader({ entry, onChange, page, query, refreshes, sessionId }: { entry: string; onChange: (entry: string, result: PageResult | null) => void; page: number; query: MergeRequestsQuery; refreshes: number; sessionId: string }) {
  const pageQuery = useMemo(() => ({ ...query, page }), [page, query])
  const { data, error, loading, refresh, snapshot } = useGitLabQuery(sessionId, pageQuery, { refreshIntervalMs: false })
  const nextPage = snapshot?.nextPage ?? null
  useEffect(() => onChange(entry, { data, error, loading, nextPage, refresh }), [data, entry, error, loading, nextPage, onChange, refresh])
  useEffect(() => () => onChange(entry, null), [entry, onChange])
  const refreshed = useRef(refreshes)
  useEffect(() => {
    if (refreshed.current === refreshes) return
    refreshed.current = refreshes
    refresh()
  }, [refresh, refreshes])
  return null
}

/**
 * The end of the list: the next page loads when it comes near the bottom of
 * the pane, or from the button for keyboard use. Its height stays the same
 * while loading so the rows above do not move.
 */
function MoreRows({ capped, count, error, loading, onLoad, onRetry, rootRef }: { capped: boolean; count: number; error: GitLabCommandError | null; loading: boolean; onLoad?: () => void; onRetry: () => void; rootRef: RefObject<HTMLDivElement | null> }) {
  const t = useT()
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!onLoad || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoad() }, { root: rootRef.current, rootMargin: '0px 0px 480px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoad, rootRef])
  return (
    <Box ref={sentinelRef} sx={{ alignItems: 'center', display: 'flex', justifyContent: 'center', minHeight: 48, px: paneGutter, py: 1 }}>
      {error ? <Alert action={<Button color="inherit" onClick={onRetry}>{t('mrList.results.retry')}</Button>} severity="error" sx={{ flex: 1 }}>{t('mrList.more.error', { error: error.message })}</Alert>
        : loading ? <Typography color="textSecondary" role="status" variant="caption">{t('mrList.more.loading')}</Typography>
          : capped ? <Typography color="textSecondary" variant="caption">{t('mrList.more.capped', { count })}</Typography>
            : onLoad ? <Button onClick={onLoad} size="small">{t('mrList.more.load')}</Button>
              : <Typography color="textSecondary" variant="caption">{t('mrList.more.all')}</Typography>}
    </Box>
  )
}

/** Condition selects are the theme's small Select on the pane surface, with caption-sized text. */
// Body-size text and an 18px arrow, so the text is not lost inside the 32px control.
const pillSelectSx = { bgcolor: 'transparent', typography: 'body2', '& .MuiSelect-icon': { fontSize: 18 } } as const

/** The approval line of the preview, saying what the row's approval mark says. */
function approvalText(approval: RowApproval | null, state: string): string | null {
  if (!approval) return null
  if (approval.count === 0) return state === 'opened' ? translate('mrList.approval.none') : null
  return approval.byMe ? translate('mrList.approval.countWithMe', { count: approval.count }) : translate('mrList.approval.count', { count: approval.count })
}

/** A tag without `clear` is a condition the list keeps. */
interface ConditionChip { name: string; label: string; clear?: Partial<SearchDraft>; kind?: ConditionKind | 'search'; code?: boolean }

interface ChipContext {
  conditionNames: Record<string, string>
  currentUserId: string
  fixedAuthor: GitLabUser | undefined
  fixedProjectId: string | undefined
  groupPaths: Record<string, string>
  rows: MergeRequest[]
}

/**
 * Every applied condition except the order, as tags. IDs are named from the
 * editor's choices or from the fetched rows when they say who or what the ID is.
 */
function conditionChips(applied: AppliedSearch, { conditionNames, currentUserId, fixedAuthor, fixedProjectId, groupPaths, rows }: ChipContext): ConditionChip[] {
  const chips: ConditionChip[] = []
  const person = (kind: 'reviewer' | 'assignee' | 'author', id: string) => id === 'self' || id === currentUserId ? translate('mrList.chip.self') : conditionName(kind, id, conditionNames, rows) ?? `ID ${id}`
  const label = (name: string, value: string) => translate('mrList.chip.value', { name, value })
  const named = (kind: ConditionKind) => translate(CONDITION_NAMES[kind])
  if (applied.search.trim()) chips.push({ clear: { search: '' }, kind: 'search', label: label(translate('mrList.chip.search'), applied.search.trim()), name: translate('mrList.chip.search') })
  if (applied.state !== 'all') chips.push({ clear: { state: 'all' }, kind: 'state', label: label(named('state'), translate(STATE_NAMES[applied.state])), name: named('state') })
  if (applied.reviewer) chips.push({ clear: { reviewer: '' }, kind: 'reviewer', label: label(named('reviewer'), person('reviewer', applied.reviewer)), name: named('reviewer') })
  if (applied.assignee) chips.push({ clear: { assignee: '' }, kind: 'assignee', label: label(named('assignee'), person('assignee', applied.assignee)), name: named('assignee') })
  if (fixedAuthor) chips.push({ label: label(named('author'), fixedAuthor.name), name: named('author') })
  else if (applied.authorId) chips.push({ clear: { authorId: '' }, kind: 'author', label: label(named('author'), person('author', applied.authorId)), name: named('author') })
  if (applied.projectId && applied.projectId !== fixedProjectId) {
    const path = conditionName('project', applied.projectId, conditionNames, rows)
    chips.push({ clear: { projectId: '' }, kind: 'project', label: label(named('project'), path || `ID ${applied.projectId}`), name: named('project') })
  }
  if (applied.groupId) chips.push({ clear: { groupId: '' }, kind: 'group', label: label(named('group'), groupPaths[applied.groupId] ?? (/^\d+$/u.test(applied.groupId) ? `ID ${applied.groupId}` : applied.groupId)), name: named('group') })
  if (applied.labels) chips.push({ clear: { labels: '' }, kind: 'labels', label: label(named('labels'), parseLabels(applied.labels).join(', ')), name: named('labels') })
  if (applied.sourceBranch) chips.push({ clear: { sourceBranch: '' }, code: true, kind: 'sourceBranch', label: label(translate('mrList.chip.sourceBranch'), applied.sourceBranch), name: translate('mrList.chip.sourceBranch') })
  if (applied.targetBranch) chips.push({ clear: { targetBranch: '' }, code: true, kind: 'targetBranch', label: label(translate('mrList.chip.targetBranch'), applied.targetBranch), name: named('targetBranch') })
  if (applied.updatedAfter || applied.updatedBefore) chips.push({ clear: { updatedAfter: '', updatedBefore: '' }, kind: 'updated', label: label(named('updated'), translate('mrList.chip.updatedRange', { from: toDateInputValue(applied.updatedAfter), to: toDateInputValue(applied.updatedBefore) })), name: named('updated') })
  return chips
}

/** Who or what an ID condition names: the editor's choice, or a fetched row that mentions the ID. */
function conditionName(kind: 'reviewer' | 'assignee' | 'author' | 'project', id: string, conditionNames: Record<string, string>, rows: MergeRequest[]): string | undefined {
  const chosen = conditionNames[`${kind}:${id}`]
  if (chosen) return chosen
  if (kind === 'reviewer') return rows.flatMap((row) => row.reviewers ?? []).find((user) => user.id === id)?.name
  if (kind === 'assignee') return rows.flatMap((row) => row.assignees ?? []).find((user) => user.id === id)?.name
  if (kind === 'author') return rows.find((row) => row.author.id === id)?.author.name
  return rows.find((row) => row.projectId === id)?.projectPath || undefined
}

/** The reader's own MRs, switched with chips under the search field; each is one condition on the reader. */
const QUEUE_SWITCHES: Array<{ label: MessageKey; queue: PersonalQueue }> = [
  { label: 'mrList.queue.waiting', queue: 'waiting' },
  { label: 'mrList.queue.assigned', queue: 'assigned' },
  { label: 'mrList.queue.created', queue: 'created' },
]

function ownCondition(queue: PersonalQueue, currentUserId: string): { key: 'reviewer' | 'assignee' | 'authorId'; value: string } {
  if (queue === 'waiting') return { key: 'reviewer', value: 'self' }
  if (queue === 'assigned') return { key: 'assignee', value: 'self' }
  return { key: 'authorId', value: currentUserId }
}


/** What 「条件をクリア」 returns to: every MR, keeping a project's scope. */
function defaultConditions(projectId: string | undefined, authorId = ''): SearchDraft {
  return { assignee: '', authorId, groupId: '', labels: '', orderBy: 'updated_at', projectId: projectId ?? '', reviewer: '', search: '', sort: 'desc', sourceBranch: '', state: 'all', targetBranch: '', updatedAfter: '', updatedBefore: '' }
}

function sameConditions(left: SearchDraft, right: SearchDraft): boolean {
  return (Object.keys(right) as Array<keyof SearchDraft>).every((key) => key === 'labels' ? canonicalLabels(left.labels) === canonicalLabels(right.labels) : left[key].trim() === right[key].trim())
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

function MergeRequestResults({ currentUserId, grouping, onFocusRow, onOpenMergeRequest, onOpenPipeline, onPreview, orderBy, pages, personalWorkspace, previewing, recentMrId, selected, sessionId, showProject }: { currentUserId: string; grouping: 'mine' | 'any' | null; onFocusRow: (preview: RowPreview) => void; onOpenMergeRequest: (mergeRequest: MergeRequest) => void; onOpenPipeline: (url: string) => Promise<void>; onPreview: (preview: RowPreview) => void; orderBy: OrderBy; pages: MergeRequest[][]; personalWorkspace: ReturnType<typeof usePersonalWorkspace>; previewing: MergeRequest | null; recentMrId: string | null; selected: MrRef | null; sessionId: string; showProject: boolean }) {
  const t = useT()
  // Approvals come in one request per loaded page, as GitLab is asked for at most a page at once.
  const pageKeys = pages.map((items) => items.filter((mergeRequest) => mergeRequest.projectPath).map((mergeRequest) => `${mergeRequest.projectPath}!${mergeRequest.iid}`).join(' '))
  const [approvalPages, setApprovalPages] = useState<Record<string, ApprovalsResult>>({})
  const reportApprovals = useCallback((itemsKey: string, next: ApprovalsResult | null) => setApprovalPages((current) => withEntry(current, itemsKey, next)), [])
  const approvedBy = new Map<string, string[] | null>()
  const pendingRows = new Set<string>()
  let approvalsError: GitLabCommandError | null = null
  for (const itemsKey of pageKeys) {
    if (!itemsKey) continue
    const approvals = approvalPages[itemsKey]
    for (const item of approvals?.data ?? []) approvedBy.set(`${item.projectPath}!${item.iid}`, item.approvedBy)
    if (!approvals?.data && (!approvals || approvals.loading)) for (const key of itemsKey.split(' ')) pendingRows.add(key)
    if (!approvals?.data && approvals?.error) approvalsError ??= approvals.error
  }
  const approvalOf = (mergeRequest: MergeRequest): RowApproval | null => {
    const users = approvedBy.get(`${mergeRequest.projectPath}!${mergeRequest.iid}`)
    return users ? rowApproval(users.includes(currentUserId), users.length) : null
  }
  // The rows are memoized: their handlers stay the same functions and reach the latest props here.
  const latest = useRef({ approvalOf, onFocusRow, onOpenMergeRequest, onOpenPipeline, onPreview, personalWorkspace })
  useEffect(() => { latest.current = { approvalOf, onFocusRow, onOpenMergeRequest, onOpenPipeline, onPreview, personalWorkspace } })
  const handlers = useMemo<RowHandlers>(() => ({
    focus: (mergeRequest) => latest.current.onFocusRow({ approval: approvalText(latest.current.approvalOf(mergeRequest), mergeRequest.state), mergeRequest }),
    open: (mergeRequest) => latest.current.onOpenMergeRequest(mergeRequest),
    openPipeline: (url) => latest.current.onOpenPipeline(url),
    preview: (mergeRequest, closeAt) => latest.current.onPreview({ approval: approvalText(latest.current.approvalOf(mergeRequest), mergeRequest.state), closeAt, mergeRequest }),
    togglePinned: (mergeRequest) => latest.current.personalWorkspace.togglePinned({ iid: mergeRequest.iid, projectId: mergeRequest.projectId }, { projectPath: mergeRequest.projectPath ?? '', state: mergeRequest.state, title: mergeRequest.title }),
  }), [])

  // Rows show at once; only their approval mark waits for the approvals request.
  const approvalPending = (mergeRequest: MergeRequest) => pendingRows.has(`${mergeRequest.projectPath}!${mergeRequest.iid}`)
  const row = (mergeRequest: MergeRequest) => <MergeRequestResultRow
    approval={approvalOf(mergeRequest)}
    approvalPending={approvalPending(mergeRequest)}
    key={`${mergeRequest.projectId}:${mergeRequest.iid}`}
    handlers={handlers}
    mergeRequest={mergeRequest}
    orderBy={orderBy}
    pinned={personalWorkspace.isPinned({ iid: mergeRequest.iid, projectId: mergeRequest.projectId })}
    previewing={previewing?.id === mergeRequest.id}
    unread={personalWorkspace.unreadCount({ iid: mergeRequest.iid, projectId: mergeRequest.projectId })}
    // The MR just returned from keeps the selected look, so the reader sees where they were.
    selected={(selected?.projectId === mergeRequest.projectId && selected.iid === mergeRequest.iid) || recentMrId === `${mergeRequest.projectId}-${mergeRequest.iid}`}
    showProject={showProject}
  />
  const mergeRequests = pages.flat()
  const loaders = pageKeys.map((itemsKey) => itemsKey ? <MergeRequestApprovalsLoader itemsKey={itemsKey} key={itemsKey} onChange={reportApprovals} sessionId={sessionId} /> : null)
  // The queues group once the first page's approvals are known; until then, or when they fail, the list stays flat.
  if (!grouping || !approvalPages[pageKeys[0]]?.data) {
    return <>
      {loaders}
      {approvalsError ? <Typography color="textSecondary" component="div" sx={{ px: paneGutter, py: 1 }} variant="caption">{t('mrList.results.approvalsError', { error: approvalsError.message })}</Typography> : null}
      <Box aria-label={t('mrList.results.aria')} component="ul" onKeyDown={moveListRowFocus} role="list" sx={rowListSx}>{mergeRequests.map(row)}</Box>
    </>
  }
  const [waitingLabel, doneLabel] = grouping === 'mine' ? [t('mrList.sections.waitingMine'), t('mrList.sections.doneMine')] : [t('mrList.sections.waitingAny'), t('mrList.sections.doneAny')]
  const sections: Array<[string, MergeRequest[]]> = [[waitingLabel, []], [doneLabel, []], [t('mrList.sections.pending'), []], [t('mrList.sections.unknown'), []]]
  for (const mergeRequest of mergeRequests) {
    const approval = approvalOf(mergeRequest)
    const done = approval && (grouping === 'mine' ? approval.byMe : approval.count > 0)
    sections[approval ? done ? 1 : 0 : approvalPending(mergeRequest) ? 2 : 3][1].push(mergeRequest)
  }
  return (
    <Box aria-label={t('mrList.results.aria')} onKeyDown={moveListRowFocus} role="group">
      {loaders}
      {sections.filter(([label, items]) => items.length > 0 || label === waitingLabel || label === doneLabel).map(([label, items]) => (
        <Box aria-label={label} component="section" key={label}>
          <Typography color="textSecondary" component="h2" sx={{ bgcolor: 'surface.nav', ...hairline('bottom'), display: 'block', px: paneGutter, py: 0.5 }} variant="overline">{t('mrList.sections.heading', { count: items.length, label })}</Typography>
          {items.length ? <Box aria-label={label} component="ul" role="list" sx={rowListSx}>{items.map(row)}</Box> : null}
        </Box>
      ))}
    </Box>
  )
}

const rowApprovals = new Map<string, RowApproval>()
/** One object per approval mark, so a memoized row sees the same approval as long as its mark is the same. */
function rowApproval(byMe: boolean, count: number): RowApproval {
  const key = `${byMe}:${count}`
  let approval = rowApprovals.get(key)
  if (!approval) rowApprovals.set(key, approval = { byMe, count })
  return approval
}

/** Records what a loader reports, keeping the same state when nothing changed so its report causes no render. */
function withEntry<T extends object>(current: Record<string, T>, key: string, next: T | null): Record<string, T> {
  const shown = current[key]
  if (!next) {
    if (!shown) return current
    const rest = { ...current }
    delete rest[key]
    return rest
  }
  if (shown && (Object.keys(next) as Array<keyof T>).every((field) => Object.is(shown[field], next[field]))) return current
  return { ...current, [key]: next }
}

/** Who approved the MRs of one loaded page. */
interface ApprovalsResult { data: MrApproval[] | null; error: GitLabCommandError | null; loading: boolean }

function MergeRequestApprovalsLoader({ itemsKey, onChange, sessionId }: { itemsKey: string; onChange: (itemsKey: string, result: ApprovalsResult | null) => void; sessionId: string }) {
  const query = useMemo<MrApprovalsQuery>(() => ({ items: itemsKey.split(' ').map((key) => { const at = key.lastIndexOf('!'); return { iid: key.slice(at + 1), projectPath: key.slice(0, at) } }), kind: 'mrApprovals' }), [itemsKey])
  const { data, error, loading } = useGitLabQuery<MrApprovalsQuery>(sessionId, query)
  useEffect(() => onChange(itemsKey, { data, error, loading }), [data, error, itemsKey, loading, onChange])
  useEffect(() => () => onChange(itemsKey, null), [itemsKey, onChange])
  return null
}

/**
 * Rows far from the viewport skip layout and paint, so a list grown by
 * scrolling stays as quick to scroll and resize as one page.
 */
const rowListSx = { m: 0, p: 0, '& > li': { containIntrinsicSize: 'auto 80px', contentVisibility: 'auto' } } as const

/** Room on a row's last line for its buttons (preview, CI, pin), so they never cover a label. */
const ROW_ACTIONS_SPACE = 12

/** Labels shown on a row before the rest fold into 「+N」. */
const ROW_LABELS = 3

/** What a row does, the same functions for every row and render. */
interface RowHandlers { focus: (mergeRequest: MergeRequest) => void; open: (mergeRequest: MergeRequest) => void; openPipeline: (url: string) => Promise<void>; preview: (mergeRequest: MergeRequest, closeAt?: PointerSpot) => void; togglePinned: (mergeRequest: MergeRequest) => void }

/** Memoized: opening an MR or moving the preview renders only the rows whose marks change, not the whole list. */
const MergeRequestResultRow = memo(function MergeRequestResultRow({ approval, approvalPending, handlers, mergeRequest, orderBy, pinned, previewing, selected, showProject, unread }: { approval: RowApproval | null; approvalPending: boolean; handlers: RowHandlers; mergeRequest: MergeRequest; orderBy: OrderBy; pinned: boolean; previewing: boolean; selected: boolean; showProject: boolean; unread: number | undefined }) {
  const t = useT()
  const labels = mergeRequest.labels ?? []
  const hiddenLabels = labels.slice(ROW_LABELS)
  // The time matches the order of the list; GitLab's creation time is used once the MR carries it.
  const createdAt = mergeRequest.createdAt
  const byCreation = orderBy === 'created_at' && Boolean(createdAt)
  // CI is shown only when GitLab included it; the row does not offer a lookup.
  const pipeline = mergeRequest.pipeline
  const hasUnread = unread !== undefined && unread > 0
  const pinButton = <Tooltip title={pinned ? t('mrList.row.unpin') : t('mrList.row.pin')}><IconButton aria-label={pinned ? t('mrList.row.unpinAria', { iid: mergeRequest.iid }) : t('mrList.row.pinAria', { iid: mergeRequest.iid })} color={pinned ? 'primary' : 'default'} onClick={() => handlers.togglePinned(mergeRequest)}>{pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}</IconButton></Tooltip>

  return (
    <ListRow
      actions={<>
        {previewing
          ? <Tooltip title={t('mrList.row.closePreview')}><IconButton aria-label={t('mrList.row.closePreviewAria', { iid: mergeRequest.iid })} aria-pressed color="primary" onClick={() => handlers.preview(mergeRequest)}><VisibilityOffOutlinedIcon /></IconButton></Tooltip>
          : <Tooltip title={t('mrList.row.preview')}><IconButton aria-label={t('mrList.row.previewAria', { iid: mergeRequest.iid })} onClick={(event) => handlers.preview(mergeRequest, event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined)}><VisibilityOutlinedIcon /></IconButton></Tooltip>}
        {pipeline?.webUrl ? <Tooltip title={t('mrList.row.openPipeline')}><IconButton aria-label={t('mrList.row.openPipelineAria', { iid: mergeRequest.iid })} onClick={() => void handlers.openPipeline(pipeline.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
        {pinned ? null : pinButton}
      </>}
      // The state leads the row as an icon, so a list reads by shape and colour before words.
      leading={<MergeRequestStateIcon state={mergeRequest.state} />}
      // A pinned row keeps its pin in view: the mark and the button to unpin are one control.
      stickyActions={pinned ? pinButton : undefined}
      mrId={`${mergeRequest.projectId}-${mergeRequest.iid}`}
      onFocus={() => handlers.focus(mergeRequest)}
      onOpen={() => handlers.open(mergeRequest)}
      onPreview={() => handlers.preview(mergeRequest)}
      previewing={previewing}
      // The last line keeps ROW_ACTIONS_SPACE for the buttons itself.
      reserveActionsSpace={false}
      selected={selected}
    >
      {/* The time follows the MR's name instead of sitting at the far edge of a wide row. */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
        <Tooltip title={`${showProject ? `${mergeRequest.projectPath || t('mrList.row.project', { id: mergeRequest.projectId })} ` : ''}!${mergeRequest.iid}`}><Typography color="textSecondary" noWrap sx={{ minWidth: 0 }} variant="caption">{showProject ? `${mergeRequest.projectPath || t('mrList.row.project', { id: mergeRequest.projectId })} ` : ''}!{mergeRequest.iid}</Typography></Tooltip>
        <Typography aria-hidden color="textSecondary" variant="caption">·</Typography>
        <RelativeTime prefix={byCreation ? t('mrList.row.created') : t('mrList.row.updated')} value={byCreation && createdAt ? createdAt : mergeRequest.updatedAt} />
      </Stack>
      <Typography sx={{ display: '-webkit-box', overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="subtitle1">{listTitle(mergeRequest)}</Typography>
      <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, flexWrap: 'wrap', minWidth: 0, mt: 0.5, pr: ROW_ACTIONS_SPACE, rowGap: 0.5 }}>
        {/* States first, as icons with counts; their names are in the tooltips. */}
        {mergeRequest.draft ? <StateIcon icon={<EditNoteRoundedIcon fontSize="inherit" />} label={t('mrList.row.draft')} /> : null}
        {pipeline ? <PipelineStatus compact status={pipeline.status} /> : null}
        <ApprovalStatus approval={approval} pending={approvalPending} state={mergeRequest.state} />
        {hasUnread ? <Tooltip title={t('mrList.row.unread', { count: unread })}><Chip aria-label={t('mrList.row.unreadAria', { count: unread })} color="primary" icon={<MarkChatUnreadRoundedIcon />} label={unread} size="small" /></Tooltip> : null}
        <Typography sx={{ fontWeight: 500 }} variant="caption">{mergeRequest.author.name}</Typography>
        {labels.slice(0, ROW_LABELS).map((label) => <Chip key={label} label={label} size="small" sx={{ maxWidth: '100%' }} variant="outlined" />)}
        {hiddenLabels.length ? <Tooltip title={hiddenLabels.join(', ')}><Chip aria-label={t('mrList.row.moreLabels', { count: hiddenLabels.length, labels: hiddenLabels.join(', ') })} label={`+${hiddenLabels.length}`} size="small" variant="outlined" /></Tooltip> : null}
      </Stack>
    </ListRow>
  )
})

/** Approval beside the state: who approved, or that an open MR has none yet. A placeholder while loading; nothing when unknown. */
function ApprovalStatus({ approval, pending, state }: { approval: RowApproval | null; pending: boolean; state: string }) {
  const t = useT()
  if (!approval && pending) return <Box aria-label={t('mrList.approval.pending')} role="img" sx={{ bgcolor: 'action.hover', borderRadius: 1, flexShrink: 0, height: 10, width: 24 }} />
  if (!approval) return null
  if (approval.count === 0) {
    if (state !== 'opened') return null
    return <StateIcon count={0} icon={<ThumbUpOutlinedIcon fontSize="inherit" />} label={t('mrList.approval.none')} />
  }
  const label = approval.byMe ? t('mrList.approval.byMe') : t('mrList.approval.count', { count: approval.count })
  // A filled thumb is the user's own approval; the count is everyone's.
  return <StateIcon count={approval.count} icon={approval.byMe ? <ThumbUpRoundedIcon fontSize="inherit" /> : <ThumbUpOutlinedIcon fontSize="inherit" />} label={label} tone="success" />
}

function LoadingRows() {
  const t = useT()
  return <Box aria-label={t('mrList.results.loading')} role="status" sx={{ ...delayedRevealSx, p: 1.5 }}><Stack spacing={1.5}>{[0, 1, 2, 3].map((index) => <Stack key={index} spacing={0.5}><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 10, width: '40%' }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 14, width: '90%' }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 10, width: '60%' }} /></Stack>)}</Stack></Box>
}
