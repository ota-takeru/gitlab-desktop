import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded'
import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
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
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { Pager } from '../../components/Pager'
import type { Project } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { preferenceScope, readPinnedProjectIds, readRecentProjectIds, writePinnedProjectIds, writeRecentProjectIds } from '../shared/preferences'
import { useGitLabQuery } from '../shared/useGitLabQuery'

export function ProjectView({ onOpenProject, onOpenProjectId }: { onOpenProject: (project: Project) => void; onOpenProjectId?: (projectId: string) => void }) {
  const { session } = useConnection()
  const scope = useMemo(() => preferenceScope(session?.instanceUrl ?? 'anonymous', session?.user.id ?? 'anonymous'), [session?.instanceUrl, session?.user.id])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [membershipOnly, setMembershipOnly] = useState(true)
  const [page, setPage] = useState(1)
  const [pinned, setPinned] = useState(() => readPinnedProjectIds(scope))
  const [recent, setRecent] = useState(() => readRecentProjectIds(scope))
  const query = useMemo(() => ({
    includeArchived,
    kind: 'projects' as const,
    membership: membershipOnly,
    page,
    search: search.trim(),
  }), [includeArchived, membershipOnly, page, search])
  const result = useGitLabQuery(session?.id ?? null, query)
  const projects = useMemo(() => result.data ?? [], [result.data])

  const togglePinned = (projectId: string) => {
    const next = pinned.includes(projectId) ? pinned.filter((id) => id !== projectId) : [...pinned, projectId].slice(0, 100)
    setPinned(next)
    writePinnedProjectIds(scope, next)
  }

  useEffect(() => {
    const focus = () => searchInputRef.current?.focus()
    globalThis.addEventListener('gitlab-focus-project-search', focus)
    return () => globalThis.removeEventListener('gitlab-focus-project-search', focus)
  }, [])

  const openProject = (project: Project) => {
    const nextRecent = [project.id, ...recent.filter((id) => id !== project.id)].slice(0, 20)
    setRecent(nextRecent)
    writeRecentProjectIds(scope, nextRecent)
    onOpenProject(project)
  }

  const openProjectId = (projectId: string) => {
    const nextRecent = [projectId, ...recent.filter((id) => id !== projectId)].slice(0, 20)
    setRecent(nextRecent)
    writeRecentProjectIds(scope, nextRecent)
    if (onOpenProjectId) onOpenProjectId(projectId)
    else {
      const project = projectById.get(projectId)
      if (project) onOpenProject(project)
    }
  }

  const projectById = new Map(projects.map((project) => [project.id, project]))

  if (!session) {
    return <PaneEmpty description="GitLabに接続すると、参加しているプロジェクトを検索できます。" title="GitLabに接続してください"><Button href="#client/settings" variant="contained">接続設定を開く</Button></PaneEmpty>
  }

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader actions={<Tooltip title="更新"><span><IconButton aria-label="更新" disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>} title="プロジェクト">
        <Box component="form" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1) }}>
          <TextField
            fullWidth
            inputRef={searchInputRef}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="名前またはnamespace"
            slotProps={{
              htmlInput: { 'aria-label': 'プロジェクトを検索' },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title="検索 (Enter)"><IconButton aria-label="検索" edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            value={searchInput}
          />
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mt: 0.75, rowGap: 0.5 }}>
            <FormControlLabel control={<Switch checked={membershipOnly} onChange={(event) => { setMembershipOnly(event.target.checked); setPage(1) }} slotProps={{ input: { 'aria-label': '参加中のプロジェクトだけ' } }} />} label="参加中のみ" slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} sx={{ ml: -0.5 }} />
            <FormControlLabel control={<Switch checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(1) }} slotProps={{ input: { 'aria-label': 'アーカイブ済みを含める' } }} />} label="アーカイブ済み" slotProps={{ typography: { color: 'text.secondary', variant: 'caption' } }} />
          </Stack>
        </Box>
      </PaneHeader>

      {pinned.length > 0 || recent.length > 0 ? <ProjectShortcuts ids={pinned} label="固定" onOpen={openProjectId} projectById={projectById} secondaryIds={recent} secondaryLabel="最近" /> : null}
      {result.data ? <PaneStatus>{projects.length}件取得{page > 1 || result.snapshot?.nextPage ? ` · ページ ${page}` : ''}{result.stale ? ` · 保存済み · ${formatFetchedAt(result.snapshot?.fetchedAt)}` : result.refreshing ? ' · 更新中…' : ''}{result.snapshot?.completeness === 'truncated' ? ' · 省略あり' : ''}</PaneStatus> : null}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert severity="warning" sx={{ m: 1.5 }}>保存済みの一覧を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {result.loading && !result.data ? <Typography aria-label="プロジェクトを読み込み中" color="text.secondary" role="status" sx={{ display: 'block', p: 1.5 }} variant="caption">プロジェクトを読み込み中…</Typography> : null}
        {!result.loading && !result.data && !result.error ? <PaneEmpty description="検索条件を変えるか、別のページを取得してください。" title="プロジェクトがありません" /> : null}
        {result.data && projects.length === 0 ? <PaneEmpty description="検索条件を変えてください。" title="条件に一致するプロジェクトがありません。" /> : null}
        {projects.length ? <Box component="ul" sx={{ m: 0, p: 0 }}>
          {projects.map((project) => {
            const isPinned = pinned.includes(project.id)
            return (
              <ListRow
                actions={<Tooltip title={isPinned ? '固定を解除' : 'プロジェクトを固定'}><IconButton aria-label={isPinned ? `${project.name}の固定を解除` : `${project.name}を固定`} color={isPinned ? 'primary' : 'default'} onClick={() => togglePinned(project.id)}>{isPinned ? <BookmarkRoundedIcon /> : <BookmarkBorderRoundedIcon />}</IconButton></Tooltip>}
                ariaLabel={project.name}
                key={project.id}
                leading={<FolderOpenRoundedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />}
                onOpen={() => openProject(project)}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }} variant="body2">{project.name}</Typography>
                  {project.archived ? <Chip label="アーカイブ済み" size="small" variant="outlined" /> : null}
                </Stack>
                <Typography color="text.secondary" component="div" noWrap variant="caption">{project.pathWithNamespace}</Typography>
                {project.description ? <Typography color="text.secondary" component="div" noWrap sx={{ mt: 0.25 }} variant="caption">{project.description}</Typography> : null}
              </ListRow>
            )
          })}
        </Box> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager hasNext={(result.snapshot?.nextPage ?? null) !== null} hasPrevious={page > 1} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(1, current - 1))} page={page} /></Box> : null}
    </Box>
  )
}

function ProjectShortcuts({ ids, label, onOpen, projectById, secondaryIds, secondaryLabel }: { ids: string[]; label: string; onOpen: (projectId: string) => void; projectById: Map<string, Project>; secondaryIds: string[]; secondaryLabel: string }) {
  return <Stack aria-label="プロジェクトへのショートカット" component="section" spacing={0.75} sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.5, py: 1 }}><ShortcutGroup ids={ids} label={label} onOpen={onOpen} projectById={projectById} /><ShortcutGroup ids={secondaryIds} label={secondaryLabel} onOpen={onOpen} projectById={projectById} /></Stack>
}

function ShortcutGroup({ ids, label, onOpen, projectById }: { ids: string[]; label: string; onOpen: (projectId: string) => void; projectById: Map<string, Project> }) {
  if (ids.length === 0) return null
  return <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}><Typography color="text.secondary" sx={{ flex: '0 0 32px' }} variant="caption">{label}</Typography><Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>{ids.map((id) => { const project = projectById.get(id); return <Chip clickable key={`${label}:${id}`} label={project?.name ?? `Project ${id}`} onClick={() => onOpen(id)} size="small" variant="outlined" /> })}</Stack></Stack>
}

function formatFetchedAt(timestamp?: number): string {
  if (!timestamp) return '時刻不明'
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
