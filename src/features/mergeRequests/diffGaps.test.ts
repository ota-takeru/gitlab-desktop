import { describe, expect, it } from 'vitest'

import { diffGaps, gapLines } from './diffGaps'
import { parseDiff } from './diffParser'

const gapsOf = (diff: string) => diffGaps(parseDiff(diff, 'a.ts', 'a.ts').lines, 0).filter((gap) => gap.count > 0)

describe('diffGaps', () => {
  it('places hidden lines on both sides from the context next to the gap', () => {
    expect(gapsOf('@@ -3,2 +3,3 @@\n a\n-b\n+c\n+c2\n@@ -20,1 +21,2 @@\n d\n+e\n').map(({ count, start }) => ({ count, start }))).toEqual([
      { count: 2, start: { newLine: 1, oldLine: 1 } },
      { count: 15, start: { newLine: 6, oldLine: 5 } },
    ])
  })

  it('places a gap before a hunk without context lines', () => {
    // Without context the hunk starts with a removed line; the previous context gives the offset.
    expect(gapsOf('@@ -1,2 +1,3 @@\n a\n+x\n b\n@@ -10 +11,0 @@\n-gone\n').map(({ count, start }) => ({ count, start }))).toEqual([
      { count: 7, start: { newLine: 4, oldLine: 3 } },
    ])
  })

  it('reads the hidden lines and refuses a file that does not match the diff', () => {
    const [gap] = gapsOf('@@ -3 +3 @@\n-old\n+new\n')
    expect(gapLines('one\ntwo\nnew\n', gap, 600)?.map((line) => [line.oldLine, line.newLine, line.text, line.commentable])).toEqual([[1, 1, 'one', false], [2, 2, 'two', false]])
    expect(gapLines('one\ntwo\nother\n', gap, 600)).toBeNull()
    expect(gapLines('one\n', gap, 600)).toBeNull()
    expect(gapLines('one\ntwo\nnew\n', gap, 1)).toHaveLength(1)
  })
})
