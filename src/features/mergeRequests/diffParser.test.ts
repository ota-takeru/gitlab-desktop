import { parseDiff, splitFileLines } from './diffParser'

describe('parseDiff', () => {
  it('keeps header-looking additions and deletions inside a hunk', () => {
    const parsed = parseDiff([
      'diff --git a/src/変更.ts b/src/変更.ts',
      '--- a/src/変更.ts',
      '+++ b/src/変更.ts',
      '@@ -1,3 +1,5 @@ 関数',
      ' context',
      '-old',
      '+++ generated.ts',
      '+日本語',
      ' context after',
      '+末尾',
      '\\ No newline at end of file',
      '@@ -10,1 +12,1 @@ second hunk',
      '-old second',
      '+new second',
      '',
    ].join('\n'), 'src/変更.ts', 'src/変更.ts')

    expect(parsed.status).toBe('valid')
    expect(parsed.lines.map((line) => [line.kind, line.prefix, line.text])).toEqual([
      ['context', ' ', 'context'],
      ['remove', '-', 'old'],
      ['add', '+', '++ generated.ts'],
      ['add', '+', '日本語'],
      ['context', ' ', 'context after'],
      ['add', '+', '末尾'],
      ['remove', '-', 'old second'],
      ['add', '+', 'new second'],
    ])
    expect(parsed.lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [1, 1],
      [2, undefined],
      [undefined, 2],
      [undefined, 3],
      [3, 4],
      [undefined, 5],
      [10, undefined],
      [undefined, 12],
    ])
    expect(parsed.lines.every((line) => line.commentable)).toBe(true)
  })

  it('handles new, deleted, renamed, /dev/null and CRLF files without inventing a row', () => {
    const deleted = parseDiff('--- a/old.txt\r\n+++ /dev/null\r\n@@ -1,2 +0,0 @@\r\n-one\r\n-two\r\n', 'old.txt', '/dev/null')
    const added = parseDiff('--- /dev/null\r\n+++ b/new.txt\r\n@@ -0,0 +1,2 @@\r\n+one\r\n+two\r\n', '/dev/null', 'new.txt')
    const renamed = parseDiff('diff --git a/old.txt b/new.txt\r\n--- a/old.txt\r\n+++ b/new.txt\r\n@@ -4 +4 @@\r\n-old\r\n+new\r\n', 'old.txt', 'new.txt')

    expect(deleted.lines.map((line) => line.oldLine)).toEqual([1, 2])
    expect(deleted.lines.every((line) => line.newLine === undefined)).toBe(true)
    expect(added.lines.map((line) => line.newLine)).toEqual([1, 2])
    expect(added.lines.every((line) => line.oldLine === undefined)).toBe(true)
    expect(renamed.lines.map((line) => [line.oldPath, line.newPath, line.oldLine, line.newLine])).toEqual([
      ['old.txt', 'new.txt', 4, undefined],
      ['old.txt', 'new.txt', undefined, 4],
    ])
    expect(deleted.lines).toHaveLength(2)
    expect(added.lines).toHaveLength(2)
  })

  it('marks incomplete and malformed hunks as unsafe for comments', () => {
    const truncated = parseDiff('@@ -1,2 +1,2 @@\n-a\n+b\n', 'a', 'b')
    const malformed = parseDiff('@@ -1 +1 @@\n?not a diff line\n', 'a', 'b')
    const extra = parseDiff('@@ -1 +1 @@\n-a\n+b\n+extra\n', 'a', 'b')

    expect(truncated.status).toBe('truncated')
    expect(truncated.issue).toBe('truncated-hunk')
    expect(truncated.lines).toHaveLength(2)
    expect(truncated.lines.every((line) => !line.commentable)).toBe(true)
    expect(malformed.status).toBe('invalid')
    expect(malformed.issue).toBe('invalid-line')
    expect(malformed.lines).toHaveLength(0)
    expect(extra.status).toBe('invalid')
    expect(extra.issue).toBe('invalid-hunk')
    expect(extra.lines.every((line) => !line.commentable)).toBe(true)
  })

  it('does not treat metadata, a trailing split row, or file headers as content', () => {
    const parsed = parseDiff('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n', 'a', 'a')

    expect(parsed.status).toBe('valid')
    expect(parsed.lines).toHaveLength(2)
    expect(parsed.lines.some((line) => line.text === ' No newline at end of file')).toBe(false)
    expect(splitFileLines('一行\n')).toEqual(['一行'])
    expect(splitFileLines('一行\n\n')).toEqual(['一行', ''])
  })

  it('rejects malformed headers, zero record positions and unsafe integer ranges', () => {
    for (const header of ['@@ invalid @@', '@@ -0,1 +1,1 @@', '@@ -1,1 +0,1 @@', '@@ -9007199254740991,2 +1,2 @@']) {
      const parsed = parseDiff(`${header}\n-old\n+new\n`, 'a', 'b')
      expect(parsed.status).toBe('invalid')
      expect(parsed.lines).toHaveLength(0)
    }
  })
})
