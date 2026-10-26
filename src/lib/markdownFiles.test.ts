import { describe, expect, it } from 'vitest'
import { defaultFileViewForDiff, isMarkdownFilePath } from './markdownFiles'

describe('default Markdown presentation', () => {
  it('recognizes all supported extensions, not only README.md', () => {
    for (const path of ['README.md', 'notes/decision.MD', 'docs/design.markdown', 'docs/spec.mdown']) {
      expect(isMarkdownFilePath(path)).toBe(true)
    }
    for (const path of ['src/code.ts', 'assets/report.txt', 'src/md', 'README.md.bak']) {
      expect(isMarkdownFilePath(path)).toBe(false)
    }
  })
  it('starts readable Markdown diffs as rendered files', () => {
    const base = { oldPath: 'README.md', newPath: 'README.md', deletedFile: false, collapsed: false, tooLarge: false }
    expect(defaultFileViewForDiff(base)).toBe('file')
    expect(defaultFileViewForDiff({ ...base, newPath: 'src/a.ts', oldPath: 'src/a.ts' })).toBe('diff')
    expect(defaultFileViewForDiff({ ...base, deletedFile: true })).toBe('diff')
    expect(defaultFileViewForDiff({ ...base, tooLarge: true })).toBe('diff')
    expect(defaultFileViewForDiff({ ...base, collapsed: true })).toBe('diff')
    expect(defaultFileViewForDiff(undefined)).toBe('diff')
  })
})
