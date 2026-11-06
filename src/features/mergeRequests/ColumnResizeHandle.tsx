import Box from '@mui/material/Box'

/** Pixels per arrow key press. */
const KEY_STEP = 16

/**
 * Drags the right edge of a column. While dragging only the column's own style changes, so a long diff beside it
 * does not render again for every move; `onCommit` gets the width when the drag ends.
 */
export function ColumnResizeHandle({ column, defaultWidth, hint, label, max, min, onCommit, width }: { column: React.RefObject<HTMLElement | null>; defaultWidth: number; hint: string; label: string; max: number; min: number; onCommit: (width: number) => void; width: number }) {
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)))
  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    // No text is selected while dragging.
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    let dragged = width
    handle.setPointerCapture?.(event.pointerId)
    const move = (moved: PointerEvent) => {
      dragged = clamp(width + moved.clientX - startX)
      if (column.current) column.current.style.flexBasis = `${dragged}px`
    }
    const finish = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      // A click that moved nothing must not save a width the pane has only narrowed for now.
      if (dragged !== width) onCommit(dragged)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }
  const resizeWithKey = (event: React.KeyboardEvent) => {
    const next = event.key === 'ArrowLeft' ? width - KEY_STEP : event.key === 'ArrowRight' ? width + KEY_STEP : event.key === 'Home' ? min : event.key === 'End' ? max : null
    if (next === null) return
    event.preventDefault()
    onCommit(clamp(next))
  }
  // In the gap beside the column, with a line in its middle when pointed at or focused.
  return <Box aria-label={label} aria-orientation="vertical" aria-valuemax={max} aria-valuemin={min} aria-valuenow={width} onDoubleClick={() => onCommit(clamp(defaultWidth))} onKeyDown={resizeWithKey} onPointerDown={startDrag} role="separator" tabIndex={0} title={hint} sx={{ bottom: 0, cursor: 'col-resize', outline: 'none', position: 'absolute', right: -12, top: 0, touchAction: 'none', width: 12, '&::after': { bgcolor: 'transparent', bottom: 0, content: '""', left: 5, position: 'absolute', top: 0, width: 2 }, '&:hover::after, &:focus-visible::after': { bgcolor: 'primary.main' } }} />
}
