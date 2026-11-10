import { describe, expect, it } from 'vitest'

import { foldRanges } from './lineFolds'

const rangesOf = (text: string, markdown = false, breakBefore?: (index: number) => boolean) => Object.fromEntries(foldRanges(text.split('\n'), markdown, breakBefore))

describe('foldRanges', () => {
  it('folds the deeper indented lines after a line, keeping the closing brace in view', () => {
    expect(rangesOf([
      'function a() {', //   0
      '  if (x) {', //       1
      '    y()', //          2
      '', //                 3
      '    z()', //          4
      '  }', //              5
      '  w()', //            6
      '}', //                7
      'b()', //              8
    ].join('\n'))).toEqual({ 0: 6, 1: 4 })
  })

  it('folds an indented block without a closing line, as in Python, and leaves trailing blank lines out', () => {
    expect(rangesOf('def a():\n    x = 1\n\n    return x\n\n\ndef b():\n    pass')).toEqual({ 0: 3, 6: 7 })
  })

  it('counts a tab as the indent of the next tab stop', () => {
    expect(rangesOf('a:\n\tb\n  \tc\nd')).toEqual({ 0: 2 })
  })

  it('does not fold across a break, such as lines left out of a diff', () => {
    expect(rangesOf('a {\n  b\n  c\n  d\n}', false, (index) => index === 2)).toEqual({ 0: 1 })
  })

  it('folds a Markdown heading down to the next heading of the same or a higher level, past fenced code', () => {
    expect(rangesOf([
      '# Title', //      0
      'intro', //        1
      '## One', //       2
      '```sh', //        3
      '# not a heading', // 4
      '```', //          5
      '## Two', //       6
      'text', //         7
      '', //             8
      '# Next', //       9
    ].join('\n'), true)).toEqual({ 0: 7, 2: 5, 6: 7 })
  })
})
