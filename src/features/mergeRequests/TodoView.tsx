import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState, type ReactNode } from 'react'
import { ListRow } from '../../components/ListRow'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { Pager } from '../../components/Pager'
import { RelativeTime } from '../../components/RelativeTime'
import { StatusPill, type StatusTone } from '../../components/StatusPill'
import { formatFetchedAt } from '../../lib/format'
import { useConnection } from '../connections/ConnectionProvider'
import type { MrRef } from '../shared/personalWorkspace'
import { useGitLabQuery } from '../shared/useGitLabQuery'

const actionLabels: Record<string, string> = { assigned: '担当依頼', mentioned: 'メンション', directly_addressed: '直接メンション', approval_required: '承認依頼', marked: 'To-Do', build_failed: 'CI失敗', unmergeable: 'マージ不可', merge_train_removed: 'マージトレイン解除', review_requested: 'レビュー依頼' }
// What blocks the MR stands out from requests and mentions.
const actionTones: Record<string, StatusTone> = { build_failed: 'error', unmergeable: 'error', merge_train_removed: 'warning' }

export function TodoView({ navigation, onOpen, selected = null }: { navigation?: ReactNode; onOpen: (ref: MrRef) => void; selected?: MrRef | null }) {
  const { session } = useConnection()
  const [page, setPage] = useState(1)
  const query = useMemo(() => session ? ({ kind: 'todos' as const, page }) : null, [page, session])
  const result = useGitLabQuery(session?.id ?? null, query)
  return <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    <PaneHeader navigation={navigation} actions={<Tooltip title="更新"><span><IconButton aria-label="更新" disabled={!session || result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>} subtitle="GitLabの未完了To-DoにあるMRへのメンション・承認依頼など" title="To-Do" />
    <PaneStatus announcement={result.data ? `To-Do ${result.data.length}件（ページ ${page}）` : null}>{result.data ? <>{result.data.length}件取得{page > 1 || result.snapshot?.nextPage != null ? ` · ページ ${page}` : ''}{result.stale ? ` · 保存済み · ${formatFetchedAt(result.snapshot?.fetchedAt)}` : result.refreshing ? ' · 更新中…' : ''}</> : result.loading ? 'To-Doを読み込み中…' : null}</PaneStatus>
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {!session ? <Alert severity="info" sx={{ m: 1.5 }}>設定でGitLabに接続してください。</Alert> : null}
      {result.error ? <Alert action={<Button color="inherit" onClick={result.refresh}>再試行</Button>} severity={result.data ? 'warning' : 'error'} sx={{ m: 1.5 }}>{result.data ? `保存済みのTo-Doを表示中です。更新に失敗しました: ${result.error.message}` : result.error.message}</Alert> : null}
      {result.data && result.data.length === 0 ? <PaneEmpty description="このページに未完了のMR To-Doはありません。" icon={<InboxOutlinedIcon fontSize="inherit" />} title="To-Doはありません" /> : null}
      {result.data?.length ? <Box aria-label="To-Do" component="ul" onKeyDown={moveListRowFocus} sx={{ m: 0, p: 0 }}>{result.data.map((todo) => <ListRow key={todo.id} mrId={`${todo.projectId}-${todo.iid}`} onOpen={() => onOpen(todo)} selected={selected?.projectId === todo.projectId && selected.iid === todo.iid}>
        {/* The same three lines as an MR list row: where and when, the title, then what it asks and from whom. */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
          <Tooltip title={`${todo.projectName} !${todo.iid}`}><Typography color="textSecondary" noWrap sx={{ minWidth: 0 }} variant="caption">{todo.projectName} !{todo.iid}</Typography></Tooltip>
          <Typography aria-hidden color="textSecondary" variant="caption">·</Typography>
          {/* When the To-Do arrived, not when the MR changed. */}
          <RelativeTime prefix="受信" value={todo.createdAt} />
        </Stack>
        <Typography sx={{ display: '-webkit-box', mt: 0.25, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="subtitle1">{todo.title}</Typography>
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, flexWrap: 'wrap', minWidth: 0, mt: 0.5, rowGap: 0.25 }}>
          <StatusPill label={actionLabels[todo.actionName] ?? 'To-Do'} tone={actionTones[todo.actionName] ?? 'info'} />
          <Typography sx={{ fontWeight: 500 }} variant="caption">{todo.author.name}</Typography>
        </Stack>
      </ListRow>)}</Box> : null}
    </Box>
    {session && (page > 1 || result.snapshot?.nextPage != null) ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.5 }}><Pager disabled={result.refreshing} hasNext={result.snapshot?.nextPage != null} hasPrevious={page > 1} onNext={() => setPage(result.snapshot!.nextPage!)} onPrevious={() => setPage((value) => value - 1)} page={page} /></Box> : null}
  </Box>
}
