import { describe, expect, it, vi } from 'vitest'
import { firstVisibleFileLine, scrollNearestBy } from './diffShared'

function box(element: Element, top: () => number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => ({ top: top(), bottom: top() + height, height } as DOMRect))
}

/** A page scroller holding a 100px tall table scroller, with a 20px header and rows 40px tall. */
function pageWithTable() {
  const page = document.createElement('div')
  page.style.overflowY = 'auto'
  page.innerHTML = '<div data-table-scroll><table><thead><tr data-source-start="1"></tr></thead><tbody><tr data-source-start="3"></tr><tr data-source-start="4"></tr><tr data-source-start="5"></tr></tbody></table></div>'
  document.body.append(page)
  Object.defineProperties(page, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } })
  const table = page.querySelector<HTMLElement>('[data-table-scroll]')!
  Object.defineProperties(table, { scrollHeight: { value: 140 }, clientHeight: { value: 100 } })
  box(table, () => 200 - page.scrollTop, 100)
  box(page.querySelector('thead')!, () => 200 - page.scrollTop, 20)
  const rows = Array.from(page.querySelectorAll<HTMLElement>('tbody tr'))
  rows.forEach((row, index) => box(row, () => 220 + index * 40 - table.scrollTop - page.scrollTop, 40))
  return { page, rows, table }
}

describe('positions in a table that scrolls by itself', () => {
  it('brings the row up in its table and moves the page by what is left', () => {
    const { page, rows, table } = pageWithTable()
    scrollNearestBy(rows[2], 100)
    expect(table.scrollTop).toBe(80)
    // The row rose by 80px inside the table, leaving 20px of the 100px for the page.
    expect(page.scrollTop).toBe(20)
    page.remove()
  })

  it('does not count a row scrolled out of its table as on screen', () => {
    const { page, table } = pageWithTable()
    table.scrollTop = 60
    // The first row's box (160-200) is below `top` but above the table, which starts at 200.
    expect(firstVisibleFileLine(page, 150)?.line).toBe(4)
    page.remove()
  })
})
