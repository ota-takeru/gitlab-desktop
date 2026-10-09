import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import DoNotDisturbOnOutlinedIcon from '@mui/icons-material/DoNotDisturbOnOutlined'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactElement } from 'react'

type Tone = 'success.main' | 'error.main' | 'info.main' | 'warning.main' | 'text.secondary'

const statuses: Record<string, { label: string; tone: Tone; icon: ReactElement }> = {
  success: { label: '成功', tone: 'success.main', icon: <CheckCircleOutlineRoundedIcon fontSize="inherit" /> },
  failed: { label: '失敗', tone: 'error.main', icon: <CancelOutlinedIcon fontSize="inherit" /> },
  running: { label: '実行中', tone: 'info.main', icon: <SyncRoundedIcon fontSize="inherit" /> },
  pending: { label: '待機中', tone: 'info.main', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  created: { label: '待機中', tone: 'info.main', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  preparing: { label: '準備中', tone: 'info.main', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  waiting_for_resource: { label: 'リソース待ち', tone: 'info.main', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  scheduled: { label: '予約済み', tone: 'info.main', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  manual: { label: '手動待ち', tone: 'warning.main', icon: <PauseCircleOutlineRoundedIcon fontSize="inherit" /> },
  canceled: { label: 'キャンセル', tone: 'warning.main', icon: <DoNotDisturbOnOutlinedIcon fontSize="inherit" /> },
  skipped: { label: 'スキップ', tone: 'text.secondary', icon: <DoNotDisturbOnOutlinedIcon fontSize="inherit" /> },
}

/** Pipeline state as icon plus text, so the state never depends on color alone. */
export function PipelineStatus({ status }: { status: string | null }) {
  const known = status ? statuses[status] : undefined
  const label = `CI ${known?.label ?? (status || '状態不明')}`
  return (
    <Stack aria-label={label} component="span" direction="row" role="img" spacing={0.375} sx={{ alignItems: 'center', color: known?.tone ?? 'text.secondary', display: 'inline-flex', fontSize: 15, whiteSpace: 'nowrap' }}>
      {known?.icon ?? <HelpOutlineRoundedIcon fontSize="inherit" />}
      <Typography aria-hidden color="inherit" component="span" variant="caption">{label}</Typography>
    </Stack>
  )
}
