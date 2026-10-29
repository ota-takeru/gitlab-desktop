import AltRouteRoundedIcon from '@mui/icons-material/AltRouteRounded'
import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { hairline } from '../../components/hairline'
import { ListRow } from '../../components/ListRow'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { paneResultsSx } from '../../components/paneSx'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { StateIcon } from '../../components/StateIcon'
import { useT } from '../../i18n/useT'
import { formatFetchedAt } from '../../lib/format'
import { normalizeGitLabError, openGitLabUrl } from '../../lib/gitlab'
import type { BranchesQuery, GitLabBranch } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { useRememberedListState } from './listState'

/**
 * Branches of one project, recently updated first. A row shows the MRs whose
 * source is that branch; opening the branch on GitLab is a row action.
 */
export function BranchList({ navigation, onShowMergeRequests, projectId, projectName }: { navigation?: ReactNode; onShowMergeRequests: (branch: string) => void; projectId: string; projectName: string }) {
  const { session } = useConnection()
  const t = useT()
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Kept per project for the session, so returning from a branch's MRs shows the list as it was left.
  const [conditions, setConditions] = useRememberedListState(`${session?.instanceUrl ?? 'anonymous'}:${session?.user.id ?? 'anonymous'}:branches:${projectId}`, { page: 1, search: '', searchInput: '' })
  const { page, search, searchInput } = conditions
  const [openError, setOpenError] = useState<string | null>(null)
  const query = useMemo<BranchesQuery>(() => ({ kind: 'branches', page, projectId, search }), [page, projectId, search])
  const result = useGitLabQuery(session?.id ?? null, session ? query : null, { keepPrevious: true })

  useEffect(() => {
    const focus = () => searchInputRef.current?.focus()
    globalThis.addEventListener('gitlab-focus-project-search', focus)
    return () => globalThis.removeEventListener('gitlab-focus-project-search', focus)
  }, [])

  const openInGitLab = async (url: string) => {
    if (!session) return
    try {
      await openGitLabUrl(session.id, url)
      setOpenError(null)
    } catch (error) {
      setOpenError(normalizeGitLabError(error).message)
    }
  }

  if (!session) {
    return <PaneEmpty description={t('project.connect.branches')} title={t('project.connect.title')}><Button href="#client/settings" variant="contained">{t('project.connect.openSettings')}</Button></PaneEmpty>
  }

  const freshness = result.stale ? ` · ${t('project.status.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) })}` : result.refreshing ? ` · ${t('project.status.refreshing')}` : ''
  const clearSearch = () => setConditions({ page: 1, search: '', searchInput: '' })
  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<Tooltip title={t('project.refresh')}><span><IconButton aria-label={t('project.refresh')} disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>}
        navigation={navigation}
        subtitle={t('project.branches.subtitle')}
        title={t('project.branches.title', { project: projectName })}
      >
        <Box component="form" onSubmit={(event) => { event.preventDefault(); setConditions({ page: 1, search: searchInput.trim() }) }}>
          <TextField
            fullWidth
            inputRef={searchInputRef}
            onChange={(event) => setConditions({ searchInput: event.target.value })}
            placeholder={t('project.branches.searchPlaceholder')}
            slotProps={{
              htmlInput: { 'aria-label': t('project.branches.searchLabel') },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title={t('project.search.submitTooltip')}><IconButton aria-label={t('project.search.submit')} edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            value={searchInput}
          />
        </Box>
      </PaneHeader>
      <PaneStatus announcement={result.data && !result.previous ? t('project.branches.announcement', { count: result.data.length, page }) : null}>{result.data && !result.previous ? <>{t('project.status.fetched', { count: result.data.length })}{page > 1 || result.snapshot?.nextPage != null ? ` · ${t('project.status.page', { page })}` : ''}{freshness}</> : result.loading || result.previous ? t('project.branches.loading') : null}</PaneStatus>
      <Box aria-busy={result.previous} sx={paneResultsSx(result.previous)}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('project.retry')}</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('project.retry')}</Button>} severity="warning" sx={{ m: 1.5 }}>{t('project.status.refreshFailed', { message: result.error.message })}</Alert> : null}
        {openError ? <Alert onClose={() => setOpenError(null)} severity="error" sx={{ m: 1.5 }}>{t('project.branches.openFailed', { message: openError })}</Alert> : null}
        {result.data && result.data.length === 0 ? <PaneEmpty description={search ? t('project.branches.appliedSearch', { search }) : t('project.branches.empty.description')} icon={<AltRouteRoundedIcon fontSize="inherit" />} title={search ? t('project.branches.noMatch.title') : t('project.branches.empty.title')}>{search ? <Button onClick={clearSearch} variant="outlined">{t('project.branches.clearSearch')}</Button> : null}</PaneEmpty> : null}
        {result.data?.length ? <Box aria-label={t('project.branches.label')} component="ul" onKeyDown={moveListRowFocus} sx={{ m: 0, p: 0 }}>{result.data.map((branch) => <BranchRow branch={branch} key={branch.name} onOpenInGitLab={openInGitLab} onShowMergeRequests={onShowMergeRequests} />)}</Box> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage != null) ? <Box sx={{ ...hairline('top'), px: 1, py: 0.5 }}><Pager disabled={result.refreshing} hasNext={result.snapshot?.nextPage != null} hasPrevious={page > 1} onNext={() => setConditions({ page: result.snapshot!.nextPage! })} onPrevious={() => setConditions({ page: Math.max(1, page - 1) })} page={page} /></Box> : null}
    </Box>
  )
}

function BranchRow({ branch, onOpenInGitLab, onShowMergeRequests }: { branch: GitLabBranch; onOpenInGitLab: (url: string) => Promise<void>; onShowMergeRequests: (branch: string) => void }) {
  const t = useT()
  const actions = branch.webUrl ? <Tooltip title={t('project.branches.openInGitLab')}><IconButton aria-label={t('project.branches.openNamedInGitLab', { branch: branch.name })} onClick={() => void onOpenInGitLab(branch.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : undefined
  return <ListRow actions={actions} ariaLabel={t('project.branches.showMergeRequests', { branch: branch.name })} leading={<AltRouteRoundedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />} onOpen={() => onShowMergeRequests(branch.name)}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      {/* The name takes only its own width, so its marks and time follow it instead of the row's far edge. */}
      <Tooltip enterDelay={600} title={branch.name}><Typography noWrap sx={{ flexShrink: 1, fontFamily: 'code.fontFamily', fontWeight: 600, minWidth: 0 }} variant="body2">{branch.name}</Typography></Tooltip>
      {branch.default ? <StateIcon icon={<HomeRoundedIcon fontSize="inherit" />} label={t('project.branches.default')} tone="info" /> : null}
      {branch.protected ? <StateIcon icon={<LockRoundedIcon fontSize="inherit" />} label={t('project.branches.protected')} tone="warning" /> : null}
      {branch.merged ? <StateIcon icon={<CallMergeRoundedIcon fontSize="inherit" />} label={t('project.branches.merged')} tone="secondary" /> : null}
      {branch.commit?.committedDate ? <RelativeTime value={branch.commit.committedDate} /> : null}
    </Stack>
    {branch.commit ? <Typography color="textSecondary" component="div" noWrap title={`${branch.commit.shortId} ${branch.commit.title}${branch.commit.authorName ? ` · ${branch.commit.authorName}` : ''}`} variant="caption">
      <Box component="span" sx={{ fontFamily: 'code.fontFamily', verticalAlign: 'top' }}>{branch.commit.shortId}</Box> {branch.commit.title}{branch.commit.authorName ? ` · ${branch.commit.authorName}` : ''}
    </Typography> : null}
  </ListRow>
}
