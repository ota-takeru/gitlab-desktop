import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SourceOutlinedIcon from '@mui/icons-material/SourceOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { ListRow } from '../../components/ListRow'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { paneGutter, paneResultsSx } from '../../components/paneSx'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon } from '../../components/StateIcon'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { formatFetchedAt } from '../../lib/format'
import type { GitLabUser, Project } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { preferenceScope, readPinnedProjectIds, readRecentProjectIds, writePinnedProjectIds, writeRecentProjectIds } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { useRememberedListState } from './listState'
import { ProjectConditionEditor } from './ProjectConditions'
import { addableKinds, CONDITION_NAMES, defaultProjectFilters, ORDER_NAMES, projectConditionChips, projectFilterQuery, type ProjectConditionKind, type ProjectFilterValues } from './projectFilters'
import { type ProjectLabel, readProjectLabels, sameProjectLabel, writeProjectLabels } from './projectLabels'
import { Row } from '../../components/Row'

const defaultConditions = { ...defaultProjectFilters, includeArchived: false, membershipOnly: true, page: 1, search: '', searchInput: '' }
const userProjectDefaultConditions = { ...defaultConditions, membershipOnly: false }
const pillSelectSx = { bgcolor: 'transparent', typography: 'body2', '& .MuiSelect-icon': { fontSize: 18 } } as const

interface ProjectViewProps {
  onOpenProject: (project: Project) => void
  onOpenProjectId?: (projectId: string) => void
  user?: GitLabUser
  navigation?: ReactNode
}

export function ProjectView(props: ProjectViewProps) {
  // Selecting another person starts with that person's own remembered conditions.
  return <ProjectViewContent key={props.user ? `user:${props.user.id}` : 'projects'} {...props} />
}

function ProjectViewContent({ navigation, onOpenProject, onOpenProjectId, user }: ProjectViewProps) {
  const { session } = useConnection()
  const t = useT()
  const userId = user?.id
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchFieldRef = useRef<HTMLDivElement>(null)
  const searchOptionsRef = useRef<HTMLDivElement>(null)
  const [searchOptions, setSearchOptions] = useState<{ anchor: HTMLElement; keyboard: boolean; width: number } | null>(null)
  const [editing, setEditing] = useState<{ anchor: HTMLElement; kind: ProjectConditionKind } | null>(null)
  // The conditions outlive the screen, so returning from a project shows the list as it was left.
  const stateKey = userId !== undefined ? `${scope.instanceUrl}:${scope.userId}:user-projects:${userId}` : `${scope.instanceUrl}:${scope.userId}:projects`
  const initialConditions = user ? userProjectDefaultConditions : defaultConditions
  const [conditions, setConditions] = useRememberedListState(stateKey, initialConditions)
  const { includeArchived, membershipOnly, page, search, searchInput } = conditions
  const [pinned, setPinned] = useState(() => readPinnedProjectIds(scope))
  const [recent, setRecent] = useState(() => readRecentProjectIds(scope))
  const [labels, setLabels] = useState(() => readProjectLabels(scope))
  // A person's projects take only the search word and archived projects; the other conditions are the project list's.
  const filters: ProjectFilterValues = conditions
  const filterQuery = useMemo(() => projectFilterQuery(filters), [filters])
  const query = useMemo(() => userId !== undefined
    ? { includeArchived, kind: 'userProjects' as const, page, search: search.trim(), userId }
    : { ...filterQuery, includeArchived, kind: 'projects' as const, membership: membershipOnly, page, search: search.trim() },
  [filterQuery, includeArchived, membershipOnly, page, search, userId])
  const result = useGitLabQuery(session?.id ?? null, query, { keepPrevious: true })
  const projects = useMemo(() => result.data ?? [], [result.data])

  const rememberLabels = (keepIds: string[], project: Project) => {
    setLabels(writeProjectLabels(scope, readProjectLabels(scope), [...projects, project], keepIds))
  }

  const togglePinned = (project: Project) => {
    const next = pinned.includes(project.id) ? pinned.filter((id) => id !== project.id) : [...pinned, project.id].slice(0, 100)
    setPinned(next)
    writePinnedProjectIds(scope, next)
    rememberLabels([...next, ...recent], project)
  }

  // Shortcuts saved before names were kept learn them when the project shows up in a list.
  useEffect(() => {
    const keep = [...pinned, ...recent]
    const stored = readProjectLabels(scope)
    if (projects.some((project) => keep.includes(project.id) && !sameProjectLabel(stored[project.id], project))) writeProjectLabels(scope, stored, projects, keep)
  }, [pinned, projects, recent, scope])

  useEffect(() => {
    const focus = () => searchInputRef.current?.focus()
    globalThis.addEventListener('gitlab-focus-project-search', focus)
    return () => globalThis.removeEventListener('gitlab-focus-project-search', focus)
  }, [])

  const openProject = (project: Project) => {
    const nextRecent = [project.id, ...recent.filter((id) => id !== project.id)].slice(0, 20)
    setRecent(nextRecent)
    writeRecentProjectIds(scope, nextRecent)
    rememberLabels([...pinned, ...nextRecent], project)
    onOpenProject(project)
  }

  const openProjectId = (projectId: string) => {
    const nextRecent = [projectId, ...recent.filter((id) => id !== projectId)].slice(0, 20)
    setRecent(nextRecent)
    writeRecentProjectIds(scope, nextRecent)
    // A shortcut to a project outside the current page still opens its screen, by id.
    const project = projectById.get(projectId)
    if (project) onOpenProject(project)
    else onOpenProjectId?.(projectId)
  }

  const projectById = new Map(projects.map((project) => [project.id, project]))
  const shortcutLabel = (id: string): ProjectLabel | undefined => projectById.get(id) ?? labels[id]
  const chips = user ? [] : projectConditionChips(filters)
  const addable = user ? [] : addableKinds(filters)
  const conditionsChanged = searchInput.trim() !== '' || search !== '' || includeArchived !== initialConditions.includeArchived || (!user && (membershipOnly !== initialConditions.membershipOnly || chips.length > 0 || filters.orderBy !== defaultProjectFilters.orderBy || filters.sort !== defaultProjectFilters.sort))
  const clearConditions = () => setConditions(initialConditions)
  // A person's contributed projects take neither a search word nor the switches, which GitLab does not filter them by.
  const byContributor = !user && filters.contributorId !== ''
  const applyFilters = (patch: Partial<ProjectFilterValues>) => setConditions({ ...patch, ...(patch.contributorId ? { search: '', searchInput: '' } : {}), page: 1 })
  const openSearchOptions = (keyboard: boolean) => {
    const anchor = searchFieldRef.current
    if (anchor && addable.length) setSearchOptions({ anchor, keyboard, width: anchor.clientWidth })
  }
  // The options close when focus leaves both the field and the options.
  const closeSearchOptionsOnBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null
    if (next && (searchFieldRef.current?.contains(next) || searchOptionsRef.current?.contains(next))) return
    setSearchOptions(null)
  }
  const chooseSearchOption = (kind: ProjectConditionKind) => {
    setSearchOptions(null)
    // Starring has no value to choose, so it applies at once.
    if (kind === 'starred') applyFilters({ starred: true })
    else if (searchOptions) setEditing({ anchor: searchOptions.anchor, kind })
  }

  if (!session) {
    return <PaneEmpty description={t('project.connect.projects')} icon={<SourceOutlinedIcon fontSize="inherit" />} title={t('project.connect.title')}><Button href="#client/settings" variant="contained">{t('project.connect.openSettings')}</Button></PaneEmpty>
  }

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader actions={<Tooltip title={t('project.refresh')}><span><IconButton aria-label={t('project.refresh')} disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>} navigation={navigation} title={t('project.list.title')}>
        <Box component="form" onSubmit={(event) => { event.preventDefault(); setConditions({ page: 1, search: searchInput.trim() }) }}>
          <TextField
            fullWidth
            inputRef={searchInputRef}
            onChange={(event) => {
              setSearchOptions(null)
              setConditions({ searchInput: event.target.value })
            }}
            placeholder={byContributor ? t('project.list.contributorPlaceholder') : t('project.list.searchPlaceholder')}
            ref={searchFieldRef}
            slotProps={{
              htmlInput: user ? { 'aria-label': t('project.list.searchLabel') } : {
                // A text field that opens the conditions menu, as the MR list's does.
                role: 'combobox',
                'aria-controls': searchOptions ? 'project-search-options' : undefined,
                'aria-expanded': Boolean(searchOptions),
                'aria-haspopup': 'menu',
                'aria-label': t('project.list.searchLabel'),
                readOnly: byContributor,
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
                onClick: user ? undefined : (event) => { if (!(event.target as Element).closest('.MuiChip-root, button')) openSearchOptions(false) },
                startAdornment: <>
                  <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>
                  {/* Each applied condition shows its value as a tag in the field: a tag opens its editor, ✕ removes it. */}
                  {chips.length ? <Box aria-label={t('project.search.applied')} role="group" sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: '100%', mr: 0.5, py: 0.5 }}>
                    {chips.map((chip) => <Chip color="primary" deleteIcon={<CancelRoundedIcon aria-label={t('project.search.removeCondition', { name: chip.name })} />} key={chip.kind} label={chip.label} onClick={chip.kind === 'starred' ? undefined : (event: MouseEvent<HTMLElement>) => setEditing({ anchor: event.currentTarget, kind: chip.kind })} onDelete={() => applyFilters(chip.clear)} size="small" sx={{ fontFamily: chip.code ? 'code.fontFamily' : undefined, maxWidth: '100%' }} variant="outlined" />)}
                  </Box> : null}
                </>,
                endAdornment: <InputAdornment position="end"><Tooltip title={t('project.search.submitTooltip')}><IconButton aria-label={t('project.search.submit')} edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
                sx: { flexWrap: 'wrap', '& .MuiInputBase-input': { flex: 1, minWidth: 160, width: 'auto' } },
              },
            }}
            value={searchInput}
          />
          {!user ? <Popper anchorEl={searchOptions?.anchor} open={Boolean(searchOptions)} placement="bottom-start" sx={{ maxWidth: 'calc(100vw - 16px)', width: searchOptions?.width, zIndex: 'modal' }}>
            <Paper ref={searchOptionsRef} sx={{ ...panelFrame(), boxShadow: 8, mt: 0.5, py: 0.5 }}>
              <Typography color="textSecondary" sx={{ display: 'block', px: 1.5 }} variant="overline">{t('project.search.addCondition')}</Typography>
              <MenuList
                aria-label={t('project.search.conditionsMenu')}
                autoFocusItem={searchOptions?.keyboard}
                dense
                id="project-search-options"
                onBlur={closeSearchOptionsOnBlur}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  setSearchOptions(null)
                  searchInputRef.current?.focus()
                }}
              >
                {addable.map((kind) => <MenuItem key={kind} onClick={() => chooseSearchOption(kind)}>{t(CONDITION_NAMES[kind])}</MenuItem>)}
              </MenuList>
            </Paper>
          </Popper> : null}
          <Row spacing={2} sx={{ flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
            {!user ? <FormControlLabel control={<Switch checked={membershipOnly} disabled={byContributor} onChange={(event) => setConditions({ membershipOnly: event.target.checked, page: 1 })} slotProps={{ input: { 'aria-label': t('project.list.membershipOnlyLabel') } }} />} label={t('project.list.membershipOnly')} slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} /> : null}
            <FormControlLabel control={<Switch checked={includeArchived} disabled={byContributor} onChange={(event) => setConditions({ includeArchived: event.target.checked, page: 1 })} slotProps={{ input: { 'aria-label': t('project.list.includeArchivedLabel') } }} />} label={t('project.list.archived')} slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} />
            {conditionsChanged ? <Button onClick={clearConditions} sx={{ color: 'text.secondary', minHeight: 24, ml: user ? 'auto !important' : undefined, px: 1 }}>{t('project.list.clearConditions')}</Button> : null}
            {/* The order is not a condition, so it stays a pull-down beside the switches. */}
            {!user ? <Row sx={{ gap: 0.5, ml: 'auto !important' }}>
              <Select aria-label={t('project.order.aria')} onChange={(event) => applyFilters({ orderBy: event.target.value as ProjectFilterValues['orderBy'] })} sx={pillSelectSx} value={filters.orderBy}>
                {(Object.keys(ORDER_NAMES) as ProjectFilterValues['orderBy'][]).map((orderBy) => <MenuItem key={orderBy} value={orderBy}>{t(ORDER_NAMES[orderBy])}</MenuItem>)}
              </Select>
              <Select aria-label={t('project.order.directionAria')} onChange={(event) => applyFilters({ sort: event.target.value as ProjectFilterValues['sort'] })} sx={pillSelectSx} value={filters.sort}>
                <MenuItem value="desc">{t('project.order.desc')}</MenuItem>
                <MenuItem value="asc">{t('project.order.asc')}</MenuItem>
              </Select>
            </Row> : null}
          </Row>
          {!user ? <ProjectConditionEditor anchorEl={editing?.anchor ?? null} currentUser={session.user} kind={editing?.kind ?? null} onApply={applyFilters} onClose={() => setEditing(null)} values={filters} /> : null}
        </Box>
      </PaneHeader>

      {!user && (pinned.length > 0 || recent.length > 0) ? <ProjectShortcuts ids={pinned} label={t('project.list.favourites')} labelOf={shortcutLabel} onOpen={openProjectId} secondaryIds={recent} secondaryLabel={t('project.list.recent')} /> : null}
      <PaneStatus announcement={result.data && !result.previous ? t('project.list.announcement', { count: projects.length, page }) : null}>{result.data && !result.previous ? <>{t('project.status.fetched', { count: projects.length })} · {user ? t('project.order.lastActivity') : t(ORDER_NAMES[filters.orderBy])}{page > 1 || result.snapshot?.nextPage ? ` · ${t('project.status.page', { page })}` : ''}{result.stale ? ` · ${t('project.status.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) })}` : result.refreshing ? ` · ${t('project.status.refreshing')}` : ''}{result.snapshot?.completeness === 'truncated' ? ` · ${t('project.list.truncated')}` : ''}</> : result.loading || result.previous ? t('project.list.loading') : null}</PaneStatus>

      <Box aria-busy={result.previous} sx={paneResultsSx(result.previous)}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('project.retry')}</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('project.retry')}</Button>} severity="warning" sx={{ m: 1.5 }}>{t('project.status.refreshFailed', { message: result.error.message })}</Alert> : null}
        {!result.loading && !result.data && !result.error ? <PaneEmpty description={user ? userProjectEmptyDescription(search, includeArchived) : t('project.list.empty.description')} icon={<SourceOutlinedIcon fontSize="inherit" />} title={t('project.list.empty.title')} /> : null}
        {result.data && projects.length === 0 ? <PaneEmpty description={user ? userProjectEmptyDescription(search, includeArchived) : t('project.conditions.applied', { conditions: [...(byContributor ? [] : [projectConditionSummary(search, membershipOnly, includeArchived)]), ...chips.map((chip) => chip.label)].join(' · ') })} icon={<SourceOutlinedIcon fontSize="inherit" />} title={t('project.list.noMatch.title')}>{conditionsChanged ? <Button onClick={clearConditions} variant="outlined">{t('project.list.clearConditions')}</Button> : null}</PaneEmpty> : null}
        {projects.length ? <Box aria-label={t('project.list.label')} component="ul" onKeyDown={moveListRowFocus} sx={{ m: 0, p: 0 }}>
          {projects.map((project) => {
            const isPinned = pinned.includes(project.id)
            const favouriteButton = <Tooltip title={isPinned ? t('project.list.favourite.remove') : t('project.list.favourite.add')}><IconButton aria-label={isPinned ? t('project.list.favourite.removeNamed', { name: project.name }) : t('project.list.favourite.addNamed', { name: project.name })} color={isPinned ? 'primary' : 'default'} onClick={() => togglePinned(project)}>{isPinned ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}</IconButton></Tooltip>
            return (
              <ListRow key={project.id}
                actions={!isPinned ? favouriteButton : undefined}
                // A favourite keeps its star in view: the mark and the button to remove it are one control.
                stickyActions={isPinned ? favouriteButton : undefined}
                leading={<SourceOutlinedIcon sx={{ color: 'place.projects', fontSize: 16 }} />}
                onOpen={() => openProject(project)}
              >
                <Row spacing={1} sx={{ minWidth: 0 }}>
                  <Tooltip enterDelay={600} title={project.name}><Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }} variant="body2">{project.name}</Typography></Tooltip>
                  {project.archived ? <StateIcon icon={<Inventory2OutlinedIcon fontSize="inherit" />} label={t('project.list.archived')} /> : null}
                  {project.lastActivityAt ? <RelativeTime prefix={t('project.list.activity')} value={project.lastActivityAt} /> : null}
                </Row>
                <Tooltip enterDelay={600} title={project.pathWithNamespace}><Typography color="textSecondary" component="div" noWrap variant="caption">{project.pathWithNamespace}</Typography></Tooltip>
                {project.description ? <Typography color="textSecondary" component="div" noWrap title={project.description} variant="caption">{project.description}</Typography> : null}
              </ListRow>
            )
          })}
        </Box> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage) ? <Box sx={{ ...hairline('top'), px: 1, py: 0.5 }}><Pager hasNext={(result.snapshot?.nextPage ?? null) !== null} hasPrevious={page > 1} onNext={() => setConditions({ page: page + 1 })} onPrevious={() => setConditions({ page: Math.max(1, page - 1) })} page={page} /></Box> : null}
    </Box>
  )
}

/** Favourite and recent projects as chips above the project list. */
export function ProjectShortcuts({ ids, label, labelOf, onOpen, secondaryIds, secondaryLabel }: { ids: string[]; label: string; labelOf: (id: string) => ProjectLabel | undefined; onOpen: (projectId: string) => void; secondaryIds: string[]; secondaryLabel: string }) {
  const t = useT()
  return <Stack aria-label={t('project.shortcuts.label')} component="section" spacing={1} sx={{ ...hairline('bottom'), flexShrink: 0, px: paneGutter, py: 1 }}><ShortcutGroup icon={<StarRoundedIcon color="primary" fontSize="inherit" />} ids={ids} label={label} labelOf={labelOf} onOpen={onOpen} /><ShortcutGroup ids={secondaryIds} label={secondaryLabel} labelOf={labelOf} onOpen={onOpen} /></Stack>
}

function ShortcutGroup({ icon, ids, label, labelOf, onOpen }: { icon?: React.ReactNode; ids: string[]; label: string; labelOf: (id: string) => ProjectLabel | undefined; onOpen: (projectId: string) => void }) {
  const t = useT()
  if (ids.length === 0) return null
  return <Row align="top" spacing={1}><Typography color="textSecondary" sx={{ alignItems: 'center', display: 'inline-flex', flex: '0 0 auto', gap: 0.5, minHeight: 24, minWidth: 32 }} variant="caption">{icon}{label}</Typography><Row sx={{ flexWrap: 'wrap', gap: 0.5 }}>{ids.map((id) => {
    const project = labelOf(id)
    // A shortcut saved before names were kept shows its id until the project is listed again.
    if (!project) return <Chip clickable key={`${label}:${id}`} label={t('project.fallbackName', { id })} onClick={() => onOpen(id)} size="small" variant="outlined" />
    return <Tooltip key={`${label}:${id}`} title={project.pathWithNamespace}><Chip aria-label={t('project.shortcuts.chip', { name: project.name, path: project.pathWithNamespace })} clickable label={project.name} onClick={() => onOpen(id)} size="small" variant="outlined" /></Tooltip>
  })}</Row></Row>
}

function projectConditionSummary(search: string, membershipOnly: boolean, includeArchived: boolean): string {
  return [search ? translate('project.conditions.search', { search }) : null, translate(membershipOnly ? 'project.conditions.membershipOnly' : 'project.conditions.includeNonMember'), translate(includeArchived ? 'project.conditions.includeArchived' : 'project.conditions.excludeArchived')].filter(Boolean).join(' · ')
}

function userProjectEmptyDescription(search: string, includeArchived: boolean): string {
  const conditions = [search ? translate('project.conditions.search', { search }) : null, translate(includeArchived ? 'project.conditions.includeArchived' : 'project.conditions.excludeArchived')].filter(Boolean).join(' · ')
  return translate('project.conditions.appliedForUser', { conditions })
}
