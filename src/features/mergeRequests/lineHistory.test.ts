import { describe, expect, it } from 'vitest'

import type { BlameBlock, Diff } from '../../types/gitlab'
import { parseDiff } from './diffParser'
import { findAddedRun, historySegments, historyStep, rangeBeforeCommit } from './lineHistory'

const parsed = (diff: string) => parseDiff(diff, 'a.ts', 'a.ts')
const sha = (char: string) => char.repeat(40)
const diffOf = (diff: string, extra: Partial<Diff> = {}): Diff => ({ collapsed: false, deletedFile: false, diff, newFile: false, newPath: 'a.ts', oldPath: 'a.ts', renamedFile: false, tooLarge: false, ...extra })
const block = (commitId: string, committedAt: string, lines: string[], parentIds?: string[]): BlameBlock => ({ authorName: 'A', commitId, committedAt, lines, title: commitId, ...(parentIds ? { parentIds } : {}) })

describe('rangeBeforeCommit', () => {
  // Line 2 of the parent became three lines (2-4); three lines were added after the old line 9.
  const change = parsed([
    '@@ -1,3 +1,5 @@',
    ' one',
    '-two',
    '+two a',
    '+two b',
    '+two c',
    ' three',
    '@@ -8,2 +10,5 @@',
    ' eight',
    ' nine',
    '+x',
    '+y',
    '+z',
  ].join('\n'))

  it('moves unchanged lines by the lines added or removed above them', () => {
    expect(rangeBeforeCommit(change.lines, change.hunks!, { start: 6, end: 8 })).toEqual({ start: 4, end: 6 })
  })

  it('takes in every line a change replaced when it touches the range', () => {
    expect(rangeBeforeCommit(change.lines, change.hunks!, { start: 3, end: 5 })).toEqual({ start: 2, end: 3 })
    expect(rangeBeforeCommit(change.lines, change.hunks!, { start: 1, end: 2 })).toEqual({ start: 1, end: 2 })
  })

  it('ends when the commit added every line of the range', () => {
    expect(rangeBeforeCommit(change.lines, change.hunks!, { start: 12, end: 14 })).toBeNull()
  })

  it('keeps lines a commit deleted inside the range', () => {
    const deletion = parsed(['@@ -4,4 +4,2 @@', ' four', '-five', '-six', ' seven'].join('\n'))
    expect(rangeBeforeCommit(deletion.lines, deletion.hunks!, { start: 4, end: 5 })).toEqual({ start: 4, end: 7 })
    expect(rangeBeforeCommit(deletion.lines, deletion.hunks!, { start: 5, end: 6 })).toEqual({ start: 7, end: 8 })
  })
})

describe('findAddedRun', () => {
  it('finds consecutive added lines nearest to the expected place', () => {
    const lines = parsed(['@@ -1,0 +1,2 @@', '+}', '+end', '@@ -20,0 +23,2 @@', '+}', '+end'].join('\n')).lines
    expect(findAddedRun(lines, ['}', 'end'], 20)).toBe(23)
    expect(findAddedRun(lines, ['}', 'end'], 3)).toBe(1)
    expect(findAddedRun(lines, ['missing'], 3)).toBeNull()
  })
})

describe('historySegments', () => {
  it('keeps only the hunks that change the followed lines, with a little context', () => {
    const diff = parsed(['@@ -1,6 +1,6 @@', ' a', ' b', ' c', ' d', '-e', '+E', '@@ -40,2 +40,2 @@', '-x', '+X', ' y'].join('\n'))
    const segments = historySegments(diff.lines, { start: 5, end: 5 }, { start: 5, end: 5 })
    expect(segments).toHaveLength(1)
    expect(segments[0].map((line) => line.text)).toEqual(['b', 'c', 'd', 'e', 'E'])
  })
})

describe('historyStep', () => {
  it('locates the range in the newest commit by its own lines and follows it to the parent and old path', async () => {
    // At the cursor revision the range 10-12 holds a line commit c wrote at line 8 of b.ts (renamed from a.ts).
    const blame = async () => [block('old', '2026-01-01T00:00:00Z', ['keep']), block(sha('c'), '2026-05-01T00:00:00Z', ['new line'], [sha('p')]), block('old', '2026-01-01T00:00:00Z', ['tail'])]
    const commitDiff = async (commit: string, page: number) => commit === sha('c') && page === 1
      ? [diffOf(['@@ -7,3 +7,3 @@', ' keep', '-old line', '+new line', ' tail'].join('\n'), { newPath: 'b.ts', oldPath: 'a.ts', renamedFile: true })]
      : []
    const step = await historyStep({ path: 'c.ts', range: { start: 10, end: 12 }, sha: sha('h') }, { blame, commitDiff })
    expect(step).toMatchObject({
      before: { start: 7, end: 9 },
      next: { path: 'a.ts', range: { start: 7, end: 9 }, sha: sha('p') },
      path: 'b.ts',
      range: { start: 7, end: 9 },
    })
    expect('stop' in step && step.stop).toBeFalsy()
  })

  it('stops where the lines were added, or the file created, or the history begins', async () => {
    const blame = async () => [block(sha('c'), '2026-05-01T00:00:00Z', ['a', 'b'], [sha('p')])]
    const added = await historyStep({ path: 'a.ts', range: { start: 3, end: 4 }, sha: sha('h') }, { blame, commitDiff: async () => [diffOf(['@@ -2,0 +3,2 @@', '+a', '+b'].join('\n'))] })
    expect(added).toMatchObject({ before: null, next: null, stop: 'added' })
    const created = await historyStep({ path: 'a.ts', range: { start: 1, end: 2 }, sha: sha('h') }, { blame, commitDiff: async () => [diffOf(['@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'), { newFile: true })] })
    expect(created).toMatchObject({ next: null, stop: 'created' })
    const root = await historyStep({ path: 'a.ts', range: { start: 1, end: 2 }, sha: sha('h') }, {
      blame: async () => [block(sha('c'), '2026-05-01T00:00:00Z', ['a', 'b'], [])],
      commitDiff: async () => [diffOf(['@@ -1,2 +1,2 @@', '-x', '-y', '+a', '+b'].join('\n'))],
    })
    expect(root).toMatchObject({ before: { start: 1, end: 2 }, next: null, stop: 'root' })
  })

  it('reports what it cannot follow', async () => {
    const blame = async () => [block(sha('c'), '2026-05-01T00:00:00Z', ['a'], [sha('p')])]
    expect(await historyStep({ path: 'a.ts', range: { start: 1, end: 500 }, sha: sha('h') }, { blame, commitDiff: async () => [] })).toEqual({ stop: 'tooWide' })
    expect(await historyStep({ path: 'a.ts', range: { start: 1, end: 1 }, sha: sha('h') }, { blame, commitDiff: async () => [diffOf('', { tooLarge: true })] })).toEqual({ stop: 'unavailable' })
    expect(await historyStep({ path: 'a.ts', range: { start: 1, end: 1 }, sha: sha('h') }, { blame, commitDiff: async () => [diffOf(['@@ -1 +1 @@', '-x', '+other'].join('\n'))] })).toEqual({ stop: 'unmatched' })
  })

  it('reads a wide range in blame calls of at most 100 lines', async () => {
    const calls: [number, number][] = []
    const blame = async (_sha: string, _path: string, start: number, end: number) => {
      calls.push([start, end])
      return [block(sha('c'), '2026-05-01T00:00:00Z', Array.from({ length: end - start + 1 }, (_, index) => `l${start + index}`), [sha('p')])]
    }
    await historyStep({ path: 'a.ts', range: { start: 1, end: 250 }, sha: sha('h') }, { blame, commitDiff: async () => [] })
    expect(calls).toEqual([[1, 100], [101, 200], [201, 250]])
  })
})
