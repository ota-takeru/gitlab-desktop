import { describe, expect, it } from 'vitest'

import { formatMarkdown, type MarkdownFormat } from './markdownFormat'

/** Applies a format to `value`, where `«` and `»` mark the selection, and returns the result marked the same way. */
function apply(marked: string, format: MarkdownFormat) {
  const start = marked.indexOf('«')
  const end = marked.indexOf('»') - 1
  const value = marked.replace('«', '').replace('»', '')
  const edit = formatMarkdown(value, start, end, format)
  const next = `${value.slice(0, edit.start)}${edit.text}${value.slice(edit.end)}`
  return `${next.slice(0, edit.selectionStart)}«${next.slice(edit.selectionStart, edit.selectionEnd)}»${next.slice(edit.selectionEnd)}`
}

describe('formatMarkdown', () => {
  it('wraps the selection and removes the same markers when applied again', () => {
    expect(apply('a «word» b', 'bold')).toBe('a **«word»** b')
    expect(apply('a **«word»** b', 'bold')).toBe('a «word» b')
    expect(apply('a «**word**» b', 'bold')).toBe('a «word» b')
    expect(apply('«word»', 'italic')).toBe('_«word»_')
    expect(apply('«word»', 'strikethrough')).toBe('~~«word»~~')
    expect(apply('«word»', 'code')).toBe('`«word»`')
  })

  it('inserts empty markers at the caret and keeps whitespace outside them', () => {
    expect(apply('a «»b', 'bold')).toBe('a **«»**b')
    expect(apply('a **«»**b', 'bold')).toBe('a «»b')
    expect(apply('«word »next', 'bold')).toBe('**«word»** next')
  })

  it('turns a multi-line selection into a fenced code block on its own lines', () => {
    expect(apply('see «a\nb» here', 'code')).toBe('see \n\n```\n«a\nb»\n```\n here')
  })

  it('builds links from text or from a selected URL', () => {
    expect(apply('«docs»', 'link')).toBe('[docs](«url»)')
    expect(apply('«https://gitlab.com»', 'link')).toBe('[«text»](https://gitlab.com)')
    expect(apply('«»', 'link')).toBe('[«text»](url)')
  })

  it('toggles line prefixes on every selected line', () => {
    expect(apply('one\n«two\nthree»', 'quote')).toBe('one\n«> two\n> three»')
    expect(apply('«> two\n> three»', 'quote')).toBe('«two\nthree»')
    expect(apply('«a\n\nb»', 'numberedList')).toBe('«1. a\n\n2. b»')
    expect(apply('ti«»tle', 'heading')).toBe('### ti«»tle')
    expect(apply('### ti«»tle', 'heading')).toBe('ti«»tle')
  })

  it('switches between list kinds instead of nesting their markers', () => {
    expect(apply('- [ ] «task»', 'bulletList')).toBe('«- task»')
    expect(apply('«- item»', 'taskList')).toBe('«- [ ] item»')
    expect(apply('«- [ ] item»', 'taskList')).toBe('«item»')
  })

  it('inserts a table separated from surrounding text', () => {
    const table = '| «header» | header |\n| ------ | ------ |\n|        |        |\n|        |        |'
    expect(apply('text«»', 'table')).toBe(`text\n\n${table}`)
    expect(apply('«»', 'table')).toBe(table)
  })

  it('wraps code holding backticks in a longer delimiter, and unwraps it again', () => {
    expect(apply('«a`b»', 'code')).toBe('``«a`b»``')
    expect(apply('«`a»', 'code')).toBe('`` «`a» ``')
    expect(apply('«`` `a ``»', 'code')).toBe('«`a»')
    expect(apply('«```\nx\n```»', 'code')).toBe('````\n«```\nx\n```»\n````')
  })

  it('formats the blank first line the caret is on', () => {
    expect(apply('«»\nbody', 'heading')).toBe('### «»\nbody')
  })
})
