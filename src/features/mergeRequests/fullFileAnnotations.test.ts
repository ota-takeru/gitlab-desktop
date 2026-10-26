import { describe, expect, it } from 'vitest'
import { annotateFullFile, filePageStart, firstChangedFileLine } from './fullFileAnnotations'
import { parseDiff } from './diffParser'

const parse = (diff: string) => {
  const parsed = parseDiff(diff, 'docs/review.md', 'docs/review.md')
  expect(parsed.status).toBe('valid')
  return parsed.lines
}

describe('whole-file change annotations', () => {
  it('colors added lines and shows removed lines before their replacement', () => {
    const lines = parse('@@ -3,3 +3,3 @@\n pre\n-## Old\n+## New\n post\n')
    const annotations = annotateFullFile(lines, 'a\nb\npre\n## New\npost')
    expect(annotations.consistent).toBe(true)
    expect([...annotations.addedLines]).toEqual([4])
    expect(annotations.removedByAnchor.get(4)).toEqual([{ anchorLine: 4, oldStart: 4, oldEnd: 4, text: '## Old' }])
  })

  it('places a removal-only change before the next surviving line', () => {
    const lines = parse('@@ -4,3 +4,1 @@\n-away1\n-away2\n keep\n')
    const annotations = annotateFullFile(lines, 'a\nb\nc\nkeep')
    expect(annotations.consistent).toBe(true)
    expect(annotations.removedByAnchor.get(4)?.[0]).toMatchObject({ oldStart: 4, oldEnd: 5, text: 'away1\naway2' })
    expect(firstChangedFileLine(lines)).toBe(4)
  })

  it('supports insertions past a thousand lines and anchors the appropriate page', () => {
    const lines = parse('@@ -1200,0 +1201 @@\n+**important**\n')
    const content = [...Array.from({length:1200},(_,i)=>String(i)), '**important**'].join('\n')
    const annotations = annotateFullFile(lines, content)
    expect(annotations.addedLines.has(1201)).toBe(true)
    expect(filePageStart(firstChangedFileLine(lines),1201,1000)).toBe(1000)
    expect(filePageStart(2040,2040,1000)).toBe(2000)
  })

  it('never highlights new-side lines if the file content does not match the diff', () => {
    const lines = parse('@@ -1 +1 @@\n-old\n+new\n')
    expect(annotateFullFile(lines, 'different').consistent).toBe(false)
  })

  it('puts deletions at end of file after the final surviving line', () => {
    const lines = parse('@@ -1,2 +1 @@\n keep\n-remove\n')
    const result = annotateFullFile(lines,'keep')
    expect(result.removedByAnchor.get(2)?.[0].text).toBe('remove')
  })
})
