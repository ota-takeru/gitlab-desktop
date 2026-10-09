import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

/** A titled block of the settings page. Sections are separated by rules, not cards. */
export function SettingsSection({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Box aria-labelledby={id} component="section" sx={{ borderTop: 1, borderColor: 'divider', display: 'grid', gap: { md: 4, xs: 1.5 }, gridTemplateColumns: { md: '220px minmax(0, 1fr)', xs: '1fr' }, py: 3 }}>
      <Box>
        <Typography component="h2" id={id} variant="h2">{title}</Typography>
        {description ? <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="caption" component="p">{description}</Typography> : null}
      </Box>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
