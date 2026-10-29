export type MarkdownFormat =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'quote'
  | 'code'
  | 'link'
  | 'bulletList'
  | 'numberedList'
  | 'taskList'
  | 'table'

/** Replaces `value[start, end)` with `text`; the selection is in the resulting value. */
export interface MarkdownEdit {
  end: number
  selectionEnd: number
  selectionStart: number
  start: number
  text: string
}

const LIST_PREFIX = /^([-*+] \[[ xX]\] |[-*+] |\d+\. )/
const TABLE = '| header | header |\n| ------ | ------ |\n|        |        |\n|        |        |'

/** Applies a GitLab-style toolbar format to the selection; applying it again removes it where possible. */
export function formatMarkdown(value: string, selectionStart: number, selectionEnd: number, format: MarkdownFormat): MarkdownEdit {
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  switch (format) {
    case 'bold': return wrap(value, start, end, '**')
    case 'italic': return wrap(value, start, end, '_')
    case 'strikethrough': return wrap(value, start, end, '~~')
    case 'code': {
      const selected = value.slice(start, end)
      if (!selected.includes('\n')) return selected.includes('`') ? inlineCode(value, start, end) : wrap(value, start, end, '`')
      // A fence longer than any backtick run inside, so a fence in the selection does not close it.
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(selected) + 1))
      return block(value, start, end, `${fence}\n${selected}\n${fence}`, fence.length + 1, selected.length)
    }
    case 'link': return link(value, start, end)
    case 'heading': return prefixLines(value, start, end, () => '### ', /^#{1,6} /)
    case 'quote': return prefixLines(value, start, end, () => '> ', /^> ?/)
    case 'bulletList': return prefixLines(value, start, end, () => '- ', /^[-*+] (?!\[[ xX]\] )/, true)
    case 'numberedList': return prefixLines(value, start, end, (index) => `${index + 1}. `, /^\d+\. /, true)
    case 'taskList': return prefixLines(value, start, end, () => '- [ ] ', /^[-*+] \[[ xX]\] /, true)
    case 'table': return block(value, start, end, TABLE, 2, 6)
  }
}

function wrap(value: string, rawStart: number, rawEnd: number, marker: string): MarkdownEdit {
  // Like GitLab, surrounding whitespace in the selection stays outside the markers.
  let start = rawStart
  let end = rawEnd
  while (start < end && /\s/.test(value[start])) start += 1
  while (end > start && /\s/.test(value[end - 1])) end -= 1
  const selected = value.slice(start, end)
  if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, selected.length - marker.length)
    return { end, selectionEnd: start + inner.length, selectionStart: start, start, text: inner }
  }
  if (start >= marker.length && value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker) {
    const outer = start - marker.length
    return { end: end + marker.length, selectionEnd: outer + selected.length, selectionStart: outer, start: outer, text: selected }
  }
  const inner = start + marker.length
  return { end, selectionEnd: inner + selected.length, selectionStart: inner, start, text: `${marker}${selected}${marker}` }
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length))
}

/**
 * Inline code around a selection holding backticks: the delimiter is one backtick longer than the longest run
 * inside, with a space on a side that starts or ends with a backtick. Selected inline code is unwrapped.
 */
function inlineCode(value: string, rawStart: number, rawEnd: number): MarkdownEdit {
  let start = rawStart
  let end = rawEnd
  while (start < end && /\s/.test(value[start])) start += 1
  while (end > start && /\s/.test(value[end - 1])) end -= 1
  const selected = value.slice(start, end)
  const wrapped = /^(`+)( ?)([\s\S]*?)\2\1$/u.exec(selected)
  if (wrapped && wrapped[3] && longestBacktickRun(wrapped[3]) < wrapped[1].length) {
    return { end, selectionEnd: start + wrapped[3].length, selectionStart: start, start, text: wrapped[3] }
  }
  const marker = '`'.repeat(longestBacktickRun(selected) + 1)
  const padding = selected.startsWith('`') || selected.endsWith('`') ? ' ' : ''
  const inner = start + marker.length + padding.length
  return { end, selectionEnd: inner + selected.length, selectionStart: inner, start, text: `${marker}${padding}${selected}${padding}${marker}` }
}

function link(value: string, start: number, end: number): MarkdownEdit {
  const selected = value.slice(start, end)
  if (/^https?:\/\/\S+$/i.test(selected)) {
    return { end, selectionEnd: start + 5, selectionStart: start + 1, start, text: `[text](${selected})` }
  }
  const label = selected || 'text'
  const url = start + label.length + 3
  return selected
    ? { end, selectionEnd: url + 3, selectionStart: url, start, text: `[${label}](url)` }
    : { end, selectionEnd: start + 1 + label.length, selectionStart: start + 1, start, text: `[${label}](url)` }
}

/** Inserts a block on its own lines, separated from surrounding text by a blank line. */
function block(value: string, start: number, end: number, body: string, selectFrom: number, selectLength: number): MarkdownEdit {
  const before = start === 0 || value.slice(start - 2, start) === '\n\n' ? '' : value[start - 1] === '\n' ? '\n' : '\n\n'
  const after = end === value.length || value[end] === '\n' ? '' : '\n'
  const selection = start + before.length + selectFrom
  return { end, selectionEnd: selection + selectLength, selectionStart: selection, start, text: `${before}${body}${after}` }
}

function prefixLines(value: string, start: number, end: number, prefix: (index: number) => string, pattern: RegExp, list = false): MarkdownEdit {
  // lastIndexOf would read -1 as 0 and find a newline the text starts with.
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const lastChar = end > start && value[end - 1] === '\n' ? end - 1 : end
  const newline = value.indexOf('\n', lastChar)
  const lineEnd = newline === -1 ? value.length : newline
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const targets = lines.length > 1 ? lines.filter((line) => line.trim()) : lines
  const remove = targets.length > 0 && targets.every((line) => pattern.test(line))
  let index = 0
  const next = lines.map((line) => {
    if (remove) return line.replace(pattern, '')
    if (lines.length > 1 && !line.trim()) return line
    const content = list ? line.replace(LIST_PREFIX, '') : line
    return `${prefix(index++)}${content}`
  })
  const text = next.join('\n')
  if (start === end) {
    // Keep the caret at the same place in the text it was in.
    const caret = Math.max(lineStart + next[0].length - (lines[0].length - (start - lineStart)), lineStart)
    return { end: lineEnd, selectionEnd: caret, selectionStart: caret, start: lineStart, text }
  }
  return { end: lineEnd, selectionEnd: lineStart + text.length, selectionStart: lineStart, start: lineStart, text }
}
