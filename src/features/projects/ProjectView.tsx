import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded'
import BookmarkRoundedIcon from '@mui/icons-material/BookmarkRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState } from '../../components/EmptyState'
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
    return <EmptyState description="GitLab URLとPATで接続すると、参加プロジェクトを検索できます。" title="プロジェクトを表示できません" />
  }

  return (
    <Box component="main" sx={{ minHeight: '100%', maxWidth: 1120, mx: 'auto' }}>
      <Stack spacing={2}>
        <Stack direction={{ md: 'row', xs: 'column' }} spacing={1.5} sx={{ alignItems: { md: 'end' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography color="primary.main" variant="overline">Projects</Typography>
            <Typography component="h1" variant="h1">プロジェクト</Typography>
            <Typography color="text.secondary" variant="body2">参加中または閲覧可能なプロジェクトを探し、固定したプロジェクトからレビューを始めます。</Typography>
          </Box>
          <Button disabled={result.loading || result.refreshing} onClick={result.refresh} size="small" startIcon={<RefreshRoundedIcon />} variant="outlined">
            更新
          </Button>
        </Stack>

        <Paper component="form" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1) }} sx={{ p: 1.5 }} variant="outlined">
          <Stack direction={{ md: 'row', xs: 'column' }} spacing={1.25} sx={{ alignItems: { md: 'center' } }}>
            <TextField
              fullWidth
              label="プロジェクトを検索"
              inputRef={searchInputRef}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="名前またはnamespace"
              slotProps={{ htmlInput: { 'aria-label': 'プロジェクトを検索' }, input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> } }}
              value={searchInput}
            />
            <Button startIcon={<SearchRoundedIcon />} sx={{ minWidth: 112 }} type="submit" variant="contained">検索</Button>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 185 }}>
              <Switch checked={includeArchived} slotProps={{ input: { 'aria-label': 'アーカイブ済みを含める' } }} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(1) }} size="small" />
              <Typography variant="body2">アーカイブ済み</Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 185 }}>
              <Switch checked={membershipOnly} slotProps={{ input: { 'aria-label': '参加中のプロジェクトだけ' } }} onChange={(event) => { setMembershipOnly(event.target.checked); setPage(1) }} size="small" />
              <Typography variant="body2">参加中のみ</Typography>
            </Stack>
          </Stack>
        </Paper>

        {pinned.length > 0 || recent.length > 0 ? <ProjectShortcuts ids={pinned} label="固定" onOpen={openProjectId} projectById={projectById} secondaryIds={recent} secondaryLabel="最近使ったプロジェクト" /> : null}

        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh} size="small">再試行</Button>} severity="error">{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert severity="warning">保存済みの一覧を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {result.stale && result.data ? <Typography color="text.secondary" variant="caption">保存済みデータを表示中 · {formatFetchedAt(result.snapshot?.fetchedAt)}</Typography> : null}
        {result.loading && !result.data ? <LoadingRows /> : null}
        {!result.loading && !result.data && !result.error ? <EmptyState description="検索条件を変えるか、別のページを取得してください。" title="プロジェクトがありません" /> : null}
        {result.data ? (
          <Paper variant="outlined">
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.5, py: 1 }}>
              <FolderOpenRoundedIcon color="primary" fontSize="small" />
              <Typography sx={{ fontWeight: 700 }} variant="body2">検索結果</Typography>
              <Chip label={`${projects.length}件取得`} size="small" variant="outlined" />
              {result.snapshot?.completeness === 'truncated' ? <Chip color="warning" label="省略あり" size="small" variant="outlined" /> : null}
            </Stack>
            <Divider />
            <List disablePadding>
              {projects.map((project) => {
                const isPinned = pinned.includes(project.id)
                return (
                  <ListItemButton key={project.id} onClick={() => openProject(project)} sx={{ alignItems: 'start', gap: 1, px: 1.5, py: 1.25 }}>
                    <ListItemText
                      primary={<Typography sx={{ fontWeight: 700 }} variant="body2">{project.name}</Typography>}
                      secondary={<Stack spacing={0.25} sx={{ mt: 0.25 }}><Typography color="text.secondary" noWrap variant="caption">{project.pathWithNamespace}</Typography><Typography color="text.secondary" noWrap variant="body2">{project.description || '説明はありません'}</Typography></Stack>}
                    />
                    <Tooltip title={isPinned ? '固定を解除' : 'プロジェクトを固定'}>
                      <IconButton aria-label={isPinned ? `${project.name}の固定を解除` : `${project.name}を固定`} onClick={(event) => { event.stopPropagation(); togglePinned(project.id) }} size="small">
                        {isPinned ? <BookmarkRoundedIcon color="primary" fontSize="small" /> : <BookmarkBorderRoundedIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </ListItemButton>
                )
              })}
              {projects.length === 0 ? <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary" variant="body2">条件に一致するプロジェクトがありません。</Typography></Box> : null}
            </List>
            <Divider />
            <PaginationBar nextPage={result.snapshot?.nextPage ?? null} onNext={() => setPage((current) => current + 1)} onPrevious={() => setPage((current) => Math.max(1, current - 1))} page={page} />
          </Paper>
        ) : null}
      </Stack>
    </Box>
  )
}

function ProjectShortcuts({ ids, label, onOpen, projectById, secondaryIds, secondaryLabel }: { ids: string[]; label: string; onOpen: (projectId: string) => void; projectById: Map<string, Project>; secondaryIds: string[]; secondaryLabel: string }) {
  return <Paper component="section" sx={{ p: 1.25 }} variant="outlined"><Stack spacing={1}><Typography sx={{ fontWeight: 700 }} variant="body2">プロジェクトへのショートカット</Typography><ShortcutGroup ids={ids} label={label} onOpen={onOpen} projectById={projectById} /><ShortcutGroup ids={secondaryIds} label={secondaryLabel} onOpen={onOpen} projectById={projectById} /></Stack></Paper>
}

function ShortcutGroup({ ids, label, onOpen, projectById }: { ids: string[]; label: string; onOpen: (projectId: string) => void; projectById: Map<string, Project> }) {
  if (ids.length === 0) return null
  return <Stack spacing={0.5}><Typography color="text.secondary" variant="caption">{label}</Typography><Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>{ids.map((id) => { const project = projectById.get(id); return <Chip clickable key={`${label}:${id}`} label={project?.name ?? `Project ${id}`} onClick={() => onOpen(id)} size="small" variant="outlined" /> })}</Stack></Stack>
}

function PaginationBar({ nextPage, onNext, onPrevious, page }: { nextPage: number | null; onNext: () => void; onPrevious: () => void; page: number }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end', p: 1 }}>
      <Typography color="text.secondary" sx={{ mr: 'auto' }} variant="caption">ページ {page}</Typography>
      <Button disabled={page <= 1} onClick={onPrevious} size="small">前へ</Button>
      <Button disabled={nextPage === null} onClick={onNext} size="small" variant="outlined">次へ</Button>
    </Stack>
  )
}

function LoadingRows() {
  return <Paper aria-label="プロジェクトを読み込み中" sx={{ p: 2 }} variant="outlined"><Stack spacing={1}><Typography color="text.secondary" variant="body2">プロジェクトを読み込み中…</Typography><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 40 }} /><Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height: 40 }} /></Stack></Paper>
}

function formatFetchedAt(timestamp?: number): string {
  if (!timestamp) return '時刻不明'
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
