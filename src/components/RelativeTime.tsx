import Tooltip from '@mui/material/Tooltip'
import Typography, { type TypographyProps } from '@mui/material/Typography'

import { useLocale } from '../i18n/useT'
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format'

interface RelativeTimeProps {
  value: string
  /** Optional text before the time, for example 「更新」. */
  prefix?: string
  color?: TypographyProps['color']
  variant?: TypographyProps['variant']
}

/** Relative time with the exact local time available on hover and to assistive technology. */
export function RelativeTime({ value, prefix, color = 'textSecondary', variant = 'caption' }: RelativeTimeProps) {
  // The formatters read the current language; subscribing re-renders the time when it changes.
  useLocale()
  const absolute = formatAbsoluteTime(value)
  return (
    <Tooltip title={absolute}>
      <Typography color={color} component="time" dateTime={value} sx={{ whiteSpace: 'nowrap' }} variant={variant}>
        {prefix ? `${prefix} ` : ''}{formatRelativeTime(value)}
      </Typography>
    </Tooltip>
  )
}
