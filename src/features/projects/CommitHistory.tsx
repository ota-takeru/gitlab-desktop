import CommitRoundedIcon from '@mui/icons-material/CommitRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'

import { hairline } from '../../components/hairline'
import { ListRow } from '../../components/ListRow'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { delayedRevealSx, paneGutter, paneResultsSx } from '../../components/paneSx'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { Row } from '../../components/Row'
import { currentLocale } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { formatFetchedAt, shortSha } from '../../lib/format'
import type { BranchesQuery, Commit, RepositoryCommitsQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import type { MrRef } from '../shared/personalWorkspace'
import { useFocusSearchShortcut } from '../shared/useFocusSearchShortcut'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { BranchSelect } from './BranchSelect'
import { ProjectFetchAlerts } from './ProjectFetchAlerts'

export interface HistoryLocation {
  /** The branch shown; without it, the default branch. */
  ref?: string
  /** The folder or file the commits are limited to. */
  path?: string
  /** The commit opened over the list. */
  sha?: string
}

/** The time a commit is listed by; older cached records have only the creation time. */
function commitTime(commit: Commit): string {
  return commit.committedAt ?? commit.createdAt
}

function groupByDay(commits: Commit[]): { label: string; commits: Commit[] }[] {
  const format = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' })
  const groups: { label: string; commits: Commit[] }[] = []
  for (const commit of commits) {
    const time = new Date(commitTime(commit)).getTime()
    const label = Number.isNaN(time) ? '' : format.format(time)
    if (groups.at(-1)?.label === label) groups.at(-1)?.commits.push(commit)
    else groups.push({ commits: [commit], label })
  }
  return groups
}

/**
 * How a project's code changed: its commits by day, for a branch and optionally
 * a path. A commit opens at the pane's full width, with the list kept underneath
 * so returning shows it as it was left.
 */
// The commit's diff view is heavy and the overview shares this module's rows, so the view loads on demand.
const CommitDetail = lazy(() => import('./CommitDetail').then(({ CommitDetail }) => ({ default: CommitDetail })))

export function CommitHistory({ location, navigation, onNavigate, onOpenMergeRequest, projectId, projectName, projectUrl }: { location: HistoryLocation; navigation?: ReactNode; onNavigate: (next: HistoryLocation) => void; onOpenMergeRequest?: (ref: MrRef) => void; projectId: string; projectName: string; projectUrl?: string }) {
  const { session } = useConnection()
  const t = useT()
  const { path, ref, sha } = location
  const inputRef = useRef<HTMLInputElement>(null)
  // A different branch or path starts at its first page.
  const listKey = `${ref ?? ''}\n${path ?? ''}`
  const [paging, setPaging] = useState({ listKey, page: 1 })
  const page = paging.listKey === listKey ? paging.page : 1
  const query = useMemo<RepositoryCommitsQuery>(() => ({ kind: 'repositoryCommits', page, projectId, ...(ref ? { ref } : {}), ...(path ? { path } : {}) }), [page, path, projectId, ref])
  const result = useGitLabQuery(session?.id ?? null, session ? query : null, { keepPrevious: true })
  const branchesQuery = useMemo<BranchesQuery>(() => ({ kind: 'branches', page: 1, projectId, search: '' }), [projectId])
  const branches = useGitLabQuery(session?.id ?? null, session ? branchesQuery : null)

  useFocusSearchShortcut(inputRef)

  if (!session) {
    return <PaneEmpty description={t('project.connect.history')} title={t('project.connect.title')}><Button href="#client/settings" variant="contained">{t('project.connect.openSettings')}</Button></PaneEmpty>
  }

  const commits = result.data ?? []
  const shownIndex = sha ? commits.findIndex((commit) => commit.id === sha) : -1
  const freshness = result.stale ? ` · ${t('project.status.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) })}` : result.refreshing ? ` · ${t('project.status.refreshing')}` : ''
  const hasPages = page > 1 || result.snapshot?.nextPage != null

  return <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    {sha ? <Suspense fallback={<Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, p: 2 }} variant="body2">{t('app.loading')}</Typography>}><CommitDetail
      navigation={navigation}
      newer={shownIndex > 0 ? commits[shownIndex - 1].id : undefined}
      older={shownIndex >= 0 ? commits[shownIndex + 1]?.id : undefined}
      onBack={() => onNavigate({ path, ref })}
      onOpenMergeRequest={onOpenMergeRequest}
      onSelect={(next) => onNavigate({ path, ref, sha: next })}
      projectId={projectId}
      projectName={projectName}
      projectUrl={projectUrl}
      sessionId={session.id}
      sha={sha}
    /></Suspense> : null}
    <Box sx={{ display: sha ? 'none' : 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<Tooltip title={t('project.refresh')}><span><IconButton aria-label={t('project.refresh')} disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>}
        navigation={navigation}
        title={t('project.history.title', { project: projectName })}
      >
        <Row spacing={1} sx={{ minWidth: 0 }}>
          <BranchSelect branches={branches.data} onChange={(next) => onNavigate({ path, ...(next ? { ref: next } : {}) })} value={ref} />
          {/* Remounted with the applied path, so following a link shows that path in the box. */}
          <PathFilter inputRef={inputRef} key={path ?? ''} onApply={(next) => onNavigate({ ref, ...(next ? { path: next } : {}) })} path={path} />
        </Row>
      </PaneHeader>
      <PaneStatus announcement={result.data && !result.previous ? t('project.history.announcement', { count: commits.length, page }) : null}>{result.data && !result.previous ? <>{t('project.status.fetched', { count: commits.length })}{hasPages ? ` · ${t('project.status.page', { page })}` : ''}{freshness}</> : result.loading || result.previous ? t('project.history.loading') : null}</PaneStatus>
      <Box aria-busy={result.previous} sx={paneResultsSx(result.previous)}>
        <ProjectFetchAlerts error={result.error} failed={result.error?.message ?? ''} hasData={Boolean(result.data)} onRetry={result.refresh} refreshFailed={t('project.status.refreshFailed', { message: result.error?.message ?? '' })} />
        {result.data && commits.length === 0 ? <PaneEmpty description={path ? t('project.history.noMatch.description', { path }) : t('project.history.empty.description')} icon={<HistoryRoundedIcon fontSize="inherit" />} title={path ? t('project.history.noMatch.title') : t('project.history.empty.title')}>{path ? <Button onClick={() => onNavigate({ ref })} variant="outlined">{t('project.history.clearPath')}</Button> : null}</PaneEmpty> : null}
        {commits.length ? <Box aria-label={t('project.history.label')} onKeyDown={moveListRowFocus} role="group">
          {groupByDay(commits).map((group) => <Box aria-label={group.label} component="section" key={group.commits[0].id}>
            <Typography color="textSecondary" component="div" sx={{ ...hairline('bottom'), bgcolor: 'background.default', position: 'sticky', px: paneGutter, py: 0.5, top: 0, zIndex: 1 }} variant="caption">{group.label}</Typography>
            <Box component="ul" sx={{ m: 0, p: 0 }}>
              {group.commits.map((commit) => <CommitRow commit={commit} key={commit.id} onOpen={() => onNavigate({ path, ref, sha: commit.id })} />)}
            </Box>
          </Box>)}
        </Box> : null}
      </Box>
      {result.data && hasPages ? <Box sx={{ ...hairline('top'), px: 1, py: 0.5 }}><Pager disabled={result.refreshing} hasNext={result.snapshot?.nextPage != null} hasPrevious={page > 1} onNext={() => setPaging({ listKey, page: result.snapshot?.nextPage ?? page + 1 })} onPrevious={() => setPaging({ listKey, page: Math.max(1, page - 1) })} page={page} /></Box> : null}
    </Box>
  </Box>
}

function PathFilter({ inputRef, onApply, path }: { inputRef: React.RefObject<HTMLInputElement | null>; onApply: (path: string) => void; path?: string }) {
  const t = useT()
  const [draft, setDraft] = useState(path ?? '')
  return <Box component="form" onSubmit={(event) => { event.preventDefault(); onApply(draft.trim().replace(/^\/+|\/+$/gu, '')) }} sx={{ flex: 1, minWidth: 0 }}>
    <TextField
      fullWidth
      inputRef={inputRef}
      onChange={(event) => setDraft(event.target.value)}
      placeholder={t('project.history.pathPlaceholder')}
      slotProps={{
        htmlInput: { 'aria-label': t('project.history.pathLabel') },
        input: { endAdornment: <InputAdornment position="end"><Tooltip title={t('project.search.submitTooltip')}><IconButton aria-label={t('project.search.submit')} edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment> },
      }}
      value={draft}
    />
  </Box>
}

export function CommitRow({ commit, onOpen }: { commit: Commit; onOpen: () => void }) {
  const t = useT()
  return <ListRow leading={<CommitRoundedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />} onOpen={onOpen}>
    <Row spacing={1} sx={{ minWidth: 0 }}>
      <Tooltip enterDelay={600} title={commit.title}><Typography noWrap sx={{ flexShrink: 1, fontWeight: 600, minWidth: 0 }} variant="body2">{commit.title || t('review.blame.noMessage')}</Typography></Tooltip>
      <RelativeTime value={commitTime(commit)} />
    </Row>
    <Typography color="textSecondary" component="div" noWrap variant="caption"><Box component="span" sx={{ fontFamily: 'code.fontFamily', verticalAlign: 'top' }}>{shortSha(commit.id)}</Box> · {commit.authorName || t('review.blame.unknownAuthor')}</Typography>
  </ListRow>
}
