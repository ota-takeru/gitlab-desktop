import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

export type StatusBarTone = 'connected' | 'warning' | 'disconnected'

export const statusBarHeight = 24

/**
 * The client's 24px bottom bar: the connection's state as a dot and one line on
 * the left, and slots of fixed height (update notice, version) on the right.
 */
export function StatusBar({ children, tone, trailing }: { children: ReactNode; tone: StatusBarTone; trailing?: ReactNode }) {
  const warning = tone === 'warning'
  return <Box aria-label="接続ステータス" component="footer" sx={{ alignItems: 'center', bgcolor: 'surface.nav', borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, height: statusBarHeight, minHeight: statusBarHeight, px: 1.5 }}>
    <Box sx={{ bgcolor: warning ? 'warning.main' : tone === 'connected' ? 'success.main' : 'text.disabled', borderRadius: '50%', flexShrink: 0, height: 6, width: 6 }} />
    <Typography color={warning ? 'warning' : 'textSecondary'} noWrap role="status" sx={{ minWidth: 0 }} variant="caption">{children}</Typography>
    {trailing ? <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0, ml: 'auto' }}>{trailing}</Stack> : null}
  </Box>
}
