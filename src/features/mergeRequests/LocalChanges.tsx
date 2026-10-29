import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { RelativeTime } from '../../components/RelativeTime'
import { delayedRevealSx } from '../../components/paneSx'
import { shortSha } from '../../lib/format'
import { findLocalRepository, findOwnLocalRepositories, getLocalChanges, getLocalFile, getLocalRepository, getLocalScanFolders, getLocalStatus, linkLocalRepository, pickLocalRepositoryFolder, setLocalScanFolders, summarizeLocalStatus, unlinkLocalRepository, type LocalRepository, type OwnProjectSearch } from '../../lib/localRepository'
import { normalizeGitLabError } from '../../lib/gitlab'
import { DiffViewer } from './DiffViewer'
import { useT } from '../../i18n/useT'

const NO_COMMENT = () => undefined
const codeSx = { color: 'text.primary', fontFamily: 'code.fontFamily' } as const

/** Runs `onFocus` when the window regains focus, as after editing in another app. */
function useWindowFocus(onFocus: () => void) {
  const latest = useRef(onFocus)
  useEffect(() => { latest.current = onFocus })
  useEffect(() => {
    const handle = () => latest.current()
    window.addEventListener('focus', handle)
    return () => window.removeEventListener('focus', handle)
  }, [])
}

/**
 * The project's linked clone. When none is linked, the clone is looked for
 * below the user's scan folders and linked by the native side when found.
 */
function useLinkedRepository(sessionId: string, projectId: string, projectPath: string | null) {
  const client = useQueryClient()
  const repositoryKey = ['localRepository', sessionId, projectId]
  const repository = useQuery({ queryFn: () => getLocalRepository(sessionId, projectId), queryKey: repositoryKey, staleTime: Infinity })
  const foundKey = ['localRepositoryFind', sessionId, projectId, projectPath]
  const search = async (explicit: boolean) => {
    const next = await findLocalRepository(sessionId, projectId, projectPath ?? '', explicit)
    if (next.repository) client.setQueryData(repositoryKey, next.repository)
    return next
  }
  const found = useQuery({
    enabled: repository.data === null && Boolean(projectPath),
    queryFn: () => search(false),
    queryKey: foundKey,
    staleTime: 60_000,
  })
  // Asked for by the user, so a project they unlinked is searched for too.
  const searchNow = () => client.fetchQuery({ queryFn: () => search(true), queryKey: foundKey, staleTime: 0 }).catch(() => undefined)
  return { found, foundKey, linked: repository.data ?? null, repository, repositoryKey, searchNow }
}

/**
 * The clone's state for the 「ローカルの変更」 button, read when the MR opens and
 * whenever the window regains focus, so local work is noticed without opening
 * the view. Nothing is shown when no clone is linked or found.
 */
export function LocalStatusBadge({ headSha, projectId, projectPath, sessionId, sourceBranch }: { headSha: string; projectId: string; projectPath: string | null; sessionId: string; sourceBranch?: string }) {
  const t = useT()
  const { found, linked, repository } = useLinkedRepository(sessionId, projectId, projectPath)
  const status = useQuery({ enabled: Boolean(linked), queryFn: () => getLocalStatus(sessionId, projectId, headSha), queryKey: ['localStatus', sessionId, projectId, headSha, linked?.path], staleTime: 0 })
  useWindowFocus(() => {
    if (linked) void status.refetch()
    else if (repository.data === null && projectPath) void found.refetch()
  })
  if (!linked) return null
  const summary = status.data ? summarizeLocalStatus(status.data, sourceBranch) : status.error ? { label: t('review.local.unreadable'), tone: 'warning' as const } : null
  if (!summary) return null
  return <Box component="span" sx={{ bgcolor: summary.tone === 'quiet' ? 'transparent' : 'action.selected', borderRadius: 2, color: summary.tone === 'changes' ? 'text.primary' : summary.tone === 'warning' ? 'warning.main' : 'text.secondary', fontSize: 'caption.fontSize', fontWeight: 400, ml: 1, px: summary.tone === 'quiet' ? 0 : 0.75, whiteSpace: 'nowrap' }}>{summary.label}</Box>
}

/**
 * The MR's changes as they are in the user's own clone: its working tree
 * (unpushed commits, uncommitted edits and untracked files) against the MR head. Read-only:
 * nothing here comments, marks files reviewed, fetches or changes the clone.
 */
export function LocalChanges({ headSha, onSelectFile, projectId, projectPath, selectedFile, sessionId, userId }: { headSha: string; onSelectFile: (path: string) => void; projectId: string; projectPath: string | null; selectedFile: string | null; sessionId: string; userId: string }) {
  const t = useT()
  const client = useQueryClient()
  const { found, foundKey, linked, repository, repositoryKey, searchNow } = useLinkedRepository(sessionId, projectId, projectPath)
  // The working tree changes outside the app, so it is read again each time the view opens
  // and when the window regains focus.
  const changes = useQuery({ enabled: Boolean(linked), gcTime: 0, queryFn: () => getLocalChanges(sessionId, projectId, headSha), queryKey: ['localChanges', sessionId, projectId, headSha, linked?.path], staleTime: 0 })
  useWindowFocus(() => { if (linked && !changes.isFetching) void changes.refetch() })
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)
  const [viewChoice, setViewChoice] = useState<{ path: string; view: 'diff' | 'file' } | null>(null)
  // Linking or unlinking replaces the focused control, so focus moves to its
  // counterpart as soon as that mounts.
  const focusAfter = useRef<'linked' | 'unlinked' | null>(null)
  const focusOnMount = (target: 'linked' | 'unlinked') => (node: HTMLElement | null) => {
    if (node && focusAfter.current === target) {
      node.focus()
      focusAfter.current = null
    }
  }
  // The shown file as it is now, for the whole-file view and for opening the lines between hunks.
  const shown = changes.data?.diffs.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? changes.data?.diffs[0]
  const readable = Boolean(shown && !shown.deletedFile && !shown.tooLarge)
  const shownPath = shown ? (shown.newPath || shown.oldPath) : ''
  const view = viewChoice?.path === shownPath ? viewChoice.view : 'diff'
  const file = useQuery({ enabled: readable, gcTime: 0, queryFn: () => getLocalFile(sessionId, projectId, shown?.newPath ?? ''), queryKey: ['localFile', sessionId, projectId, shown?.newPath, changes.dataUpdatedAt], staleTime: 0 })

  if (repository.isPending) return <Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, py: 2 }} variant="body2">{t('review.local.checkingLink')}</Typography>
  if (repository.error) return <Alert severity="error">{t('review.local.linkReadError', { message: normalizeGitLabError(repository.error).message })}</Alert>
  if (!linked) return <LinkRepository fieldRef={focusOnMount('unlinked')} onLinked={(next) => { focusAfter.current = 'linked'; client.setQueryData(repositoryKey, next) }} projectId={projectId} projectPath={projectPath} search={{ declined: Boolean(found.data?.declined), error: found.error ? normalizeGitLabError(found.error).message : null, notFound: found.data?.repository === null && !found.isFetching, onSearch: () => void searchNow(), searchedAt: found.dataUpdatedAt, searching: found.isFetching }} sessionId={sessionId} userId={userId} />

  const unlink = async () => {
    setUnlinking(true)
    setUnlinkError(null)
    try {
      await unlinkLocalRepository(sessionId, projectId)
      focusAfter.current = 'unlinked'
      // The native side no longer links this project from the scan folders.
      client.setQueryData(foundKey, { declined: true, repository: null })
      client.setQueryData(repositoryKey, null)
    } catch (error) {
      setUnlinkError(normalizeGitLabError(error).message)
    } finally {
      setUnlinking(false)
    }
  }
  const data = changes.data
  const error = changes.error ? normalizeGitLabError(changes.error) : null
  // Facts about the clone, on one line so the diff starts close to the comparison targets.
  const facts = data ? [
    <>{t('review.local.branch')} <Box component="span" sx={codeSx}>{data.branch ?? t('review.local.detachedHead')}</Box></>,
    data.localHead ? <>HEAD <Box component="span" sx={codeSx}>{shortSha(data.localHead)}</Box></> : null,
    data.containsMrHead && data.aheadCount ? t('review.local.ahead', { count: data.aheadCount }) : null,
    data.untrackedIncluded ? t('review.local.untrackedIncluded', { count: data.untrackedIncluded }) : null,
  ].filter(Boolean) : []
  // The same facts as text, for the tooltip when the line is cut off.
  const factsText = data ? [
    `${t('review.local.branch')} ${data.branch ?? t('review.local.detachedHead')}`,
    data.localHead ? `HEAD ${shortSha(data.localHead)}` : null,
    data.containsMrHead && data.aheadCount ? t('review.local.ahead', { count: data.aheadCount }) : null,
    data.untrackedIncluded ? t('review.local.untrackedIncluded', { count: data.untrackedIncluded }) : null,
  ].filter(Boolean).join(' · ') : ''
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Tooltip title={linked.path}><Typography color="textSecondary" noWrap sx={{ flex: '0 1 auto', minWidth: 48 }} variant="caption"><Box component="span" sx={codeSx}>{linked.path}</Box></Typography></Tooltip>
        <Tooltip title={factsText}><Typography color="textSecondary" noWrap sx={{ flex: '1 1 auto', minWidth: 0 }} variant="caption">{facts.map((fact, index) => <span key={index}>{index ? ' · ' : ''}{fact}</span>)}</Typography></Tooltip>
        {changes.isFetching && data ? <Typography color="textSecondary" role="status" sx={{ flexShrink: 0 }} variant="caption">{t('review.local.reloading')}</Typography> : changes.dataUpdatedAt && data ? <Box sx={{ flexShrink: 0 }}><RelativeTime prefix={t('review.local.readAt')} value={new Date(changes.dataUpdatedAt).toISOString()} /></Box> : null}
        <Tooltip title={t('review.local.reloadTooltip')}><span><IconButton aria-disabled={changes.isFetching} aria-label={t('review.local.reload')} onClick={() => { if (!changes.isFetching) void changes.refetch() }} ref={focusOnMount('linked')}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        <Button disabled={unlinking} onClick={() => void unlink()} size="small" sx={{ flexShrink: 0 }}>{t('review.local.unlink')}</Button>
      </Stack>
      {unlinkError ? <Alert severity="error">{t('review.local.unlinkError', { message: unlinkError })}</Alert> : null}
      {error && !data ? <Alert severity="error">{t('review.local.readError', { message: error.message })}</Alert> : null}
      {error && data ? <Alert severity="warning">{t('review.local.staleError', { message: error.message })}</Alert> : null}
      {changes.isPending && !error ? <Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, py: 2 }} variant="body2">{t('review.local.loading')}</Typography> : null}
      {data && !data.containsMrHead ? <Alert severity="warning">{t('review.local.missingMrHead', { sha: shortSha(data.comparedSha) })}</Alert> : null}
      {data?.truncated ? <Alert severity="warning">{t('review.local.truncated')}</Alert> : null}
      {data && (data.untrackedCount > data.untrackedIncluded || data.untrackedMore) ? <Alert severity="warning">{t(data.untrackedMore ? 'review.local.untrackedOmittedMore' : 'review.local.untrackedOmitted', { count: data.untrackedCount - data.untrackedIncluded })}</Alert> : null}
      {data && !data.diffs.length && !data.truncated ? <Typography color="textSecondary" role="status" variant="body2">{t('review.local.noDiff')}</Typography> : null}
      {data?.diffs.length ? <DiffViewer allowComments={false} diffs={data.diffs} fileContent={readable ? file.data?.content : null} fileLoading={file.isFetching} key={`local:${headSha}`} onComment={NO_COMMENT} onSelectFile={onSelectFile} onViewChange={(next) => setViewChoice({ path: shownPath, view: next })} selectedFile={selectedFile} selectedPosition={undefined} view={view} /> : null}
      {view === 'file' && shown?.deletedFile ? <Typography color="textSecondary" role="status" variant="body2">{t('review.local.fileDeleted')}</Typography> : null}
      {view === 'file' && file.error ? <Alert severity="error">{t('review.local.fileReadError', { message: normalizeGitLabError(file.error).message })}</Alert> : null}
    </Stack>
  )
}

function LinkRepository({ fieldRef, onLinked, projectId, projectPath, search, sessionId, userId }: { fieldRef: (node: HTMLElement | null) => void; onLinked: (repository: LocalRepository) => void; projectId: string; projectPath: string | null; search: ProjectSearch; sessionId: string; userId: string }) {
  const t = useT()
  const [path, setPath] = useState('')
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (folder = path) => {
    if (!projectPath || !folder.trim()) return
    setLinking(true)
    setError(null)
    try {
      onLinked(await linkLocalRepository(sessionId, projectId, projectPath, folder))
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    } finally {
      setLinking(false)
    }
  }
  const pick = async () => {
    setError(null)
    try {
      const folder = await pickLocalRepositoryFolder()
      if (!folder) return
      setPath(folder)
      await submit(folder)
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    }
  }
  return (
    <Stack component="form" onSubmit={(event) => { event.preventDefault(); void submit() }} spacing={1}>
      <Typography variant="body2">{t('review.local.link.description')}</Typography>
      <Typography color="textSecondary" variant="caption">{t('review.local.link.readOnly', { project: projectPath ?? t('review.local.link.thisProject') })}</Typography>
      {projectPath ? null : <Alert severity="warning">{t('review.local.link.noProjectPath')}</Alert>}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField disabled={linking || !projectPath} fullWidth onChange={(event) => setPath(event.target.value)} inputRef={fieldRef} placeholder={'C:\\path\\to\\repository'} size="small" slotProps={{ htmlInput: { 'aria-label': t('review.local.link.folder'), spellCheck: false } }} value={path} />
        <Button disabled={linking || !projectPath} onClick={() => void pick()} sx={{ flexShrink: 0 }} variant="outlined">{t('review.local.link.pick')}</Button>
        <Button disabled={linking || !projectPath || !path.trim()} sx={{ flexShrink: 0 }} type="submit" variant="contained">{linking ? t('review.local.link.checking') : t('review.local.link.submit')}</Button>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <ScanFolders project={projectPath ? { path: projectPath, search } : undefined} sessionId={sessionId} userId={userId} />
    </Stack>
  )
}

/** The search for this MR's project below the scan folders, as last run. */
interface ProjectSearch {
  declined: boolean
  error: string | null
  notFound: boolean
  onSearch: () => void
  /** When the last search ended; 0 before the first. */
  searchedAt: number
  searching: boolean
}

/**
 * The folders where clones are looked for, so projects are linked without
 * choosing each folder. Saving them searches again for this MR's project, and
 * the projects of the user's own open MRs can be searched for at once.
 */
export function ScanFolders({ project, sessionId, userId }: { project?: { path: string; search: ProjectSearch }; sessionId: string; userId: string }) {
  const t = useT()
  const client = useQueryClient()
  const foldersKey = ['localScanFolders', sessionId]
  const folders = useQuery({ queryFn: () => getLocalScanFolders(sessionId), queryKey: foldersKey, staleTime: Infinity })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownSearching, setOwnSearching] = useState(false)
  const [ownResults, setOwnResults] = useState<OwnProjectSearch[] | null>(null)
  const saved = folders.data ?? []
  const save = async (next: string[]) => {
    setSaving(true)
    setError(null)
    try {
      client.setQueryData(foldersKey, await setLocalScanFolders(sessionId, next))
      await client.invalidateQueries({ queryKey: ['localRepositoryFind', sessionId] })
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    } finally {
      setSaving(false)
    }
  }
  const add = async () => {
    setError(null)
    try {
      const folder = await pickLocalRepositoryFolder()
      if (folder) await save([...saved, folder])
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    }
  }
  const searchOwn = async () => {
    setOwnSearching(true)
    setError(null)
    try {
      setOwnResults(await findOwnLocalRepositories(sessionId, userId))
      // Open MRs show the clones linked here without searching again.
      await client.invalidateQueries({ queryKey: ['localRepository', sessionId] })
      await client.invalidateQueries({ queryKey: ['localRepositoryFind', sessionId] })
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    } finally {
      setOwnSearching(false)
    }
  }
  const search = project?.search
  const busy = saving || ownSearching || Boolean(search?.searching)
  const projectStatus = !project || !search ? null
    : search.searching ? t('review.local.scan.searching')
    : search.declined ? t('review.local.scan.declined', { project: project.path })
    : saved.length && search.notFound ? t('review.local.scan.notFound', { project: project.path })
    : null
  return (
    <Stack aria-label={t('review.local.scan.label')} component="section" spacing={0.5} sx={{ pt: 1 }}>
      <Typography variant="body2">{t('review.local.scan.description')}</Typography>
      <Typography color="textSecondary" variant="caption">{t('review.local.scan.readOnly')}</Typography>
      {saved.map((folder) => <Stack direction="row" key={folder} spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Tooltip title={folder}><Typography noWrap sx={{ ...codeSx, flex: '0 1 auto', minWidth: 0 }} variant="caption">{folder}</Typography></Tooltip>
        <Button aria-label={t('review.local.scan.removeLabel', { folder })} disabled={saving} onClick={() => void save(saved.filter((known) => known !== folder))} size="small" sx={{ flexShrink: 0 }}>{t('review.local.scan.remove')}</Button>
      </Stack>)}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Button disabled={saving || folders.isPending} onClick={() => void add()} size="small" sx={{ flexShrink: 0 }} variant="outlined">{t('review.local.scan.add')}</Button>
        {project && search ? <Button disabled={busy || !saved.length} onClick={search.onSearch} size="small" sx={{ flexShrink: 0 }}>{t('review.local.scan.searchProject')}</Button> : null}
        <Button disabled={busy || !saved.length} onClick={() => void searchOwn()} size="small" sx={{ flexShrink: 0 }}>{t('review.local.scan.searchOwn')}</Button>
      </Stack>
      {projectStatus ? <Typography color="textSecondary" role="status" variant="caption">{projectStatus}{!search?.searching && search?.searchedAt ? <> <RelativeTime prefix={t('review.local.scan.searchedAt')} value={new Date(search.searchedAt).toISOString()} /></> : null}</Typography> : null}
      {search?.error ? <Alert severity="error">{t('review.local.scan.searchError', { message: search.error })}</Alert> : null}
      {ownSearching ? <Typography color="textSecondary" role="status" variant="caption">{t('review.local.scan.searchingOwn')}</Typography> : ownResults ? <OwnSearchResults results={ownResults} /> : null}
      {folders.error ? <Alert severity="error">{t('review.local.scan.readError', { message: normalizeGitLabError(folders.error).message })}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  )
}

/** What the search for the projects of the user's own open MRs found, one line per project. */
function OwnSearchResults({ results }: { results: OwnProjectSearch[] }) {
  const t = useT()
  if (!results.length) return <Typography color="textSecondary" role="status" variant="caption">{t('review.local.scan.ownNone')}</Typography>
  const linked = results.filter((item) => item.result?.repository).length
  return (
    <Stack aria-label={t('review.local.scan.ownResults')} component="section" spacing={0.5}>
      <Typography color="textSecondary" role="status" variant="caption">{t('review.local.scan.ownSummary', { count: results.length, linked })}</Typography>
      {results.map((item) => <Typography key={item.projectId} noWrap variant="caption">
        <Box component="span" sx={codeSx}>{item.projectPath}</Box>{' — '}
        <Box component="span" sx={{ color: item.error ? 'error.main' : item.result?.repository ? 'text.primary' : 'text.secondary' }}>
          {item.error ? t('review.local.scan.ownError', { message: item.error })
            : item.result?.repository ? item.result.repository.path
            : item.result?.declined ? t('review.local.scan.ownDeclined')
            : t('review.local.scan.ownNotFound')}
        </Box>
      </Typography>)}
    </Stack>
  )
}
