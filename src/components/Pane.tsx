import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * Heading of the list pane: title, short context and icon actions on one line.
 * With `navigation` (tabs between sibling lists) the tabs take the title's
 * place and the title stays only as the heading for assistive technology.
 */
export function PaneHeader({ title, subtitle, actions, children, navigation }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; navigation?: ReactNode }) {
  const titleRef = useFullTextTitle<HTMLHeadingElement>()
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.5, pb: 1, pt: navigation ? 0.5 : 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 30, minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {navigation
            ? <><Typography component="h1" sx={{ clip: 'rect(0 0 0 0)', height: '1px', overflow: 'hidden', position: 'absolute', whiteSpace: 'nowrap', width: '1px' }}>{title}</Typography>{navigation}</>
            : <Typography component="h1" noWrap ref={titleRef} variant="h1">{title}</Typography>}
        </Box>
        {actions ? <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0, mr: -0.5 }}>{actions}</Stack> : null}
      </Stack>
      {subtitle ? <Typography color="textSecondary" component="div" sx={{ mt: 0.25 }} variant="caption">{subtitle}</Typography> : null}
      {children ? <Box sx={{ mt: 1 }}>{children}</Box> : null}
    </Box>
  )
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
    <Typography color="textSecondary" component="div" noWrap ref={statusRef} sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, height: 28, px: 1.5, py: 0.5 }} variant="caption">{children}</Typography>
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
  return <Box component="kbd" sx={{ bgcolor: 'surface.raised', border: 1, borderBottomWidth: 2, borderColor: 'surface.borderStrong', borderRadius: 1, color: 'text.primary', display: 'inline-block', fontFamily: 'code.fontFamily', fontSize: 'overline.fontSize', lineHeight: 1.5, minWidth: 18, px: 0.5, textAlign: 'center' }}>{children}</Box>
}
