import Box from '@mui/material/Box'
import { alpha } from '@mui/material/styles'
import { useEffect, useState } from 'react'

import { grid } from '../theme'

/**
 * Development aid: Ctrl+Alt+G (or `?grid` in the URL) lays the 4px grid over the window, with every
 * fourth line stronger, so an edge or a line of text that sits between the lines shows at a glance.
 */
export function GridOverlay() {
  const [visible, setVisible] = useState(() => new URLSearchParams(window.location.search).has('grid'))
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === 'KeyG') setVisible((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  if (!visible) return null
  return (
    <Box
      aria-hidden
      sx={(theme) => {
        const line = (opacity: number, step: number) => `repeating-linear-gradient(to bottom, ${alpha(theme.palette.error.main, opacity)} 0 1px, transparent 1px ${step}px)`
        return { backgroundImage: `${line(0.35, grid * 4)}, ${line(0.14, grid)}`, inset: 0, pointerEvents: 'none', position: 'fixed', zIndex: theme.zIndex.tooltip + 1 }
      }}
    />
  )
}
