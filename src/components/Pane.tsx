import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { gridLine } from '../theme'
import { edgeRow } from './edges'
import { frame, hairline } from './hairline'
import { paneGutter } from './paneSx'

/**
 * Heading of the list pane: title, short context and icon actions on one line.
 * With `navigation` (a `PaneNavigation`: a name with tabs under it) the name
 * and tabs take the title's place, the tabs sit on the header's divider, and
 * the context and search follow in their own band below it. The title stays
 * as the heading for assistive technology.
 */
export function PaneHeader({ title, subtitle, actions, children, navigation }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; navigation?: ReactNode }) {
  const titleRef = useFullTextTitle<HTMLHeadingElement>()
  const actionsGroup = actions ? <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0, minHeight: 32 }}>{actions}</Stack> : null
  if (navigation) return <>
    <Box sx={{ ...hairline('bottom'), flexShrink: 0, px: paneGutter, pt: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0, ...edgeRow }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" sx={visuallyHiddenSx}>{title}</Typography>
          {navigation}
        </Box>
        {actionsGroup}
      </Stack>
    </Box>
    {subtitle || children ? <Box sx={{ ...hairline('bottom'), flexShrink: 0, px: paneGutter, py: 1 }}>
      {subtitle ? <Typography color="textSecondary" component="div" variant="caption">{subtitle}</Typography> : null}
      {children ? <Box sx={{ mt: subtitle ? 0.5 : 0 }}>{children}</Box> : null}
    </Box> : null}
  </>
  return (
    <Box sx={{ ...hairline('bottom'), flexShrink: 0, px: paneGutter, pb: 1, pt: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32, minWidth: 0, ...edgeRow }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" noWrap ref={titleRef} variant="h1">{title}</Typography>
        </Box>
        {actionsGroup}
      </Stack>
      {subtitle ? <Typography color="textSecondary" component="div" variant="caption">{subtitle}</Typography> : null}
      {children ? <Box sx={{ mt: 1 }}>{children}</Box> : null}
    </Box>
  )
}

/**
 * The name of what a pane shows (a project, a user) on a 32px line level with the header's actions,
 * and the tabs between its lists under it. The first tab's text starts on the name's edge, and the
 * tab indicator lies on the header's divider.
 */
export function PaneNavigation({ heading, tabs }: { heading: ReactNode; tabs: ReactNode }) {
  return <Box sx={{ minWidth: 0 }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minHeight: 32, minWidth: 0 }}>{heading}</Stack>
    <Box sx={{ mt: 0.5, ...edgeRow }}>{tabs}</Box>
  </Box>
}

/**
 * A one-line status strip under the pane header (count, freshness, loading).
 * Render it from the first frame with whatever is known: its height is fixed,
 * so loading and freshness changes never move the list below.
 * The strip itself is not a live region: auto refresh changes it every minute.
 * `announcement` is read out only when its text changes, such as a new count.
 */
export function PaneStatus({ announcement, children }: { announcement?: string | null; children?: ReactNode }) {
  const statusRef = useFullTextTitle<HTMLDivElement>()
  return <>
    <Typography color="textSecondary" component="div" noWrap ref={statusRef} sx={{ ...hairline('bottom'), flexShrink: 0, height: 28, px: paneGutter, py: 0.5 }} variant="caption">{children}</Typography>
    {announcement === undefined ? null : <Box aria-live="polite" sx={visuallyHiddenSx}>{announcement ?? ''}</Box>}
  </>
}

/** Shows the whole text of a one-line element that may be cut off with an ellipsis. */
function useFullTextTitle<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const text = element.textContent ?? ''
    if (text) element.title = text
    else element.removeAttribute('title')
  })
  return ref
}

const visuallyHiddenSx = { clip: 'rect(0 0 0 0)', height: '1px', overflow: 'hidden', position: 'absolute', whiteSpace: 'nowrap', width: '1px' } as const

/** Centered placeholder for an empty pane. */
export function PaneEmpty({ icon, title, description, children }: { icon?: ReactNode; title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', justifyContent: 'center', minHeight: 240, px: 3, py: 6, textAlign: 'center' }}>
      {icon ? <Box sx={{ color: 'text.disabled', display: 'flex', fontSize: 40, mb: 0.5 }}>{icon}</Box> : null}
      <Typography color="textPrimary" sx={{ fontWeight: 600 }} variant="body2">{title}</Typography>
      {description ? <Typography color="textSecondary" sx={{ maxWidth: 360 }} variant="body2">{description}</Typography> : null}
      {children}
    </Stack>
  )
}

/** Keyboard key rendered inline in help text. */
export function Kbd({ children }: { children: ReactNode }) {
  return <Box component="kbd" sx={{ bgcolor: 'surface.raised', ...frame({ color: 'surface.borderStrong' }), borderRadius: 1, boxShadow: (theme) => `inset 0 -2px 0 ${theme.palette.surface.borderStrong}`, color: 'text.primary', display: 'inline-block', fontFamily: 'code.fontFamily', fontSize: 'overline.fontSize', lineHeight: gridLine(4), minWidth: 18, px: 0.5, textAlign: 'center' }}>{children}</Box>
}
