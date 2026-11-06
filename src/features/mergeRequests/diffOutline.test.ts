import { describe, expect, it } from 'vitest'

import { diffOutline, outlineEntryAt } from './diffOutline'
import { parseDiff } from './diffParser'

const outlineOf = (diff: string, markdown = false) => {
  const parsed = parseDiff(diff, 'a.ts', 'a.ts')
  return diffOutline(parsed.lines, parsed.hunks ?? [], markdown)
}

describe('diffOutline', () => {
  it('names a hunk by the section Git found, or else by its first change', () => {
    const { entries } = outlineOf('@@ -1,2 +1,2 @@ function top()\n a\n-b\n+c\n@@ -9,1 +9,2 @@\n d\n+added line\n')
    expect(entries.map(({ kind, label, line, counts }) => ({ counts, kind, label, line }))).toEqual([
      { counts: { added: 1, removed: 1 }, kind: 'hunk', label: 'function top()', line: 1 },
      { counts: { added: 1, removed: 0 }, kind: 'hunk', label: 'added line', line: 9 },
    ])
  })

  it('lists the definitions inside one long hunk, with their change and nesting', () => {
    const { entries } = outlineOf('@@ -1,3 +1,5 @@\n const n = 1\n+export class Foo {\n+  private bar(x: number) {\n-def gone():\n ok()\n+export const run = async () => {}\n')
    const definitions = entries.filter((entry) => entry.kind === 'definition')
    expect(definitions.map(({ label, lineKind, nested }) => ({ label, lineKind, nested }))).toEqual([
      { label: 'bar(x: number)', lineKind: 'add', nested: true },
      { label: 'def gone():', lineKind: 'remove', nested: false },
      { label: 'const run = async () => {}', lineKind: 'add', nested: false },
    ])
    // The hunk is already named after its first change, the class.
    expect(entries[0]).toMatchObject({ kind: 'hunk', label: 'class Foo' })
  })

  it('recognises SQL objects whatever their case', () => {
    const { entries } = outlineOf('@@ -0,0 +1,3 @@\n+-- notes\n+CREATE OR ALTER PROCEDURE dbo.Run\n+select 1\n')
    expect(entries.map((entry) => entry.label)).toContain('CREATE OR ALTER PROCEDURE dbo.Run')
  })

  it('uses headings, not code patterns, for Markdown', () => {
    const { entries } = outlineOf('@@ -0,0 +1,3 @@\n+intro\n+## Usage ##\n+class of things\n', true)
    expect(entries.map((entry) => entry.label)).toEqual(['intro', 'Usage'])
  })

  it('does not treat a call or a mention as a definition', () => {
    const { entries } = outlineOf('@@ -1,4 +1,4 @@\n foo()\n // function old\n module.exports = run\n-x\n+y\n')
    expect(entries.filter((entry) => entry.kind === 'definition')).toEqual([])
  })

  it('keeps the top level and says how many it left out of a very long list', () => {
    const body = Array.from({ length: 400 }, (_, index) => `+  function inner${index}() {}\n+function outer${index}() {}\n`).join('')
    const { entries, omitted } = outlineOf(`@@ -0,0 +1,800 @@\n${body}`)
    expect(entries).toHaveLength(300)
    expect(entries.every((entry) => !entry.nested)).toBe(true)
    // The first definition names the hunk, so it is not listed twice: 1 hunk and 799 definitions.
    expect(omitted).toBe(800 - 300)
  })

  it('points a removed line at the next line of the new side, for rendered Markdown', () => {
    const { entries } = outlineOf('@@ -1,2 +1,2 @@\n-# Old\n+# New\n same\n', true)
    expect(entries.find((entry) => entry.label === 'Old')?.anchorLine).toBe(1)
    expect(entries.find((entry) => entry.label === 'New')?.anchorLine).toBe(1)
    expect(outlineOf('@@ -8,2 +8,1 @@\n same\n-# End\n', true).entries[0].anchorLine).toBeNull()
  })

  it('finds the entry at a place in the file', () => {
    const { entries } = outlineOf('@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n')
    expect(outlineEntryAt(entries, 0, 'lineIndex')).toBe(0)
    expect(outlineEntryAt(entries, 1, 'lineIndex')).toBe(0)
    expect(outlineEntryAt(entries, 2, 'lineIndex')).toBe(1)
    expect(outlineEntryAt(entries, 0, 'anchorLine')).toBe(-1)
    expect(outlineEntryAt(entries, 100, 'anchorLine')).toBe(1)
  })

  it('passes over an entry with no new-side line when finding the entry at a place', () => {
    const { entries } = outlineOf('@@ -1 +1 @@\n-a\n+b\n@@ -9,2 +9 @@\n same\n-c\n', true)
    expect(entries[1].anchorLine).toBeNull()
    expect(outlineEntryAt(entries, 100, 'anchorLine')).toBe(0)
  })
})
