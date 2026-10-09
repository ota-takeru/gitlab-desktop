import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

/** Heading of the list pane: title, short context and icon actions on one line. */
export function PaneHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.5, pb: 1.25, pt: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 30, minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" noWrap variant="h1">{title}</Typography>
        </Box>
        {actions ? <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0, mr: -0.5 }}>{actions}</Stack> : null}
      </Stack>
      {subtitle ? <Typography color="text.secondary" component="div" sx={{ mt: 0.25 }} variant="caption">{subtitle}</Typography> : null}
      {children ? <Box sx={{ mt: 1.25 }}>{children}</Box> : null}
    </Box>
  )
}

/** A one-line status strip under the pane header (count, freshness, errors). */
export function PaneStatus({ children }: { children: ReactNode }) {
  return <Typography color="text.secondary" component="div" sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.5, py: 0.5 }} variant="caption">{children}</Typography>
}

/** Centered placeholder for an empty pane. */
export function PaneEmpty({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', justifyContent: 'center', minHeight: 240, px: 3, py: 6, textAlign: 'center' }}>
      {icon ? <Box sx={{ color: 'text.disabled', display: 'flex', fontSize: 40, mb: 0.5 }}>{icon}</Box> : null}
      <Typography color="text.primary" sx={{ fontWeight: 600 }} variant="body2">{title}</Typography>
      {description ? <Typography color="text.secondary" sx={{ maxWidth: 360 }} variant="body2">{description}</Typography> : null}
      {children}
    </Stack>
  )
}

/** Keyboard key rendered inline in help text. */
export function Kbd({ children }: { children: ReactNode }) {
  return <Box component="kbd" sx={{ bgcolor: 'surface.raised', border: 1, borderBottomWidth: 2, borderColor: 'surface.borderStrong', borderRadius: 0.75, color: 'text.primary', display: 'inline-block', fontFamily: 'typography.code.fontFamily', fontSize: 11, lineHeight: '16px', minWidth: 18, px: 0.5, textAlign: 'center' }}>{children}</Box>
}
