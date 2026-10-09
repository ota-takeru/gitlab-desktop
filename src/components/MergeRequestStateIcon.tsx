import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded'
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded'
import DoNotDisturbAltRoundedIcon from '@mui/icons-material/DoNotDisturbAltRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'

import { formatMergeRequestState } from '../lib/format'

/** Compact MR state marker for list rows. The state name is the accessible label and tooltip. */
export function MergeRequestStateIcon({ state }: { state: string }) {
  const label = formatMergeRequestState(state)
  const opened = state === 'opened' || state === 'open'
  const icon = opened ? <CallSplitRoundedIcon fontSize="inherit" /> : state === 'merged' ? <CallMergeRoundedIcon fontSize="inherit" /> : state === 'closed' ? <DoNotDisturbAltRoundedIcon fontSize="inherit" /> : <HelpOutlineRoundedIcon fontSize="inherit" />
  const color = opened ? 'success.main' : state === 'merged' ? 'secondary.main' : 'text.secondary'
  return (
    <Tooltip title={label}>
      <Box aria-label={label} component="span" role="img" sx={{ color, display: 'inline-flex', fontSize: 16, transform: opened ? 'rotate(180deg)' : undefined }}>{icon}</Box>
    </Tooltip>
  )
}
