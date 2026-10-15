import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import DoNotDisturbAltRoundedIcon from '@mui/icons-material/DoNotDisturbAltRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import HighlightOffRoundedIcon from '@mui/icons-material/HighlightOffRounded'
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactElement } from 'react'

import { StateIcon } from './StateIcon'

type Tone = 'success' | 'error' | 'info' | 'warning' | 'neutral'

const statuses: Record<string, { label: string; tone: Tone; icon: ReactElement }> = {
  success: { label: '成功', tone: 'success', icon: <CheckCircleOutlineRoundedIcon fontSize="inherit" /> },
  failed: { label: '失敗', tone: 'error', icon: <HighlightOffRoundedIcon fontSize="inherit" /> },
  running: { label: '実行中', tone: 'info', icon: <SyncRoundedIcon fontSize="inherit" /> },
  pending: { label: '待機中', tone: 'info', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  created: { label: '待機中', tone: 'info', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  preparing: { label: '準備中', tone: 'info', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  waiting_for_resource: { label: 'リソース待ち', tone: 'info', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  scheduled: { label: '予約済み', tone: 'info', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  waiting_for_callback: { label: '応答待ち', tone: 'info', icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  canceling: { label: 'キャンセル中', tone: 'warning', icon: <DoNotDisturbAltRoundedIcon fontSize="inherit" /> },
  manual: { label: '手動待ち', tone: 'warning', icon: <PauseCircleOutlineRoundedIcon fontSize="inherit" /> },
  canceled: { label: 'キャンセル', tone: 'warning', icon: <DoNotDisturbAltRoundedIcon fontSize="inherit" /> },
  skipped: { label: 'スキップ', tone: 'neutral', icon: <DoNotDisturbAltRoundedIcon fontSize="inherit" /> },
}

/**
 * Pipeline or job state as icon plus text, so the state never depends on color alone.
 * `prefix` names what the state belongs to; a job list leaves it empty.
 * `compact` drops the text for dense rows: the icon's shape and colour carry the state,
 * and the name stays in the tooltip and the accessible name.
 */
export function PipelineStatus({ compact = false, prefix = 'CI', status }: { compact?: boolean; prefix?: string; status: string | null }) {
  const known = status ? statuses[status] : undefined
  const label = `${prefix ? `${prefix} ` : ''}${known?.label ?? (status || '状態不明')}`
  const icon = known?.icon ?? <HelpOutlineRoundedIcon fontSize="inherit" />
  const tone = known?.tone ?? 'neutral'
  if (compact) return <StateIcon icon={icon} label={label} spinning={status === 'running'} tone={tone} />
  return (
    <Stack aria-label={label} component="span" direction="row" role="img" spacing={0.5} sx={{ alignItems: 'center', color: tone === 'neutral' ? 'text.secondary' : `${tone}.main`, display: 'inline-flex', fontSize: 16, whiteSpace: 'nowrap' }}>
      {icon}
      <Typography aria-hidden color="inherit" component="span" variant="caption">{label}</Typography>
    </Stack>
  )
}
