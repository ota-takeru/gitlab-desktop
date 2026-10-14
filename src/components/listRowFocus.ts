import type { KeyboardEvent } from 'react'

/**
 * Keyboard movement between the rows of a list: ↑/↓ (and j/k) to the
 * neighbouring row, Home/End to the first and last. Put it on the element
 * that contains the rows; typing in a field inside it is left alone.
 */
export function moveListRowFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return
  const key = event.key
  if (!['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End'].includes(key)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-list-row="true"]'))
  if (rows.length === 0) return
  event.preventDefault()
  const activeIndex = rows.indexOf(document.activeElement as HTMLElement)
  const direction = key === 'ArrowDown' || key === 'j' ? 1 : key === 'ArrowUp' || key === 'k' ? -1 : 0
  const nextIndex = key === 'Home' ? 0
    : key === 'End' ? rows.length - 1
      : activeIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, activeIndex + direction))
  rows[nextIndex]?.focus()
  rows[nextIndex]?.scrollIntoView?.({ block: 'nearest' })
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}
