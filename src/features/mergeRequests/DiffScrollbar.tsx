import Box from '@mui/material/Box'
import { useLayoutEffect, useRef } from 'react'

import { hairline } from '../../components/hairline'
import { gridLine } from '../../theme'

/**
 * The sideways scrollbar of a diff with long lines kept on one line. The diff's own bar is under its last
 * row, which a long file puts far below the screen, so this one stays at the bottom edge of the view
 * and moves the diff with it. It is there also when nothing overflows, so it does not appear and disappear from file to file.
 * `content` is what changes the width without a resize of the view.
 */
export function DiffScrollbar({ content, target }: { content: unknown; target: React.RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const view = target.current
    const bar = barRef.current
    const width = widthRef.current
    if (!view || !bar || !width) return
    const measure = () => {
      width.style.width = `${view.scrollWidth}px`
      // Setting the same value does nothing, so the two scroll events do not chase each other.
      bar.scrollLeft = view.scrollLeft
    }
    const moveView = () => { view.scrollLeft = bar.scrollLeft }
    measure()
    // Rows on screen can widen the view beyond the width estimated from the text.
    view.addEventListener('scroll', measure, { passive: true })
    bar.addEventListener('scroll', moveView, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(view)
    if (view.firstElementChild) observer?.observe(view.firstElementChild)
    return () => {
      view.removeEventListener('scroll', measure)
      bar.removeEventListener('scroll', moveView)
      observer?.disconnect()
    }
  }, [content, target])
  return <Box aria-hidden data-testid="diff-scrollbar" ref={barRef} sx={{ bgcolor: 'background.paper', ...hairline('top'), bottom: 0, flexShrink: 0, height: gridLine(3), overflowX: 'scroll', overflowY: 'hidden', position: 'sticky', zIndex: 2 }}>
    <div ref={widthRef} style={{ height: 1 }} />
  </Box>
}
