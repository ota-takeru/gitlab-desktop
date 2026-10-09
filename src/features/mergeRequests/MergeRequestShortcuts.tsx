import BookmarkBorderRoundedIcon from '@mui/icons-material/BookmarkBorderRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'
import { ListRow } from '../../components/ListRow'
import { MergeRequestStateIcon } from '../../components/MergeRequestStateIcon'
import { PaneEmpty, PaneHeader } from '../../components/Pane'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { useConnection } from '../connections/ConnectionProvider'
import { usePersonalWorkspace, type MrRef } from '../shared/personalWorkspace'
import { useGitLabQuery } from '../shared/useGitLabQuery'

export function MergeRequestShortcuts({ kind, onOpen, selected = null }: { kind: 'pinned' | 'recent'; onOpen: (ref: MrRef) => void; selected?: MrRef | null }) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const refs = workspace[kind]
  const [requestedPage, setPage] = useState(1)
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(refs.length / 10)))
  const visible = refs.slice((page - 1) * 10, page * 10)
  return <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    <PaneHeader subtitle={kind === 'pinned' ? 'よく確認するMRをこの端末に固定しています' : 'この端末で最近開いたMR'} title={kind === 'pinned' ? '固定したMR' : '最近開いたMR'} />
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {!session ? <Alert severity="info" sx={{ m: 1.5 }}>接続設定でGitLabに接続してください。</Alert> : null}
      {refs.length === 0 ? <PaneEmpty description={kind === 'pinned' ? 'MR一覧や詳細の星ボタンで固定できます。' : 'MRを開くと、ここに履歴を表示します。'} icon={kind === 'pinned' ? <BookmarkBorderRoundedIcon fontSize="inherit" /> : <HistoryRoundedIcon fontSize="inherit" />} title={kind === 'pinned' ? '固定したMRはありません' : '履歴はありません'} />
        : <Box component="ul" sx={{ m: 0, p: 0 }}>{visible.map((ref) => <ShortcutRow key={`${ref.projectId}:${ref.iid}`} mrRef={ref} onOpen={onOpen} selected={selected?.projectId === ref.projectId && selected.iid === ref.iid} />)}</Box>}
    </Box>
    {refs.length > 10 ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager hasNext={page * 10 < refs.length} hasPrevious={page > 1} onNext={() => setPage(page + 1)} onPrevious={() => setPage(page - 1)} page={page} /></Box> : null}
  </Box>
}

function ShortcutRow({ mrRef, onOpen, selected }: { mrRef: MrRef; onOpen: (ref: MrRef) => void; selected: boolean }) {
  const { session } = useConnection()
  const query = useMemo(() => session ? ({ kind: 'mr' as const, ...mrRef }) : null, [mrRef, session])
  const result = useGitLabQuery(session?.id ?? null, query)
  const mergeRequest = result.data
  return <ListRow disabled={!session || Boolean(result.error && !mergeRequest)} leading={mergeRequest ? <MergeRequestStateIcon state={mergeRequest.state} /> : undefined} onOpen={() => onOpen(mrRef)} selected={selected}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
      <Typography color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{mergeRequest?.projectPath ?? `プロジェクト ${mrRef.projectId}`} !{mrRef.iid}</Typography>
      {mergeRequest ? <RelativeTime value={mergeRequest.updatedAt} /> : null}
    </Stack>
    <Typography sx={{ display: '-webkit-box', fontWeight: 500, mt: 0.25, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{mergeRequest?.title ?? (result.loading ? '読み込み中…' : `プロジェクト ${mrRef.projectId} !${mrRef.iid}`)}</Typography>
    {result.error ? <Typography color="error.main" component="div" variant="caption">{result.error.message}</Typography> : mergeRequest ? <Typography color="text.secondary" component="div" variant="caption">{mergeRequest.author.name}</Typography> : null}
  </ListRow>
}
