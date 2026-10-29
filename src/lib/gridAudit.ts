import { grid } from '../theme'

export interface GridIssue {
  element: Element
  kind: 'fraction' | 'center' | 'offset'
  detail: string
}

const near = (value: number, step = 1) => Math.abs(value / step - Math.round(value / step)) * step < 0.05

function laidOut(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const style = getComputedStyle(element)
  if (style.display === 'inline' || style.display === 'contents' || style.display === 'none' || style.visibility === 'hidden') return false
  if (style.position === 'absolute' || style.position === 'fixed') return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
}

/**
 * Finds what lifts the visible layout off the 4px grid:
 * - fraction: a box whose height has a fraction its children do not explain (a ratio line height, a scaled icon);
 * - center: children of a centred row whose centres disagree;
 * - offset: a row stacked in a column that starts between grid lines (a border, a 2px margin).
 * The window's own height is not on the grid, so boxes that take their height from it (a fraction equal to the
 * window's) and rows after a growing sibling are not reported. Neither are sticky rows, which move with
 * scrolling, nor rows without text (an icon or avatar centred in its line).
 */
export function auditGrid(root: ParentNode = document.body): GridIssue[] {
  const issues: GridIssue[] = []
  for (const element of root.querySelectorAll('*')) {
    if (!laidOut(element) || element.closest('[data-grid-exempt]')) continue
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const children = [...element.children].filter(laidOut)

    if (!near(rect.height) && !near(rect.height - (window.visualViewport?.height ?? window.innerHeight)) && !children.some((child) => !near(child.getBoundingClientRect().height))) {
      issues.push({ element, kind: 'fraction', detail: `height ${rect.height.toFixed(2)}px, line height ${style.lineHeight}` })
    }

    if (style.display.includes('flex') && style.flexDirection.startsWith('row') && style.flexWrap === 'nowrap' && style.alignItems === 'center' && children.length > 1) {
      const centres = children.map((child) => { const box = child.getBoundingClientRect(); return box.top + box.height / 2 })
      const spread = Math.max(...centres) - Math.min(...centres)
      if (spread > 0.6) issues.push({ element, kind: 'center', detail: `centres differ by ${spread.toFixed(2)}px` })
    }

    const parent = element.parentElement
    if (!parent || rect.height < 16 || style.display.startsWith('inline') || style.position === 'sticky' || !element.textContent?.trim()) continue
    const parentStyle = getComputedStyle(parent)
    const column = parentStyle.display.includes('flex') ? parentStyle.flexDirection.startsWith('column') && parentStyle.justifyContent !== 'center' && parentStyle.justifyContent !== 'flex-end' : parentStyle.display === 'block'
    if (!column) continue
    let sibling = element.previousElementSibling
    let afterGrowing = false
    for (; sibling; sibling = sibling.previousElementSibling) if (Number.parseFloat(getComputedStyle(sibling).flexGrow) > 0) afterGrowing = true
    if (afterGrowing) continue
    const box = parent.getBoundingClientRect()
    // Measured from inside the border, so a 2px padding counts like a 2px margin.
    const offset = rect.top - box.top - Number.parseFloat(parentStyle.borderTopWidth) + parent.scrollTop
    if (!near(offset, grid)) issues.push({ element, kind: 'offset', detail: `starts ${offset.toFixed(2)}px into its parent` })
  }
  return issues
}

/** A short line per issue, for a console or a test failure. */
export function describeGridIssue({ element, kind, detail }: GridIssue) {
  const classes = [...element.classList].filter((name) => !name.startsWith('css-')).slice(0, 2).join('.')
  const text = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 32)
  return `${kind}: ${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''} "${text}" ${detail}`
}
