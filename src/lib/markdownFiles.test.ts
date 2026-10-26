import { describe, expect, it } from 'vitest'
import { isMarkdownFilePath } from './markdownFiles'

describe('Markdown path detection', () => {
  it('supports Markdown extensions in every case', () => {
    for (const path of ['README.md', 'notes/decision.MD', 'docs/design.markdown', 'docs/spec.mdown']) {
      expect(isMarkdownFilePath(path)).toBe(true)
    }
  })
  it('does not classify unrelated files as Markdown', () => {
    for (const path of ['src/code.ts', 'assets/report.txt', 'src/md', 'README.md.bak', '', undefined]) {
      expect(isMarkdownFilePath(path)).toBe(false)
    }
  })
})
