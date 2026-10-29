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
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { hairline } from '../../components/hairline'
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
import { type ProjectLabel, readProjectLabels, sameProjectLabel, writeProjectLabels } from './projectLabels'
import { Row } from '../../components/Row'

const defaultConditions = { includeArchived: false, membershipOnly: true, page: 1, search: '', searchInput: '' }
const userProjectDefaultConditions = { ...defaultConditions, membershipOnly: false }

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
  // The conditions outlive the screen, so returning from a project shows the list as it was left.
  const stateKey = userId !== undefined ? `${scope.instanceUrl}:${scope.userId}:user-projects:${userId}` : `${scope.instanceUrl}:${scope.userId}:projects`
  const initialConditions = user ? userProjectDefaultConditions : defaultConditions
  const [conditions, setConditions] = useRememberedListState(stateKey, initialConditions)
  const { includeArchived, membershipOnly, page, search, searchInput } = conditions
  const [pinned, setPinned] = useState(() => readPinnedProjectIds(scope))
  const [recent, setRecent] = useState(() => readRecentProjectIds(scope))
  const [labels, setLabels] = useState(() => readProjectLabels(scope))
  const query = useMemo(() => userId !== undefined
    ? { includeArchived, kind: 'userProjects' as const, page, search: search.trim(), userId }
    : { includeArchived, kind: 'projects' as const, membership: membershipOnly, page, search: search.trim() },
  [includeArchived, membershipOnly, page, search, userId])
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
  const conditionsChanged = searchInput.trim() !== '' || search !== '' || includeArchived !== initialConditions.includeArchived || (!user && membershipOnly !== initialConditions.membershipOnly)
  const clearConditions = () => setConditions(initialConditions)

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
            onChange={(event) => setConditions({ searchInput: event.target.value })}
            placeholder={t('project.list.searchPlaceholder')}
            slotProps={{
              htmlInput: { 'aria-label': t('project.list.searchLabel') },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title={t('project.search.submitTooltip')}><IconButton aria-label={t('project.search.submit')} edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            value={searchInput}
          />
          <Row spacing={2} sx={{ flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
            {!user ? <FormControlLabel control={<Switch checked={membershipOnly} onChange={(event) => setConditions({ membershipOnly: event.target.checked, page: 1 })} slotProps={{ input: { 'aria-label': t('project.list.membershipOnlyLabel') } }} />} label={t('project.list.membershipOnly')} slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} /> : null}
            <FormControlLabel control={<Switch checked={includeArchived} onChange={(event) => setConditions({ includeArchived: event.target.checked, page: 1 })} slotProps={{ input: { 'aria-label': t('project.list.includeArchivedLabel') } }} />} label={t('project.list.archived')} slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} />
            {conditionsChanged ? <Button onClick={clearConditions} sx={{ color: 'text.secondary', minHeight: 24, ml: 'auto !important', px: 1 }}>{t('project.list.clearConditions')}</Button> : null}
          </Row>
        </Box>
      </PaneHeader>

      {!user && (pinned.length > 0 || recent.length > 0) ? <ProjectShortcuts ids={pinned} label={t('project.list.favourites')} labelOf={shortcutLabel} onOpen={openProjectId} secondaryIds={recent} secondaryLabel={t('project.list.recent')} /> : null}
      {/* GitLab returns the projects most recently active first. */}
      <PaneStatus announcement={result.data && !result.previous ? t('project.list.announcement', { count: projects.length, page }) : null}>{result.data && !result.previous ? <>{t('project.status.fetched', { count: projects.length })} · {t('project.list.order')}{page > 1 || result.snapshot?.nextPage ? ` · ${t('project.status.page', { page })}` : ''}{result.stale ? ` · ${t('project.status.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) })}` : result.refreshing ? ` · ${t('project.status.refreshing')}` : ''}{result.snapshot?.completeness === 'truncated' ? ` · ${t('project.list.truncated')}` : ''}</> : result.loading || result.previous ? t('project.list.loading') : null}</PaneStatus>

      <Box aria-busy={result.previous} sx={paneResultsSx(result.previous)}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('project.retry')}</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('project.retry')}</Button>} severity="warning" sx={{ m: 1.5 }}>{t('project.status.refreshFailed', { message: result.error.message })}</Alert> : null}
        {!result.loading && !result.data && !result.error ? <PaneEmpty description={user ? userProjectEmptyDescription(search, includeArchived) : t('project.list.empty.description')} icon={<SourceOutlinedIcon fontSize="inherit" />} title={t('project.list.empty.title')} /> : null}
        {result.data && projects.length === 0 ? <PaneEmpty description={user ? userProjectEmptyDescription(search, includeArchived) : t('project.conditions.applied', { conditions: projectConditionSummary(search, membershipOnly, includeArchived) })} icon={<SourceOutlinedIcon fontSize="inherit" />} title={t('project.list.noMatch.title')}>{conditionsChanged ? <Button onClick={clearConditions} variant="outlined">{t('project.list.clearConditions')}</Button> : null}</PaneEmpty> : null}
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
