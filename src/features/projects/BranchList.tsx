import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ListRow } from '../../components/ListRow'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { normalizeGitLabError, openGitLabUrl } from '../../lib/gitlab'
import type { BranchesQuery, GitLabBranch } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { useGitLabQuery } from '../shared/useGitLabQuery'

/**
 * Branches of one project, recently updated first. A row shows the MRs whose
 * source is that branch; opening the branch on GitLab is a row action.
 */
export function BranchList({ navigation, onShowMergeRequests, projectId, projectName }: { navigation?: ReactNode; onShowMergeRequests: (branch: string) => void; projectId: string; projectName: string }) {
  const { session } = useConnection()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openError, setOpenError] = useState<string | null>(null)
  const query = useMemo<BranchesQuery>(() => ({ kind: 'branches', page, projectId, search }), [page, projectId, search])
  const result = useGitLabQuery(session?.id ?? null, session ? query : null)

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
    return <PaneEmpty description="GitLabに接続すると、プロジェクトのブランチを表示できます。" title="GitLabに接続してください"><Button href="#client/settings" variant="contained">設定を開く</Button></PaneEmpty>
  }

  const freshness = result.stale ? ' · 保存済みの一覧を表示中' : result.refreshing ? ' · 更新中…' : ''
  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<Tooltip title="更新"><span><IconButton aria-label="更新" disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>}
        navigation={navigation}
        subtitle="更新の新しい順。行を選ぶと、そのブランチから作られたMRを表示します"
        title={`${projectName}のブランチ`}
      >
        <Box component="form" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1) }}>
          <TextField
            fullWidth
            inputRef={searchInputRef}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="ブランチ名"
            slotProps={{
              htmlInput: { 'aria-label': 'ブランチを検索' },
              input: {
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><Tooltip title="検索 (Enter)"><IconButton aria-label="検索" edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
              },
            }}
            value={searchInput}
          />
        </Box>
      </PaneHeader>
      <PaneStatus>{result.data ? <>{result.data.length}件取得{page > 1 || result.snapshot?.nextPage != null ? ` · ページ ${page}` : ''}{freshness}</> : result.loading ? 'ブランチを読み込み中…' : null}</PaneStatus>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {result.error && !result.data ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
        {result.error && result.data ? <Alert severity="warning" sx={{ m: 1.5 }}>保存済みの一覧を表示中です。更新に失敗しました: {result.error.message}</Alert> : null}
        {openError ? <Alert onClose={() => setOpenError(null)} severity="error" sx={{ m: 1.5 }}>GitLabで開けませんでした: {openError}</Alert> : null}
        {result.data && result.data.length === 0 ? <PaneEmpty description={search ? '検索語を変えてください。' : 'このプロジェクトにはブランチがありません。'} icon={<AccountTreeOutlinedIcon fontSize="inherit" />} title={search ? '一致するブランチがありません' : 'ブランチはありません'} /> : null}
        {result.data?.length ? <Box aria-label="ブランチ" component="ul" sx={{ m: 0, p: 0 }}>{result.data.map((branch) => <BranchRow branch={branch} key={branch.name} onOpenInGitLab={openInGitLab} onShowMergeRequests={onShowMergeRequests} />)}</Box> : null}
      </Box>
      {result.data && (page > 1 || result.snapshot?.nextPage != null) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager disabled={result.refreshing} hasNext={result.snapshot?.nextPage != null} hasPrevious={page > 1} onNext={() => setPage(result.snapshot!.nextPage!)} onPrevious={() => setPage((value) => Math.max(1, value - 1))} page={page} /></Box> : null}
    </Box>
  )
}

function BranchRow({ branch, onOpenInGitLab, onShowMergeRequests }: { branch: GitLabBranch; onOpenInGitLab: (url: string) => Promise<void>; onShowMergeRequests: (branch: string) => void }) {
  const actions = branch.webUrl ? <Tooltip title="GitLabで開く"><IconButton aria-label={`${branch.name}をGitLabで開く`} onClick={() => void onOpenInGitLab(branch.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : undefined
  return <ListRow actions={actions} ariaLabel={`${branch.name}のMRを表示`} leading={<AccountTreeOutlinedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />} onOpen={() => onShowMergeRequests(branch.name)}>
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Typography noWrap sx={{ flex: 1, fontFamily: 'typography.code.fontFamily', fontWeight: 600, minWidth: 0 }} variant="body2">{branch.name}</Typography>
      {branch.default ? <Chip label="デフォルト" size="small" variant="outlined" /> : null}
      {branch.protected ? <Chip label="保護" size="small" variant="outlined" /> : null}
      {branch.merged ? <Chip label="マージ済み" size="small" variant="outlined" /> : null}
      {branch.commit?.committedDate ? <RelativeTime value={branch.commit.committedDate} /> : null}
    </Stack>
    {branch.commit ? <Typography color="text.secondary" component="div" noWrap sx={{ mt: 0.25 }} variant="caption">
      <Box component="span" sx={{ fontFamily: 'typography.code.fontFamily' }}>{branch.commit.shortId}</Box> {branch.commit.title}{branch.commit.authorName ? ` · ${branch.commit.authorName}` : ''}
    </Typography> : null}
  </ListRow>
}
