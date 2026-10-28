import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded'
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded'
import DoNotDisturbAltRoundedIcon from '@mui/icons-material/DoNotDisturbAltRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'

import { useLocale } from '../i18n/useT'
import { formatMergeRequestState } from '../lib/format'

/** The MR state's icon, also used inside the state pill of headers. Open is the split icon turned over, as in GitLab. */
export function MergeRequestStateGlyph({ state }: { state: string }) {
  const opened = state === 'opened' || state === 'open'
  if (opened) return <CallSplitRoundedIcon fontSize="inherit" sx={{ transform: 'rotate(180deg)' }} />
  if (state === 'merged') return <CallMergeRoundedIcon fontSize="inherit" />
  if (state === 'closed') return <DoNotDisturbAltRoundedIcon fontSize="inherit" />
  return <HelpOutlineRoundedIcon fontSize="inherit" />
}

/** Compact MR state marker for list rows. The state name is the accessible label and tooltip. */
export function MergeRequestStateIcon({ state }: { state: string }) {
  // The label is read from the current language; subscribing re-renders it when that changes.
  useLocale()
  const label = formatMergeRequestState(state)
  const opened = state === 'opened' || state === 'open'
  const color = opened ? 'success.main' : state === 'merged' ? 'secondary.main' : 'text.secondary'
  return (
    <Tooltip title={label}>
      <Box aria-label={label} component="span" role="img" sx={{ color, display: 'inline-flex', fontSize: 16 }}><MergeRequestStateGlyph state={state} /></Box>
    </Tooltip>
  )
}
