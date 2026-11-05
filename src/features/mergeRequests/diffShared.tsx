import { type Theme } from '@mui/material/styles'
import { Fragment } from 'react'

import type { SyntaxToken } from '../../lib/syntaxHighlight'
import { gridLine } from '../../theme'
import type { Position } from '../../types/gitlab'
import type { ParsedLine } from './diffParser'

export const FILE_PAGE_SIZE = 1000

/** Rows without code (empty split cells, omitted lines): a tone that stays visible on the dark theme too. */
export function quietBand(theme: Theme): string {
  return theme.palette.mode === 'dark' && theme.palette.surface ? theme.palette.surface.list : theme.palette.action.hover
}

/** Styles shared by the unified and side-by-side layouts. */
export function diffBaseStyles(theme: Theme) {
  return {
    flex: 1,
    fontFamily: theme.typography.code?.fontFamily ?? 'monospace',
    fontSize: theme.typography.code?.fontSize ?? '0.8125rem',
    lineHeight: '20px',
    minWidth: 0,
    py: 0.5,
    '& .diff-action': { alignItems: 'center', backgroundColor: theme.palette.fill?.primary ?? theme.palette.primary.dark, border: 0, borderRadius: `${theme.shape.borderRadius}px`, color: theme.palette.fill?.primaryText ?? theme.palette.primary.contrastText, cursor: 'pointer', fontFamily: theme.typography.fontFamily, fontSize: theme.typography.body1.fontSize, fontWeight: 700, height: 16, lineHeight: '16px', opacity: 0, padding: 0, position: 'absolute', right: '3px', textAlign: 'center', top: 2, width: 20 },
    // The visible mark stays small to fit the 20px row; the hit area around it is 26×24px.
    '& .diff-action::before': { content: '""', inset: '-4px -3px', position: 'absolute' },
    '& .diff-action:hover': { backgroundColor: theme.palette.fill?.primaryHover ?? theme.palette.primary.dark },
    '& .diff-action:focus-visible': { opacity: 1, outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    ...syntaxStyles(theme),
    '& .diff-gap': { alignItems: 'center', backgroundColor: quietBand(theme), color: theme.palette.text.secondary, columnGap: '12px', display: 'flex', flexWrap: 'wrap', fontFamily: theme.typography.fontFamily, fontSize: theme.typography.caption.fontSize, lineHeight: gridLine(6), padding: '0 12px' },
    '& .diff-gap-toggle': { alignItems: 'center', background: 'none', border: 0, borderRadius: `${theme.shape.borderRadius}px`, color: theme.palette.primary.main, cursor: 'pointer', display: 'inline-flex', font: 'inherit', gap: '4px', margin: '0 -4px', padding: '0 4px' },
    '& .diff-gap-toggle:hover': { textDecoration: 'underline' },
    '& .diff-gap-toggle:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    '& .diff-gap-error': { color: theme.palette.error.main },
  }
}

/** Colours for highlight.js token classes. */
export function syntaxStyles(theme: Theme) {
  const syntax = theme.palette.syntax
  if (!syntax) return {}
  return {
    '& .hljs-keyword, & .hljs-doctag, & .hljs-template-tag, & .hljs-selector-tag': { color: syntax.keyword },
    '& .hljs-string, & .hljs-regexp, & .hljs-char': { color: syntax.string },
    '& .hljs-comment, & .hljs-quote': { color: syntax.comment, fontStyle: 'italic' },
    '& .hljs-number, & .hljs-literal, & .hljs-symbol, & .hljs-bullet, & .hljs-meta, & .hljs-link': { color: syntax.number },
    '& .hljs-title, & .hljs-section': { color: syntax.title },
    '& .hljs-type, & .hljs-built_in': { color: syntax.type },
    '& .hljs-attr, & .hljs-attribute, & .hljs-property, & .hljs-selector-attr, & .hljs-selector-class, & .hljs-selector-id': { color: syntax.attribute },
    '& .hljs-name, & .hljs-tag, & .hljs-selector-pseudo': { color: syntax.tag },
    '& .hljs-variable, & .hljs-template-variable': { color: syntax.variable },
  }
}

/**
 * The first whole-file line or rendered Markdown block on screen below `top`, with where it is.
 * One starting on screen is preferred to a block that starts above it, such as a list around it.
 */
export function firstVisibleFileLine(root: HTMLElement, top: number): { line: number; top: number } | null {
  const bottom = globalThis.innerHeight || 1000
  let partly: { line: number; top: number } | null = null
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-file-line], [data-source-start]'))) {
    const rect = node.getBoundingClientRect()
    const line = Number(node.dataset.fileLine ?? node.dataset.sourceStart)
    if (rect.bottom <= top + 2 || rect.top >= bottom - 2 || !Number.isSafeInteger(line) || line <= 0) continue
    // A row scrolled out of its table is not on screen, wherever its box lies.
    const table = node.closest('[data-table-scroll]')?.getBoundingClientRect()
    if (table && (rect.bottom <= table.top + 2 || rect.top >= table.bottom - 2)) continue
    if (rect.top >= top - 2) return { line, top: rect.top }
    partly ??= { line, top: rect.top }
  }
  return partly
}

export function scrollNearestBy(node: HTMLElement, delta: number) {
  // A row in a table that scrolls by itself comes up under the table's header first; the page then moves by what is left.
  const table = node.closest<HTMLElement>('[data-table-scroll]')
  if (table) {
    const before = node.getBoundingClientRect().top
    table.scrollTop += before - table.getBoundingClientRect().top - (table.querySelector('thead')?.getBoundingClientRect().height ?? 0)
    delta += node.getBoundingClientRect().top - before
  }
  if (!delta) return
  for (let parent = (table ?? node).parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) { parent.scrollTop += delta; return }
  }
  const page = document.scrollingElement ?? document.documentElement
  page.scrollTop += delta
}

export function matchesPosition(line: ParsedLine, position: Position | undefined): boolean {
  if (!position) return false
  const pathMatches = position.newPath === line.newPath || position.oldPath === line.oldPath
  if (!pathMatches) return false
  if (position.newLine !== undefined) return line.newLine === position.newLine
  if (position.oldLine !== undefined) return line.oldLine === position.oldLine
  return false
}

export function positionLineId(position: Pick<Position, 'newPath' | 'oldPath' | 'newLine' | 'oldLine'> | ParsedLine): string {
  return JSON.stringify([position.newPath, position.oldPath, position.oldLine ?? null, position.newLine ?? null])
}

/** Renders highlighted tokens, marking case-insensitive matches of `query` across token boundaries. */
export function renderCode(tokens: SyntaxToken[], query: string): React.ReactNode {
  const text = tokens.map((token) => token.text).join('')
  const matches: Array<[number, number]> = []
  if (query) {
    const normalizedText = text.toLocaleLowerCase()
    const normalizedQuery = query.toLocaleLowerCase()
    let match = normalizedText.indexOf(normalizedQuery)
    while (match >= 0) {
      matches.push([match, match + query.length])
      match = normalizedText.indexOf(normalizedQuery, match + query.length)
    }
  }
  if (matches.length === 0 && tokens.every((token) => !token.className)) return text
  let offset = 0
  return tokens.map((token, tokenIndex) => {
    const end = offset + token.text.length
    const parts: React.ReactNode[] = []
    let cursor = offset
    for (const [matchStart, matchEnd] of matches) {
      if (matchEnd <= cursor || matchStart >= end) continue
      if (matchStart > cursor) parts.push(text.slice(cursor, matchStart))
      const markEnd = Math.min(matchEnd, end)
      parts.push(<mark key={cursor}>{text.slice(Math.max(matchStart, cursor), markEnd)}</mark>)
      cursor = markEnd
    }
    if (cursor < end) parts.push(text.slice(cursor, end))
    offset = end
    return token.className ? <span className={token.className} key={tokenIndex}>{parts}</span> : <Fragment key={tokenIndex}>{parts}</Fragment>
  })
}
