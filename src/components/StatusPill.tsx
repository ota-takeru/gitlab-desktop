import Chip from '@mui/material/Chip'
import type { ReactElement } from 'react'

export type StatusTone = 'default' | 'success' | 'warning' | 'error' | 'info' | 'secondary'

interface StatusPillProps {
  label: string
  /** Shape of the state, so it reads at a glance and never by colour alone. */
  icon?: ReactElement
  tone?: StatusTone
  size?: 'small' | 'medium'
  subtle?: boolean
}

export function StatusPill({
  icon,
  label,
  tone = 'default',
  size = 'small',
  // Outlined by default: a solid status fill outshines the primary action.
  subtle = true,
}: StatusPillProps) {
  return (
    <Chip
      aria-label={label}
      color={tone === 'default' ? 'default' : tone}
      icon={icon}
      label={label}
      size={size}
      variant={tone === 'default' || subtle ? 'outlined' : 'filled'}
    />
  )
}
