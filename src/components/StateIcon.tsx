import Box from '@mui/material/Box'
import { keyframes } from '@mui/material/styles'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

export type StateIconTone = 'success' | 'warning' | 'error' | 'info' | 'secondary' | 'primary' | 'neutral'

const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`

/**
 * A state shown by shape and colour instead of words: a 16px icon, and an optional
 * count beside it. The state's name is the tooltip and the accessible name, so the
 * state never depends on colour alone and a reader can still ask what it means.
 */
export function StateIcon({ count, icon, label, spinning = false, tone = 'neutral' }: { count?: number; icon: ReactNode; label: string; spinning?: boolean; tone?: StateIconTone }) {
  return (
    <Tooltip title={label}>
      <Box aria-label={label} component="span" role="img" sx={{ alignItems: 'center', color: tone === 'neutral' ? 'text.secondary' : `${tone}.main`, display: 'inline-flex', flexShrink: 0, fontSize: 16, gap: 0.25, whiteSpace: 'nowrap' }}>
        <Box component="span" sx={{ display: 'inline-flex', ...(spinning ? { animation: `${spin} 1.6s linear infinite`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } } : {}) }}>{icon}</Box>
        {count !== undefined ? <Typography aria-hidden color="inherit" component="span" sx={{ fontWeight: 600 }} variant="caption">{count}</Typography> : null}
      </Box>
    </Tooltip>
  )
}
