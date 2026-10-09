import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'
import { ListRow } from '../../components/ListRow'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { useConnection } from '../connections/ConnectionProvider'
import type { MrRef } from '../shared/personalWorkspace'
import { useGitLabQuery } from '../shared/useGitLabQuery'

const actionLabels: Record<string, string> = { assigned: '担当依頼', mentioned: 'メンション', directly_addressed: '直接メンション', approval_required: '承認依頼', marked: 'To-Do', build_failed: 'CI失敗', unmergeable: 'マージ不可', merge_train_removed: 'マージトレイン解除', review_requested: 'レビュー依頼' }

export function TodoView({ onOpen, selected = null }: { onOpen: (ref: MrRef) => void; selected?: MrRef | null }) {
  const { session } = useConnection()
  const [page, setPage] = useState(1)
  const query = useMemo(() => session ? ({ kind: 'todos' as const, page }) : null, [page, session])
  const result = useGitLabQuery(session?.id ?? null, query)
  return <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    <PaneHeader actions={<Tooltip title="更新"><span><IconButton aria-label="更新" disabled={!session || result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>} subtitle="GitLabの未完了To-DoにあるMRへのメンション・承認依頼など" title="To-Do" />
    {result.data ? <PaneStatus>{result.data.length}件{page > 1 || result.snapshot?.nextPage != null ? ` · ページ ${page}` : ''}{result.stale ? ' · 保存済みのTo-Doを表示中' : result.refreshing ? ' · 更新中…' : ''}</PaneStatus> : null}
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {!session ? <Alert severity="info" sx={{ m: 1.5 }}>接続設定でGitLabに接続してください。</Alert> : null}
      {result.loading ? <Typography color="text.secondary" role="status" sx={{ display: 'block', p: 1.5 }} variant="caption">To-Doを読み込み中…</Typography> : null}
      {result.error ? <Alert severity={result.data ? 'warning' : 'error'} sx={{ m: 1.5 }}>{result.error.message}</Alert> : null}
      {result.data && result.data.length === 0 ? <PaneEmpty description="このページに未完了のMR To-Doはありません。" icon={<InboxOutlinedIcon fontSize="inherit" />} title="To-Doはありません" /> : null}
      {result.data?.length ? <Box component="ul" sx={{ m: 0, p: 0 }}>{result.data.map((todo) => <ListRow key={todo.id} onOpen={() => onOpen(todo)} selected={selected?.projectId === todo.projectId && selected.iid === todo.iid}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
          <Typography color="primary" sx={{ flexShrink: 0, fontWeight: 600 }} variant="caption">{actionLabels[todo.actionName] ?? 'To-Do'}</Typography>
          <Typography color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{todo.projectName} !{todo.iid} · @{todo.author.username}</Typography>
          <RelativeTime value={todo.createdAt} />
        </Stack>
        <Typography sx={{ display: '-webkit-box', fontWeight: 500, mt: 0.25, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{todo.title}</Typography>
      </ListRow>)}</Box> : null}
    </Box>
    {session && (page > 1 || result.snapshot?.nextPage != null) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager disabled={result.refreshing} hasNext={result.snapshot?.nextPage != null} hasPrevious={page > 1} onNext={() => setPage(result.snapshot!.nextPage!)} onPrevious={() => setPage((value) => value - 1)} page={page} /></Box> : null}
  </Box>
}
