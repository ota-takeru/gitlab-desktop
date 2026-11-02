import { describe, expect, it } from 'vitest'
import { parseDiff } from './diffParser'
import { markdownDiffChanges, markdownDiffNeedsFile } from './markdownDiff'

const parse = (diff: string, content?: string) => {
  const parsed = parseDiff(diff, 'docs/README.md', 'docs/README.md')
  expect(parsed.status).toBe('valid')
  return markdownDiffChanges(parsed.lines, content === undefined ? undefined : { content, diffLines: parsed.lines })
}

describe('Markdown preview of changed hunks', () => {
  it('contains only edited text, without unchanged document context', () => {
    const changes = parse('@@ -1,5 +1,5 @@\n # Heading\n unchanged introduction\n-## Old title\n+## **New title**\n unchanged tail\n context ending\n')
    expect(changes).toHaveLength(1)
    expect(changes[0].old).toEqual({ firstLine: 3, lastLine: 3, text: '## Old title' })
    expect(changes[0].new).toEqual({ firstLine: 3, lastLine: 3, text: '## **New title**' })
    expect(JSON.stringify(changes)).not.toContain('unchanged')
  })

  it('keeps consecutive list changes as one Markdown fragment per side and separates hunks', () => {
    const changes = parse('@@ -10,3 +10,4 @@\n context\n-- item old\n+- item new\n+- **another item**\n next\n@@ -30,2 +31,2 @@\n-# Before\n+# After\n context\n')
    expect(changes).toHaveLength(2)
    expect(changes[0].old).toMatchObject({ firstLine: 11, lastLine: 11, text: '- item old' })
    expect(changes[0].new).toMatchObject({ firstLine: 11, lastLine: 12, text: '- item new\n- **another item**' })
    expect(changes[1].old?.text).toBe('# Before')
    expect(changes[1].new?.text).toBe('# After')
  })

  it('handles added-only and removed-only hunks and no changes', () => {
    const added = parse('@@ -0,0 +1,2 @@\n+# Title\n+**new text**\n')
    expect(added[0].old).toBeNull()
    expect(added[0].new?.text).toBe('# Title\n**new text**')
    const removed = parse('@@ -1,1 +0,0 @@\n-# Removed\n')
    expect(removed[0].new).toBeNull()
    expect(removed[0].old?.text).toBe('# Removed')
    expect(markdownDiffChanges([])).toEqual([])
  })

  it('keeps the header and delimiter rows of a table read from the whole file', () => {
    const content = '# Table\n\n| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n| c | 3 |\n| d | 4 |\n| e | 50 |\n'
    const changes = parse('@@ -6,4 +6,4 @@\n | b | 2 |\n | c | 3 |\n | d | 4 |\n-| e | 5 |\n+| e | 50 |\n', content)
    expect(changes[0].old).toEqual({ firstLine: 9, lastLine: 9, text: '| Name | Value |\n| --- | --- |\n| e | 5 |' })
    expect(changes[0].new).toEqual({ firstLine: 9, lastLine: 9, text: '| Name | Value |\n| --- | --- |\n| e | 50 |' })
  })

  it('reopens and closes the fence around an edit inside a code block', () => {
    const content = 'Intro\n\n```ts\nconst a = 1\nconst b = 2\nconst c = 3\n# not a heading\nconst d = 4\n```\n'
    const changes = parse('@@ -5,4 +5,4 @@\n const b = 2\n const c = 3\n-# old comment\n+# not a heading\n const d = 4\n', content)
    expect(changes[0].new?.text).toBe('```ts\n# not a heading\n```')
    expect(changes[0].old?.text).toBe('```ts\n# old comment\n```')
    const opened = parse('@@ -1,1 +1,3 @@\n Intro\n+```sh\n+npm test\n')
    expect(opened[0].new?.text).toBe('```sh\nnpm test\n```')
  })

  it('reads lines indented under a list item at the list level', () => {
    const changes = parse('@@ -1,3 +1,3 @@\n - parent\n-    - old child\n+    - new child\n - next\n')
    expect(changes[0].new?.text).toBe('- new child')
    expect(changes[0].old?.text).toBe('- old child')
    const code = parse('@@ -1,3 +1,3 @@\n Paragraph\n \n-    old code\n+    new code\n')
    expect(code[0].new?.text).toBe('    new code')
  })

  it('rebuilds the old file around earlier hunks and ignores a file that does not match the diff', () => {
    const content = '| A |\n| - |\n| x |\n| added |\n| y |\n| z |\n| w |\n| v |\n| u2 |\n'
    const diff = '@@ -1,3 +1,4 @@\n | A |\n | - |\n | x |\n+| added |\n@@ -6,3 +7,3 @@\n | w |\n | v |\n-| u |\n+| u2 |\n'
    const changes = parse(diff, content)
    expect(changes[1].old).toEqual({ firstLine: 8, lastLine: 8, text: '| A |\n| - |\n| u |' })
    expect(changes[1].new).toEqual({ firstLine: 9, lastLine: 9, text: '| A |\n| - |\n| u2 |' })
    const stale = parse(diff, content.replace('| v |', '| other |'))
    expect(stale[1].new?.text).toBe('| u2 |')
  })

  it('reads the whole file only when the diff does not show the structure an edit is in', () => {
    const needs = (diff: string) => {
      const parsed = parseDiff(diff, 'docs/README.md', 'docs/README.md')
      return parsed.status === 'valid' && markdownDiffNeedsFile(parsed.lines)
    }
    expect(needs('@@ -1,1 +1,1 @@\n-# Previous\n+# Next\n')).toBe(false)
    expect(needs('@@ -10,2 +10,2 @@\n Some text\n-old sentence\n+new sentence\n')).toBe(false)
    expect(needs('@@ -10,3 +10,3 @@\n | Name | Value |\n | --- | --- |\n-| a | 1 |\n+| a | 2 |\n')).toBe(false)
    expect(needs('@@ -10,2 +10,2 @@\n | b | 2 |\n-| a | 1 |\n+| a | 2 |\n')).toBe(true)
    expect(needs('@@ -10,2 +10,2 @@\n const a = 1\n-```\n+~~~\n')).toBe(true)
    expect(needs('@@ -10,1 +10,1 @@\n-  - old child\n+  - new child\n')).toBe(true)
  })
})
