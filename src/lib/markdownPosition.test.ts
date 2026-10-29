import { describe, expect, it } from 'vitest'

import { shownOffsetOfSource, sourceOffsetOfShown } from './markdownPosition'

describe('markdown positions', () => {
  const markdown = '[A](https://example.com/long/path)BCDEFGHIJ'
  const shown = 'ABCDEFGHIJ'

  it('puts a caret after a link text after the whole link, not by the length of its URL', () => {
    expect(sourceOffsetOfShown(markdown, shown, 1)).toBe(markdown.indexOf('B'))
    expect(shownOffsetOfSource(markdown, shown, markdown.indexOf('B'))).toBe(1)
    expect(shownOffsetOfSource(markdown, shown, markdown.indexOf('H'))).toBe(7)
  })

  it('goes past closing syntax but not to the next line', () => {
    expect(sourceOffsetOfShown('**bold** text', 'bold text', 4)).toBe(8)
    expect(sourceOffsetOfShown('line1\nline2', 'line1\nline2', 5)).toBe(5)
  })

  it('counts characters outside the Basic Multilingual Plane in code units', () => {
    expect(sourceOffsetOfShown('**😀**x', '😀x', 2)).toBe(6)
    expect(shownOffsetOfSource('**😀**x', '😀x', 6)).toBe(2)
  })
})
