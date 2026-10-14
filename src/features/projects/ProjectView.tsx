import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
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

import { ListRow } from '../../components/ListRow'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { paneResultsSx } from '../../components/paneSx'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { formatFetchedAt } from '../../lib/format'
import type { Project } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { preferenceScope, readPinnedProjectIds, readRecentProjectIds, writePinnedProjectIds, writeRecentProjectIds } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { useRememberedListState } from './listState'
import { type ProjectLabel, readProjectLabels, sameProjectLabel, writeProjectLabels } from './projectLabels'

const defaultConditions = { includeArchived: false, membershipOnly: true, page: 1, search: '', searchInput: '' }

export function ProjectView({ onOpenProject, onOpenProjectId }: { onOpenProject: (project: Project) => void; onOpenProjectId?: (projectId: string) => void }) {
  const { session } = useConnection()
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  // The conditions outlive the screen, so returning from a project shows the list as it was left.
  const [conditions, setConditions] = useRememberedListState(`${scope.instanceUrl}:${scope.userId}:projects`, defaultConditions)
  const { includeArchived, membershipOnly, page, search, searchInput } = conditions
  const [pinned, setPinned] = useState(() => readPinnedProjectIds(scope))
  const [recent, setRecent] = useState(() => readRecentProjectIds(scope))
  const [labels, setLabels] = useState(() => readProjectLabels(scope))
  const query = useMemo(() => ({
    includeArchived,
    kind: 'projects' as const,
    membership: membershipOnly,
    page,
    search: search.trim(),
  }), [includeArchived, membershipOnly, page, search])
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
  const conditionsChanged = searchInput.trim() !== '' || search !== '' || includeArchived !== defaultConditions.includeArchived || membershipOnly !== defaultConditions.membershipOnly
  const clearConditions = () => setConditions(defaultConditions)

  if (!session) {
    return <PaneEmpty description="GitLabに接続すると、参加しているプロジェクトを検索できます。" icon={<SourceOutlinedIcon fontSize="inherit" />} title="GitLabに接続してください"><Button href="#client/settings" variant="contained">設定を開く</Button></PaneEmpty>
  }

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader actions={<Tooltip title="更新"><span><IconButton aria-label="更新" disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>} title="プロジェクト">
        <Box component="form" onSubmit={(event) => { event.preventDefault(); setConditions({ page: 1, search: searchInput.trim() }) }}>
          <TextField
            fullWidth
            inputRef={searchInputRef}
            onChange={(event) => setConditions({ searchInput: event.target.value })}
            placeholder="名前・パス・namespaceで検索"
            slotProps={{
              htmlInput: { 'aria-label': 'プロジェクトを検索' },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title="検索 (Enter)"><IconButton aria-label="検索" edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            value={searchInput}
          />
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
            <FormControlLabel control={<Switch checked={membershipOnly} onChange={(event) => setConditions({ membershipOnly: event.target.checked, page: 1 })} slotProps={{ input: { 'aria-label': '参加中のプロジェクトだけ' } }} />} label="参加中のみ" slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} sx={{ ml: -0.5 }} />
            <FormControlLabel control={<Switch checked={includeArchived} onChange={(event) => setConditions({ includeArchived: event.target.checked, page: 1 })} slotProps={{ input: { 'aria-label': 'アーカイブ済みを含める' } }} />} label="アーカイブ済み" slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} />
            {conditionsChanged ? <Button onClick={clearConditions} sx={{ color: 'text.secondary', minHeight: 26, ml: 'auto !important', px: 1 }}>条件をクリア</Button> : null}
          </Stack>
        </Box>
      </PaneHeader>

      {pinned.length > 0 || recent.length > 0 ? <ProjectShortcuts ids={pinned} label="お気に入り" labelOf={shortcutLabel} onOpen={openProjectId} secondaryIds={recent} secondaryLabel="最近" /> : null}
      {/* GitLab returns the projects most recently active first. */}
      <PaneStatus announcement={result.data && !result.previous ? `プロジェクト ${projects.length}件（ページ ${page}）` : null}>{result.data && !result.previous ? <>{projects.length}件取得 · 最近の活動順{page > 1 || result.snapshot?.nextPage ? ` · ページ ${page}` : ''}{result.stale ? ` · 保存済み · ${formatFetchedAt(result.snapshot?.fetchedAt)}` : result.refreshing ? ' · 更新中…' : ''}{result.snapshot?.completeness === 'truncated' ? ' · 省略あり' : ''}</> : result.loading || result.previous ? 'プロジェクトを読み込み中…' : null}</PaneStatus>

      <Box aria-busy={result.previous} sx={paneResultsSx(result.previous)}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="warning" sx={{ m: 1.5 }}>保存済みの一覧を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {!result.loading && !result.data && !result.error ? <PaneEmpty description="検索条件を変えるか、別のページを取得してください。" icon={<SourceOutlinedIcon fontSize="inherit" />} title="プロジェクトがありません" /> : null}
        {result.data && projects.length === 0 ? <PaneEmpty description={`適用中の条件: ${projectConditionSummary(search, membershipOnly, includeArchived)}`} icon={<SourceOutlinedIcon fontSize="inherit" />} title="条件に一致するプロジェクトがありません">{conditionsChanged ? <Button onClick={clearConditions} variant="outlined">条件をクリア</Button> : null}</PaneEmpty> : null}
        {projects.length ? <Box aria-label="プロジェクト" component="ul" onKeyDown={moveListRowFocus} sx={{ m: 0, p: 0 }}>
          {projects.map((project) => {
            const isPinned = pinned.includes(project.id)
            const favouriteButton = <Tooltip title={isPinned ? 'お気に入りから外す' : 'お気に入りに追加'}><IconButton aria-label={isPinned ? `${project.name}をお気に入りから外す` : `${project.name}をお気に入りに追加`} color={isPinned ? 'primary' : 'default'} onClick={() => togglePinned(project)}>{isPinned ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}</IconButton></Tooltip>
            return (
              <ListRow
                actions={isPinned ? undefined : favouriteButton}
                // A favourite keeps its star in view: the mark and the button to remove it are one control.
                stickyActions={isPinned ? favouriteButton : undefined}
                ariaLabel={`${project.name}（${project.pathWithNamespace}）`}
                key={project.id}
                leading={<SourceOutlinedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />}
                onOpen={() => openProject(project)}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
                  <Tooltip enterDelay={600} title={project.name}><Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }} variant="body2">{project.name}</Typography></Tooltip>
                  {project.archived ? <Chip label="アーカイブ済み" size="small" variant="outlined" /> : null}
                  {project.lastActivityAt ? <RelativeTime prefix="活動" value={project.lastActivityAt} /> : null}
                </Stack>
                <Tooltip enterDelay={600} title={project.pathWithNamespace}><Typography color="textSecondary" component="div" noWrap variant="caption">{project.pathWithNamespace}</Typography></Tooltip>
                {project.description ? <Typography color="textSecondary" component="div" noWrap sx={{ mt: 0.25 }} title={project.description} variant="caption">{project.description}</Typography> : null}
              </ListRow>
            )
          })}
        </Box> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager hasNext={(result.snapshot?.nextPage ?? null) !== null} hasPrevious={page > 1} onNext={() => setConditions({ page: page + 1 })} onPrevious={() => setConditions({ page: Math.max(1, page - 1) })} page={page} /></Box> : null}
    </Box>
  )
}

/** Favourite and recent projects as chips above the project list. */
export function ProjectShortcuts({ ids, label, labelOf, onOpen, secondaryIds, secondaryLabel }: { ids: string[]; label: string; labelOf: (id: string) => ProjectLabel | undefined; onOpen: (projectId: string) => void; secondaryIds: string[]; secondaryLabel: string }) {
  return <Stack aria-label="プロジェクトへのショートカット" component="section" spacing={1} sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.5, py: 1 }}><ShortcutGroup icon={<StarRoundedIcon color="primary" fontSize="inherit" />} ids={ids} label={label} labelOf={labelOf} onOpen={onOpen} /><ShortcutGroup ids={secondaryIds} label={secondaryLabel} labelOf={labelOf} onOpen={onOpen} /></Stack>
}

function ShortcutGroup({ icon, ids, label, labelOf, onOpen }: { icon?: React.ReactNode; ids: string[]; label: string; labelOf: (id: string) => ProjectLabel | undefined; onOpen: (projectId: string) => void }) {
  if (ids.length === 0) return null
  return <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}><Typography color="textSecondary" sx={{ alignItems: 'center', display: 'inline-flex', flex: '0 0 auto', gap: 0.5, minHeight: 24, minWidth: 32 }} variant="caption">{icon}{label}</Typography><Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>{ids.map((id) => {
    const project = labelOf(id)
    // A shortcut saved before names were kept shows its id until the project is listed again.
    if (!project) return <Chip clickable key={`${label}:${id}`} label={`プロジェクト ${id}`} onClick={() => onOpen(id)} size="small" variant="outlined" />
    return <Tooltip key={`${label}:${id}`} title={project.pathWithNamespace}><Chip aria-label={`${project.name}（${project.pathWithNamespace}）`} clickable label={project.name} onClick={() => onOpen(id)} size="small" variant="outlined" /></Tooltip>
  })}</Stack></Stack>
}

function projectConditionSummary(search: string, membershipOnly: boolean, includeArchived: boolean): string {
  return [search ? `検索語「${search}」` : null, membershipOnly ? '参加中のみ' : '参加していないものを含む', includeArchived ? 'アーカイブ済みを含む' : 'アーカイブ済みを除く'].filter(Boolean).join(' · ')
}
