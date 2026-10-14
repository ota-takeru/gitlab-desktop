import { describe, expect, it } from 'vitest'

import type { Diff, Position } from '../../types/gitlab'
import { positionLabel, positionLines } from './diffLineThreads'
import { parseDiff } from './diffParser'
import { hasSuggestionBlock, positionIndexRange, rangePosition, splitSuggestions, suggestionBlock, suggestionSourceLines } from './suggestions'

const diffText = '@@ -10,3 +10,4 @@\n a\n-b\n+B\n+C\n d\n@@ -30 +31 @@\n-x\n+y\n'
const diff: Diff = { collapsed: false, deletedFile: false, diff: diffText, newFile: false, newPath: 'src/a.ts', oldPath: 'src/a.ts', renamedFile: false, tooLarge: false }

describe('suggestions', () => {
  it('builds a range position within one hunk only', () => {
    const { hunks = [], lines } = parseDiff(diffText, 'src/a.ts', 'src/a.ts')
    const range = rangePosition(lines, hunks, 0, 3)
    expect(range).toMatchObject({ lineRange: { end: { newLine: 12, newPosition: 12, oldPosition: 12 }, hunk: { newCount: 4, newStart: 10, oldCount: 3, oldStart: 10 }, start: { newLine: 10, oldLine: 10 } }, newLine: 12, oldLine: undefined })
    expect(rangePosition(lines, hunks, 2, 2)?.lineRange).toBeUndefined()
    expect(rangePosition(lines, hunks, 4, 5)).toBeUndefined()
    expect(positionIndexRange(lines, range as Position)).toEqual([0, 3])
  })

  it('reads the new-side text of the commented lines for a suggestion', () => {
    const { hunks = [], lines } = parseDiff(diffText, 'src/a.ts', 'src/a.ts')
    expect(suggestionSourceLines([diff], rangePosition(lines, hunks, 0, 3)!)).toEqual(['a', 'B', 'C'])
    expect(suggestionSourceLines([diff], rangePosition(lines, hunks, 2, 2)!)).toEqual(['B'])
    // A removed line has no new-side text to replace.
    expect(suggestionSourceLines([diff], rangePosition(lines, hunks, 1, 1)!)).toBeNull()
  })

  it('writes GitLab suggestion blocks with a fence longer than any backticks inside', () => {
    expect(suggestionBlock(['one'])).toBe('```suggestion\none\n```')
    expect(suggestionBlock(['one', 'two', 'three'])).toBe('```suggestion:-2+0\none\ntwo\nthree\n```')
    expect(suggestionBlock(['```js', 'x'])).toBe('````suggestion:-1+0\n```js\nx\n````')
  })

  it('splits suggestions out of a comment but keeps them inside other code as Markdown', () => {
    const body = '前置き\n\n```suggestion:-1+2\nnew a\nnew b\n```\n\n````md\n```suggestion\nexample\n```\n````\n\n~~~suggestion\n~~~'
    expect(hasSuggestionBlock(body)).toBe(true)
    expect(splitSuggestions(body)).toEqual([
      { kind: 'markdown', text: '前置き\n' },
      { above: 1, below: 2, kind: 'suggestion', lines: ['new a', 'new b'] },
      { kind: 'markdown', text: '\n````md\n```suggestion\nexample\n```\n````\n' },
      { above: 0, below: 0, kind: 'suggestion', lines: [] },
    ])
    expect(hasSuggestionBlock('```ts\nconst suggestion = 1\n```')).toBe(false)
  })

  it('names the lines of single and multi-line comments', () => {
    const base = { newPath: 'src/a.ts' }
    expect(positionLabel({ ...base, newLine: 12 })).toBe('src/a.ts:12')
    expect(positionLabel({ ...base, lineRange: { end: { newLine: 15 }, start: { newLine: 12, oldLine: 11 } }, newLine: 15 })).toBe('src/a.ts:12〜15')
    expect(positionLines({ lineRange: { end: { newLine: 13 }, start: { oldLine: 11 } }, newLine: 13 })).toBe('−11〜13')
    expect(positionLines({ oldLine: 4 })).toBe('4')
  })
})
