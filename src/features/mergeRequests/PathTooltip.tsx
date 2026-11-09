import Box from '@mui/material/Box'
import Tooltip, { type TooltipProps } from '@mui/material/Tooltip'
import { type ReactElement, useEffect, useId, useState } from 'react'

import { splitPath } from './diffFileOrder'

// Popper's own scroll listener would move the tooltip with its row; a scroll hands the tooltip to the row under the pointer instead.
const popperOptions = { modifiers: [{ name: 'eventListeners', options: { scroll: false } }] }
const tooltipSlots = { popper: { popperOptions }, tooltip: { sx: { maxWidth: 'min(640px, 80vw)' } } }
const scrolledSlots = { ...tooltipSlots, transition: { timeout: 0 } }
// Closing, the tooltip is placed once more by its row, already scrolled away, so it is hidden in that same render.
const scrolledAwaySlots = { ...scrolledSlots, popper: { popperOptions, sx: { visibility: 'hidden' } } }

/** Each path tooltip on screen, by the id its row carries, told by a scroll whether the pointer is now on it. */
const anchors = new Map<string, (open: boolean) => void>()
let pointer: { x: number; y: number } | undefined
let shown: string | undefined

const trackPointer = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY } }
const forgetPointer = (event: PointerEvent) => { if (!event.relatedTarget) pointer = undefined }
// A scroll moves the rows but sends no pointer events until it ends, so the row under the pointer is looked up here.
const followPointer = () => {
  if (!pointer) return
  const hit = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('[data-path-tooltip]')?.dataset.pathTooltip
  if (hit === shown) return
  if (shown) anchors.get(shown)?.(false)
  shown = hit && anchors.has(hit) ? hit : undefined
  if (shown) anchors.get(shown)?.(true)
}

function register(id: string, show: (open: boolean) => void) {
  if (anchors.size === 0) {
    document.addEventListener('pointermove', trackPointer, { capture: true, passive: true })
    document.addEventListener('pointerout', forgetPointer, { capture: true, passive: true })
    document.addEventListener('scroll', followPointer, { capture: true, passive: true })
  }
  anchors.set(id, show)
  return () => {
    anchors.delete(id)
    if (shown === id) shown = undefined
    if (anchors.size > 0) return
    pointer = undefined
    document.removeEventListener('pointermove', trackPointer, { capture: true })
    document.removeEventListener('pointerout', forgetPointer, { capture: true })
    document.removeEventListener('scroll', followPointer, { capture: true })
  }
}

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
  const id = useId()
  const [open, setOpen] = useState(false)
  // Shown or hidden by a scroll, the tooltip comes and goes at once, keeping up with the rows passing under the pointer.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => register(id, (next) => { setScrolled(true); setOpen(next) }), [id])
  if (!path) return children
  const { directory, name } = splitPath(path)
  const show = () => { shown = id; setScrolled(false); setOpen(true) }
  const hide = () => { if (shown === id) shown = undefined; setOpen(false) }
  return <Tooltip data-path-tooltip={id} describeChild onClose={hide} onOpen={show} open={open} placement={placement} slotProps={!scrolled ? tooltipSlots : open ? scrolledSlots : scrolledAwaySlots} title={<>
    <Box dir="ltr" sx={{ fontFamily: 'code.fontFamily', overflowWrap: 'anywhere' }}>
      {oldPath ? <Box sx={{ opacity: 0.72 }}>{oldPath} →</Box> : null}
      {directory ? <Box sx={{ opacity: 0.72 }}>{directory}/</Box> : null}
      <Box sx={{ fontWeight: 600 }}>{name}</Box>
    </Box>
    {notes?.map((note) => <Box key={note}>{note}</Box>)}
  </>}>{children}</Tooltip>
}
