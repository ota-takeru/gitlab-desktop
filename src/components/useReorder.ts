import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react'

const DRAG_THRESHOLD = 4
const SLIDE = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)'
const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

interface Pending { key: string; pointerId: number; startX: number; startY: number }
/** Where the items were when the drag began; the drop place is computed from these, not from the moving items. */
interface Drag { key: string; from: number; starts: number[]; centers: number[]; step: number; offset: number; to: number }

/**
 * Reordering by dragging with the pointer, or with Alt and the arrow keys.
 * While dragging, the item follows the pointer and the others slide aside,
 * so the new order is visible before the drop. Pointer events rather than
 * HTML drag and drop, which the Windows webview gives to Tauri's file drop.
 *
 * Items are the elements given `itemProps`, inside the element given `containerProps`.
 */
export function useReorder({ axis, keys, onMove }: { axis: 'x' | 'y'; keys: string[]; onMove: (key: string, toIndex: number) => void }) {
  const containerRef = useRef<HTMLElement | null>(null)
  const pending = useRef<Pending | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  // Right after the drop the items are already in their new places; sliding them again would make them jump.
  const [settling, setSettling] = useState(false)
  const latest = useRef({ drag, keys, onMove })
  useEffect(() => { latest.current = { drag, keys, onMove } })

  useEffect(() => {
    const measure = (key: string): Drag | null => {
      const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-reorder-key]') ?? [])
      const from = items.findIndex((item) => item.dataset.reorderKey === key)
      if (from < 0) return null
      const rects = items.map((item) => item.getBoundingClientRect())
      const starts = rects.map((rect) => axis === 'y' ? rect.top : rect.left)
      const sizes = rects.map((rect) => axis === 'y' ? rect.height : rect.width)
      // The others make room for the dragged item: its own size and the gap between items.
      const gap = from + 1 < starts.length ? starts[from + 1] - starts[from] - sizes[from] : from > 0 ? starts[from] - starts[from - 1] - sizes[from - 1] : 0
      const step = sizes[from] + Math.max(0, gap)
      return { centers: starts.map((start, index) => start + sizes[index] / 2), from, key, offset: 0, starts, step, to: from }
    }
    const move = (event: globalThis.PointerEvent) => {
      const start = pending.current
      if (!start || event.pointerId !== start.pointerId) return
      const offset = axis === 'y' ? event.clientY - start.startY : event.clientX - start.startX
      let current = latest.current.drag
      if (!current) {
        if (Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < DRAG_THRESHOLD) return
        current = measure(start.key)
        if (!current) return
        document.body.style.userSelect = 'none'
      }
      const center = current.centers[current.from] + offset
      let to = current.from
      current.centers.forEach((other, index) => {
        if (index > current.from && center > other) to = Math.max(to, index)
        if (index < current.from && center < other) to = Math.min(to, index)
      })
      const next = { ...current, offset, to }
      latest.current.drag = next
      setDrag(next)
    }
    const end = (event: globalThis.PointerEvent) => {
      const start = pending.current
      if (!start || event.pointerId !== start.pointerId) return
      pending.current = null
      const current = latest.current.drag
      if (!current) return
      document.body.style.userSelect = ''
      suppressClick.current = true
      latest.current.drag = null
      setSettling(true)
      setDrag(null)
      requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
      if (event.type !== 'pointercancel' && current.to !== current.from) latest.current.onMove(current.key, current.to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.style.userSelect = ''
    }
  }, [axis])

  const moveByKey = (event: KeyboardEvent<HTMLElement>, key: string) => {
    if (!event.altKey) return
    const step = event.key === (axis === 'y' ? 'ArrowUp' : 'ArrowLeft') ? -1 : event.key === (axis === 'y' ? 'ArrowDown' : 'ArrowRight') ? 1 : 0
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    const from = keys.indexOf(key)
    const to = from + step
    if (from < 0 || to < 0 || to >= keys.length) return
    onMove(key, to)
    // Moving the element in the page drops its focus, so give it back.
    requestAnimationFrame(() => containerRef.current?.querySelector<HTMLElement>(`[data-reorder-key="${CSS.escape(key)}"]`)?.focus())
  }

  // With reduced motion the others still move aside, without sliding.
  const slide = drag && prefersReducedMotion() ? 'none' : SLIDE
  const styleFor = (key: string): CSSProperties | undefined => {
    if (!drag) return settling ? { transition: 'none' } : undefined
    const index = keys.indexOf(key)
    const translate = (distance: number) => axis === 'y' ? `translateY(${distance}px)` : `translateX(${distance}px)`
    if (key === drag.key) return { position: 'relative', transform: translate(drag.offset), transition: 'none', zIndex: 2 }
    const shift = drag.from < drag.to && index > drag.from && index <= drag.to ? -drag.step : drag.to < drag.from && index >= drag.to && index < drag.from ? drag.step : 0
    return { transform: shift ? translate(shift) : 'none', transition: slide }
  }

  return {
    /** The key being dragged, while a drag is in progress. */
    draggingKey: drag?.key ?? null,
    containerProps: {
      ref: (element: HTMLElement | null) => { containerRef.current = element },
      // A drag ends with a click on the item it started on; that click must not open it.
      onClickCapture: (event: MouseEvent) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      },
    },
    /** Props for an item. The dragged one carries `data-reorder-dragging` for its raised look. */
    itemProps: (key: string) => ({
      'data-reorder-key': key,
      'data-reorder-dragging': drag?.key === key ? 'true' : undefined,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => moveByKey(event, key),
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('[data-no-reorder]')) return
        suppressClick.current = false
        pending.current = { key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
      },
      style: styleFor(key),
    }),
  }
}
