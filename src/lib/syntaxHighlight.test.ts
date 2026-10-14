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

  it('recognises build and script files outside the common language set', () => {
    expect(languageForPath('Jenkinsfile')).toBe('groovy')
    expect(languageForPath('ci/Jenkinsfile.release')).toBe('groovy')
    expect(languageForPath('pipelines/deploy.jenkinsfile')).toBe('groovy')
    expect(languageForPath('docker/Dockerfile.dev')).toBe('dockerfile')
    expect(languageForPath('CMakeLists.txt')).toBe('cmake')
    expect(languageForPath('Gemfile.lock')).toBeNull()
    expect(languageForPath('scripts/build.ps1')).toBe('ps1')
    expect(languageForPath('tools/run.bat')).toBe('bat')
    expect(languageForPath('build.gradle')).toBe('gradle')
    expect(languageForPath('app.properties')).toBe('properties')
    expect(languageForPath('.editorconfig')).toBe('ini')
  })

  it('colours Jenkinsfile pipelines as Groovy', () => {
    const tokens = highlightLines(["def image = 'app'", 'pipeline { agent any }'], languageForPath('Jenkinsfile'))

    expect(tokens[0][0]).toEqual({ className: 'hljs-keyword', text: 'def' })
    expect(tokens[0]).toContainEqual({ className: 'hljs-string', text: "'app'" })
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
