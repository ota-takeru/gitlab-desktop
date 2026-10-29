import { grid } from '../theme'

export interface GridIssue {
  element: Element
  kind: 'fraction' | 'height' | 'inset' | 'center' | 'offset'
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
 * - height: a box of text, or a field, whose height is not whole grid steps (a 22px chip, a 37px field);
 * - inset: a block of text whose first line starts between grid lines (a 2px padding or a border above it);
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
    const ownsText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    const scrolls = /auto|scroll/u.test(style.overflowY)

    if (!near(rect.height) && !near(rect.height - (window.visualViewport?.height ?? window.innerHeight)) && !children.some((child) => !near(child.getBoundingClientRect().height))) {
      issues.push({ element, kind: 'fraction', detail: `height ${rect.height.toFixed(2)}px, line height ${style.lineHeight}` })
    }

    if ((ownsText || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && !scrolls && near(rect.height) && !near(rect.height, grid)) {
      issues.push({ element, kind: 'height', detail: `height ${rect.height.toFixed(2)}px is not whole ${grid}px steps` })
    }

    // A field centres its text in its own height (6px in a 32px select), as an input does.
    if (ownsText && /^(?:block|list-item|table-cell)$/u.test(style.display) && !element.closest('.MuiInputBase-root')) {
      const inset = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.borderTopWidth)
      if (!near(inset, grid)) issues.push({ element, kind: 'inset', detail: `text starts ${inset.toFixed(2)}px inside` })
    }

    if (style.display.includes('flex') && style.flexDirection.startsWith('row') && style.flexWrap === 'nowrap' && style.alignItems === 'center' && children.length > 1) {
      const centres = children.map((child) => { const box = child.getBoundingClientRect(); return box.top + box.height / 2 })
      const spread = Math.max(...centres) - Math.min(...centres)
      if (spread > 0.6) issues.push({ element, kind: 'center', detail: `centres differ by ${spread.toFixed(2)}px` })
    }

    const parent = element.parentElement
    if (!parent || rect.height < 16 || style.display.startsWith('inline') || style.position === 'sticky' || !element.textContent?.trim()) continue
    // A popper is placed beside its anchor, wherever that is; the space between them is not a row of the page.
    if (parent.hasAttribute('data-popper-placement')) continue
    const parentStyle = getComputedStyle(parent)
    const column = parentStyle.display.includes('flex') ? parentStyle.flexDirection.startsWith('column') && parentStyle.justifyContent !== 'center' && parentStyle.justifyContent !== 'flex-end' : parentStyle.display === 'block'
    if (!column) continue
    let sibling = element.previousElementSibling
    let afterGrowing = false
    for (; sibling; sibling = sibling.previousElementSibling) if (Number.parseFloat(getComputedStyle(sibling).flexGrow) > 0) afterGrowing = true
    if (afterGrowing) continue
    const box = parent.getBoundingClientRect()
    // Measured from the parent's outer edge, so its border or 2px padding counts like a 2px margin.
    const offset = rect.top - box.top + parent.scrollTop
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
