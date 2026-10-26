import { describe, expect, it } from 'vitest'
import { parseDiff } from './diffParser'
import { markdownDiffChanges } from './markdownDiff'

const parse = (diff: string) => {
  const parsed = parseDiff(diff, 'docs/README.md', 'docs/README.md')
  expect(parsed.status).toBe('valid')
  return markdownDiffChanges(parsed.lines)
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
})
