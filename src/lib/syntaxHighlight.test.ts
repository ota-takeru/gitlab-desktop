import { describe, expect, it } from 'vitest'

import { highlightLines, languageForPath } from './syntaxHighlight'

describe('syntaxHighlight', () => {
  it('picks the language from the file extension', () => {
    expect(languageForPath('src/app/main.tsx')).toBe('tsx')
    expect(languageForPath('Views/Home.cshtml')).toBe('xml')
    expect(languageForPath('db/proc.sql')).toBe('sql')
    expect(languageForPath('LICENSE')).toBeNull()
    expect(languageForPath('notes.unknownext')).toBeNull()
  })

  it('keeps one token list per line and colours comments that span lines', () => {
    const lines = ['const a = 1 /* start', 'still comment */', 'return a']
    const tokens = highlightLines(lines, 'typescript')

    expect(tokens).toHaveLength(3)
    expect(tokens.map((line) => line.map((token) => token.text).join(''))).toEqual(lines)
    expect(tokens[0][0]).toEqual({ className: 'hljs-keyword', text: 'const' })
    expect(tokens[1]).toEqual([{ className: 'hljs-comment', text: 'still comment */' }])
  })

  it('returns plain text for unknown languages', () => {
    expect(highlightLines(['a', ''], null)).toEqual([[{ text: 'a' }], [{ text: '' }]])
  })
})
