import Chip from '@mui/material/Chip'

export type StatusTone = 'default' | 'success' | 'warning' | 'error' | 'info'

interface StatusPillProps {
  label: string
  tone?: StatusTone
  size?: 'small' | 'medium'
  subtle?: boolean
}

export function StatusPill({
  label,
  tone = 'default',
  size = 'small',
  subtle = false,
}: StatusPillProps) {
  return (
    <Chip
      aria-label={label}
      color={tone === 'default' ? 'default' : tone}
      label={label}
      size={size}
      variant={tone === 'default' || subtle ? 'outlined' : 'filled'}
    />
  )
}
