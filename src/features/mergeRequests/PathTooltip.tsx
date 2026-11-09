import Box from '@mui/material/Box'
import Tooltip, { type TooltipProps } from '@mui/material/Tooltip'
import { type ReactElement, useEffect, useState } from 'react'

import { splitPath } from './diffFileOrder'

// Popper's own scroll listener would move the tooltip with the row in the frame before the scroll closes it.
const tooltipSlots = {
  popper: { popperOptions: { modifiers: [{ name: 'eventListeners', options: { scroll: false } }] } },
  tooltip: { sx: { maxWidth: 'min(640px, 80vw)' } },
}
const scrolledSlots = { ...tooltipSlots, transition: { timeout: 0 } }

/** A whole path on hover, with the file's name set apart from its folders. Long paths break anywhere, as they have no spaces. */
export function PathTooltip({ children, notes, oldPath, path, placement = 'right' }: {
  children: ReactElement
  /** What else there is to know about the row, such as its threads. */
  notes?: string[]
  /** The path before a rename. */
  oldPath?: string
  path: string | null
  placement?: TooltipProps['placement']
}) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // A scroll carries the row away under the pointer, leaving the tooltip naming a row no longer there, so it goes at once.
  useEffect(() => {
    if (!open) return
    const close = () => { setScrolled(true); setOpen(false) }
    document.addEventListener('scroll', close, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', close, { capture: true })
  }, [open])
  if (!path) return children
  const { directory, name } = splitPath(path)
  return <Tooltip describeChild onClose={() => setOpen(false)} onOpen={() => { setScrolled(false); setOpen(true) }} open={open} placement={placement} slotProps={scrolled ? scrolledSlots : tooltipSlots} title={<>
    <Box dir="ltr" sx={{ fontFamily: 'code.fontFamily', overflowWrap: 'anywhere' }}>
      {oldPath ? <Box sx={{ opacity: 0.72 }}>{oldPath} →</Box> : null}
      {directory ? <Box sx={{ opacity: 0.72 }}>{directory}/</Box> : null}
      <Box sx={{ fontWeight: 600 }}>{name}</Box>
    </Box>
    {notes?.map((note) => <Box key={note}>{note}</Box>)}
  </>}>{children}</Tooltip>
}
