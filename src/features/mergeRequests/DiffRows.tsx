import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { Fragment, memo, startTransition, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import { hairline } from '../../components/hairline'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import type { SyntaxToken } from '../../lib/syntaxHighlight'
import type { Position } from '../../types/gitlab'
import { BlameCell } from './BlamePanel'
import { blameCellStyles } from './blameLines'
import { DiffGap, type GapExpansion } from './DiffGap'
import { diffGaps, type DiffGapInfo } from './diffGaps'
import { DiffScrollbar } from './DiffScrollbar'
import { lineHasThreads } from './diffLineThreads'
import type { ParsedLine } from './diffParser'
import { diffBaseStyles, matchesPosition, positionLineId, quietBand, renderCode } from './diffShared'
import { LineThreads, type ThreadView } from './DiffThreads'
import { foldStyles, foldSummary, foldToggle } from './LineFold'
import { NO_FOLDS, type LineFolds } from './lineFolds'

/** Choosing the lines of a comment with the 「+」 buttons, by absolute line index. */
export interface LineSelection {
  isChosen: (index: number) => boolean
  onAction: (index: number, event: React.MouseEvent) => void
  onDragStart: (index: number, event: React.MouseEvent) => void
  onDragOver: (index: number) => void
  onKeyDown: (index: number, event: React.KeyboardEvent) => void
}

export type RowSelection = Omit<LineSelection, 'isChosen'>

/** The 「+」 of a commentable line; it also extends a multi-line choice. A plain element, as a page holds many rows. */
function lineAction(index: number, label: string, selection: RowSelection) {
  return <button aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown" aria-label={label} className="diff-action line-action" data-line-action={index} onClick={(event) => selection.onAction(index, event)} onKeyDown={(event) => selection.onKeyDown(index, event)} onMouseDown={(event) => selection.onDragStart(index, event)} title={translate('review.diff.lineActionTitle')} type="button">+</button>
}

/** Follows a gutter drag over the rows, which carry their line index. */
function dragOver(selection: RowSelection) {
  return (event: React.MouseEvent) => {
    const index = (event.target as HTMLElement).closest?.('[data-line-index]')?.getAttribute('data-line-index')
    if (index) selection.onDragOver(Number(index))
  }
}

export function UnifiedDiff({ activeSearchMatch, allowComments, blameEnabled, chosenRange, firstRows, folds = NO_FOLDS, gapExpansion, lines, scrollRef, searchMatchIndices, searchTerm, selectedPosition, selection, startIndex, threadView, tokens, wrap }: { activeSearchMatch: number; allowComments: boolean; blameEnabled: boolean; chosenRange: [number, number] | null; firstRows: number; folds?: LineFolds; gapExpansion?: GapExpansion; lines: ParsedLine[]; scrollRef: React.RefObject<HTMLDivElement | null>; searchMatchIndices: Set<number>; searchTerm: string; selectedPosition?: Position; selection: RowSelection; startIndex: number; threadView?: ThreadView; tokens: SyntaxToken[][]; wrap: boolean }) {
  const t = useT()
  const pieces = useMemo(() => {
    const skipped = diffGaps(lines, startIndex)
    return chunkRanges(lines.length).map(([from, to]) => ({ lines: lines.slice(from, to), skipped: skipped.slice(from, to), start: startIndex + from }))
  }, [lines, startIndex])
  // Apart from the pieces, so colours arriving later do not start the rows over.
  const pieceTokens = useMemo(() => chunkRanges(lines.length).map(([from, to]) => tokens.slice(from, to)), [lines.length, tokens])
  const shown = useProgressiveCount(pieces, firstRows)
  // The prefix and the space after it take two columns of the code cell.
  const measured = useCodeColumns(scrollRef, '.diff-code', `unified:${blameEnabled}:${wrap}`)
  const columns = wrap ? measured : 0
  const heights = useMemo(() => pieces.map((piece) => piece.lines.reduce((sum, line, index) => folds.hidden.has(piece.start + index) ? sum : sum + wrappedLines(line.text, columns, 2) * ROW_HEIGHT + (piece.skipped[index].count > 0 ? GAP_HEIGHT : 0), 0)), [columns, folds, pieces])
  // The rows off screen are not laid out, so their width comes from their text. The rows on screen can still widen it.
  const longest = useMemo(() => wrap ? 0 : longestLine(lines) + 2, [lines, wrap])
  // Rows are plain elements styled from this one block: a file can hold many
  // thousands of rows, and per-row styled components dominate render time.
  return (
    <>
    <Box ref={scrollRef} sx={[(theme) => ({ ...diffBaseStyles(theme),
      // Long code lines wrap, so the page stays the only scroll.
      '& .diff-rows': { minWidth: 0 },
      ...chunkStyles,
      ...blameCellStyles(theme),
      ...foldStyles(theme, '25px'),
      '& .diff-row': { '--row-bg': theme.palette.background.paper, alignItems: 'stretch', backgroundColor: 'var(--row-bg)', color: theme.palette.diff?.text, display: 'flex', minHeight: 20 },
      '& .diff-row[data-kind="add"]': { '--row-bg': theme.palette.diff?.addedBackground, color: theme.palette.diff?.addedText },
      '& .diff-row[data-kind="remove"]': { '--row-bg': theme.palette.diff?.deletedBackground, color: theme.palette.diff?.deletedText },
      '& .diff-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .diff-row[data-search-active="true"]': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: -2 },
      '& mark': { backgroundColor: theme.palette.diff?.searchMatchBackground, color: theme.palette.diff?.searchMatchText },
      '& .diff-gutter': { alignItems: 'stretch', backgroundColor: 'var(--row-bg)', display: 'flex', flexShrink: 0, paddingRight: '42px', position: 'relative' },
      // Lines chosen for a multi-line comment: a bar and a tint on the gutter, keeping the add/remove colour of the code.
      '& .diff-row[data-range="true"] .diff-gutter': { backgroundColor: theme.palette.action.selected, boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` },
      '& .diff-number': { color: theme.palette.text.secondary, padding: '0 6px', textAlign: 'right', userSelect: 'none', width: 44 },
      '& .diff-row:hover .diff-action, & .diff-row:focus-within .diff-action, & .diff-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .diff-code': { color: theme.palette.diff?.text, flex: 1, minWidth: 0, overflowWrap: 'anywhere', paddingRight: '24px', whiteSpace: 'pre-wrap' },
      '& .diff-row[data-kind="add"] .diff-prefix': { color: theme.palette.diff?.addedText },
      '& .diff-row[data-kind="remove"] .diff-prefix': { color: theme.palette.diff?.deletedText },
    }), !wrap && ((theme) => ({
      ...unwrappedStyles,
      '& .diff-rows': { width: 'max-content' },
      // The line numbers stay in view over the code scrolling beneath them, so the tint of chosen lines must not let it show through.
      '& .diff-gutter': { left: 0, position: 'sticky', zIndex: 1 },
      '& .diff-row[data-range="true"] .diff-gutter': { backgroundColor: 'var(--row-bg)', boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}, inset 0 0 0 100px ${theme.palette.action.selected}` },
      '& .diff-code': { flex: '1 0 auto', overflowWrap: 'normal', whiteSpace: 'pre' },
    }))]}>
      {lines.length === 0 ? <Typography color="textSecondary" sx={{ fontFamily: 'fontFamily', p: 2 }} variant="body2">{t('review.diff.empty')}</Typography> : null}
      <div className="diff-rows" onMouseOver={allowComments ? dragOver(selection) : undefined} style={wrap ? undefined : { minWidth: `max(100%, calc(${longest}ch + ${(blameEnabled ? 106 : 0) + UNIFIED_GUTTER_WIDTH}px))` }}>
        {pieces.map((piece, pieceIndex) => {
          // A piece still to come holds its estimated room, so the page keeps its length while it fills in.
          if (pieceIndex >= shown) return <div key={piece.start} style={{ height: heights[pieceIndex] }} />
          const end = piece.start + piece.lines.length - 1
          const hasMatch = searchMatchIndices.size > 0 && piece.lines.some((_, index) => searchMatchIndices.has(piece.start + index))
          const hasThreads = Boolean(threadView) && piece.lines.some((line) => lineHasThreads(line, threadView))
          return <UnifiedRows
            activeSearchMatch={activeSearchMatch >= piece.start && activeSearchMatch <= end ? activeSearchMatch : -1}
            allowComments={allowComments}
            blameEnabled={blameEnabled}
            chosenFrom={chosenRange && chosenRange[1] >= piece.start && chosenRange[0] <= end ? Math.max(chosenRange[0], piece.start) : -1}
            chosenTo={chosenRange && chosenRange[1] >= piece.start && chosenRange[0] <= end ? Math.min(chosenRange[1], end) : -1}
            folds={folds}
            gapExpansion={piece.skipped.some((gap) => gap.count > 0) ? gapExpansion : undefined}
            height={heights[pieceIndex]}
            key={piece.start}
            lines={piece.lines}
            searchMatchIndices={hasMatch ? searchMatchIndices : NO_MATCHES}
            searchTerm={hasMatch ? searchTerm : ''}
            selectedPosition={selectedPosition && piece.lines.some((line) => matchesPosition(line, selectedPosition)) ? selectedPosition : undefined}
            selection={selection}
            skipped={piece.skipped}
            startIndex={piece.start}
            threadView={hasThreads ? threadView : undefined}
            tokens={pieceTokens[pieceIndex]}
          />
        })}
      </div>
    </Box>
    {wrap ? null : <DiffScrollbar content={`${longest}:${blameEnabled}`} target={scrollRef} />}
    </>
  )
}

/** A piece of a unified page; it renders again only when what it shows changes. */
const UnifiedRows = memo(function UnifiedRows({ activeSearchMatch, allowComments, blameEnabled, chosenFrom, chosenTo, folds, gapExpansion, height, lines, searchMatchIndices, searchTerm, selectedPosition, selection, skipped, startIndex, threadView, tokens }: { activeSearchMatch: number; allowComments: boolean; blameEnabled: boolean; chosenFrom: number; chosenTo: number; folds: LineFolds; gapExpansion?: GapExpansion; height: number; lines: ParsedLine[]; searchMatchIndices: ReadonlySet<number>; searchTerm: string; selectedPosition?: Position; selection: RowSelection; skipped: DiffGapInfo[]; startIndex: number; threadView?: ThreadView; tokens: SyntaxToken[][] }) {
  const t = useT()
  // Opened unchanged lines: plain context rows, outside paging and search.
  const openedRows = (opened: ParsedLine[], openedTokens: SyntaxToken[][]) => opened.map((line, index) => <Fragment key={`opened-${line.newLine}`}>
    <div className="diff-row" data-file-anchor={line.newLine} data-kind="context" data-testid="diff-opened-line">
      {blameEnabled ? <BlameCell line={line.newLine} side="new" /> : null}
      <span className="diff-gutter"><span className="diff-number">{line.oldLine}</span><span className="diff-number">{line.newLine}</span></span>
      <span className="diff-code"><span className="diff-prefix">{line.prefix}</span> {renderCode(openedTokens[index] ?? [{ text: line.text }], '')}</span>
    </div>
    <LineThreads line={line} view={threadView} />
  </Fragment>)
  return <div className="diff-chunk" data-threads={threadView ? 'true' : undefined} style={chunkSize(height)}>
    {lines.map((line, index) => {
      const isSelectedPosition = matchesPosition(line, selectedPosition)
      const position = linePosition(line)
      const lineIndex = startIndex + index
      if (folds.hidden.has(lineIndex)) return null
      const key = `${lineIndex}-${line.oldLine ?? ''}-${line.newLine ?? ''}`
      return <Fragment key={key}>
        {skipped[index].count > 0 ? <DiffGap expansion={gapExpansion} gap={skipped[index]} renderLines={openedRows} /> : null}
        <div className="diff-row" data-kind={line.kind} data-line-id={isSelectedPosition && selectedPosition ? positionLineId(selectedPosition) : undefined} data-line-index={lineIndex} data-range={allowComments && lineIndex >= chosenFrom && lineIndex <= chosenTo && chosenFrom >= 0 ? 'true' : undefined} data-search-match={searchMatchIndices.has(lineIndex) ? 'true' : undefined} data-search-active={activeSearchMatch === lineIndex ? 'true' : undefined} data-selected={isSelectedPosition ? 'true' : undefined} data-testid="diff-line" data-file-anchor={line.newLine} tabIndex={isSelectedPosition ? -1 : undefined}>
          {blameEnabled ? <BlameCell line={line.kind === 'remove' ? line.oldLine : line.newLine} side={line.kind === 'remove' ? 'old' : 'new'} /> : null}
          <span className="diff-gutter">
            <span className="diff-number">{line.oldLine ?? ''}</span>
            <span className="diff-number">{line.newLine ?? ''}</span>
            {foldToggle(lineIndex, folds)}
            {position && allowComments ? lineAction(lineIndex, t('review.diff.commentOnLine', { path: line.newPath, line: String(line.newLine ?? line.oldLine) }), selection) : null}
          </span>
          <span className="diff-code"><span className="diff-prefix">{line.prefix}</span> {renderCode(tokens[index] ?? [{ text: line.text }], searchTerm)}{foldSummary(lineIndex, folds)}</span>
        </div>
        <LineThreads line={line} view={threadView} />
      </Fragment>
    })}
  </div>
})

/** Rows rendered as one memoized piece; a piece off screen also skips layout and paint. */
const ROW_CHUNK = 50

/** Pieces rendered with the page at once; the rest follow in the background. */
const FIRST_CHUNKS = 3

/** One line of code is this tall; an off-screen piece holds the room its lines are estimated to wrap into until it has been laid out once. */
const ROW_HEIGHT = 20

/** The row that stands for omitted lines (`DiffGap`). */
const GAP_HEIGHT = 24

const NO_MATCHES: ReadonlySet<number> = new Set()

/** Pieces without threads skip their layout and paint while off screen; a thread's editor or menus are never clipped. */
const chunkStyles = { '& .diff-chunk:not([data-threads])': { contentVisibility: 'auto' } }

/**
 * With long lines kept on one line, the view scrolls sideways by itself, with `DiffScrollbar` for its bar.
 * A thread under a line stays as wide as the view and in place, so its text is not spread over the width of the longest line.
 */
const unwrappedStyles = {
  // The view is the scroll a comment editor's toolbar sticks in now, so the page's sticky rows above must not push it down.
  '--composer-sticky-top': '0px',
  containerType: 'inline-size',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  '& .diff-threads': { boxSizing: 'border-box', left: 0, position: 'sticky', width: '100cqw' },
}

/** The two line numbers, the comment button and the space after the code in a unified row. */
const UNIFIED_GUTTER_WIDTH = 154

/** One height for a piece off screen; no width, which would widen a view that sizes itself to its rows. */
function chunkSize(height: number): React.CSSProperties {
  return { containIntrinsicSize: `auto 0px auto ${height}px` }
}

/** Columns of the widest line. A wide character counts as two here, as a line that is too short would be cut off. */
function longestLine(lines: Array<ParsedLine | undefined>): number {
  let longest = 0
  for (const line of lines) if (line) longest = Math.max(longest, textColumns(line.text, 2))
  return longest
}

function textColumns(text: string, wideColumns: number): number {
  let width = 0
  for (const char of text) width += char === '\t' ? 8 : WIDE_CHARACTER.test(char) ? wideColumns : 1
  return width
}

/** East Asian wide characters, which take about 1.7 columns of the monospace code font. */
const WIDE_CHARACTER = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u

/** Lines `text` wraps into in a code cell `columns` characters wide, after `lead` columns before it; one while the width is unknown. */
function wrappedLines(text: string, columns: number, lead = 0): number {
  if (columns <= 0) return 1
  return Math.max(1, Math.ceil((lead + textColumns(text, 1.7)) / columns))
}

/** Columns measured last per layout, so a newly opened file estimates its rows from the start. */
const measuredColumns = new Map<string, number>()

/**
 * How many characters fit on a line of the code cells matching `selector` inside `ref`, measured once rows are
 * laid out and again when the view is resized; 0 until known.
 */
function useCodeColumns(ref: React.RefObject<HTMLDivElement | null>, selector: string, layoutKey: string): number {
  const [columns, setColumns] = useState(() => measuredColumns.get(layoutKey) ?? 0)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const cell = root.querySelector<HTMLElement>(selector)
      if (!cell) return
      // The probe takes the code font from the view around it.
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
      probe.textContent = '0'.repeat(100)
      root.appendChild(probe)
      const characterWidth = probe.getBoundingClientRect().width / 100
      probe.remove()
      const style = getComputedStyle(cell)
      const width = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (!(characterWidth > 0) || !(width > 0)) return
      const next = Math.max(1, Math.floor(width / characterWidth))
      measuredColumns.set(layoutKey, next)
      startTransition(() => setColumns(next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [layoutKey, ref, selector])
  return columns
}

function chunkRanges(length: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (let from = 0; from < length; from += ROW_CHUNK) ranges.push([from, Math.min(length, from + ROW_CHUNK)])
  return ranges
}

/**
 * How many pieces of a page to render: the first ones (and those holding `firstRows`) at once,
 * the rest in a transition after, so a long page shows its top without waiting for its end.
 * A page already rendered keeps all its pieces.
 */
function useProgressiveCount<T>(pieces: T[], firstRows: number): number {
  const wanted = Math.min(pieces.length, Math.max(FIRST_CHUNKS, Math.ceil(firstRows / ROW_CHUNK)))
  const [progress, setProgress] = useState({ count: wanted, pieces })
  let count = progress.count
  if (progress.pieces !== pieces) {
    count = wanted
    setProgress({ count, pieces })
  }
  count = Math.max(count, wanted)
  useEffect(() => {
    if (count < pieces.length) startTransition(() => setProgress({ count: pieces.length, pieces }))
  }, [count, pieces])
  return count
}

function linePosition(line: ParsedLine): Position | undefined {
  return line.commentable && (line.newLine !== undefined || line.oldLine !== undefined)
    ? { baseSha: '', headSha: '', newLine: line.newLine, newPath: line.newPath, oldPath: line.oldPath, oldLine: line.oldLine, positionType: 'text', startSha: '' }
    : undefined
}

/** A row whose lines are all folded away. */
function rowHidden(row: SplitRow, folds: LineFolds): boolean {
  return (row.leftIndex === undefined || folds.hidden.has(row.leftIndex)) && (row.rightIndex === undefined || folds.hidden.has(row.rightIndex))
}

interface SplitRow {
  key: string
  /** Unchanged lines GitLab omitted before this row. */
  gap?: DiffGapInfo
  left?: ParsedLine
  right?: ParsedLine
  leftIndex?: number
  rightIndex?: number
}

/**
 * Pairs a unified diff for side-by-side display: context lines appear on both
 * sides, and each run of removed lines is aligned with the added lines that
 * follow it, row by row.
 */
function buildSplitRows(lines: ParsedLine[], startIndex: number): SplitRow[] {
  const skipped = diffGaps(lines, startIndex)
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'context') {
      rows.push({ gap: skipped[index], key: `${startIndex + index}`, left: line, leftIndex: startIndex + index, right: line, rightIndex: startIndex + index })
      index += 1
      continue
    }
    const start = index
    const removed: Array<{ line: ParsedLine; index: number }> = []
    const added: Array<{ line: ParsedLine; index: number }> = []
    while (index < lines.length && lines[index].kind !== 'context') {
      if (lines[index].kind === 'remove') removed.push({ line: lines[index], index: startIndex + index })
      else added.push({ line: lines[index], index: startIndex + index })
      index += 1
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      rows.push({ gap: pair === 0 ? skipped[start] : undefined, key: `${startIndex + start}-${pair}`, left: removed[pair]?.line, leftIndex: removed[pair]?.index, right: added[pair]?.line, rightIndex: added[pair]?.index })
    }
  }
  return rows
}

export function SplitDiff({ activeSearchMatch, allowComments, blameEnabled, chosenRange, firstRows, folds = NO_FOLDS, gapExpansion, lines, scrollRef, searchMatchIndices, searchTerm, selectedPosition, selection, startIndex, threadView, tokens, wrap }: { activeSearchMatch: number; allowComments: boolean; blameEnabled: boolean; chosenRange: [number, number] | null; firstRows: number; folds?: LineFolds; gapExpansion?: GapExpansion; lines: ParsedLine[]; scrollRef: React.RefObject<HTMLDivElement | null>; searchMatchIndices: Set<number>; searchTerm: string; selectedPosition?: Position; selection: RowSelection; startIndex: number; threadView?: ThreadView; tokens: SyntaxToken[][]; wrap: boolean }) {
  const t = useT()
  const rows = useMemo(() => buildSplitRows(lines, startIndex), [lines, startIndex])
  const pieces = useMemo(() => chunkRanges(rows.length).map(([from, to]) => rows.slice(from, to)), [rows])
  // A split row holds one or two lines, so the pieces needed at once are counted in rows that reach `firstRows`.
  const lastFirstLine = startIndex + firstRows - 1
  const shown = useProgressiveCount(pieces, firstRows > 0 ? rows.findIndex((row) => (row.leftIndex ?? -1) >= lastFirstLine || (row.rightIndex ?? -1) >= lastFirstLine) + 1 : 0)
  const measured = useCodeColumns(scrollRef, '.split-code', `split:${blameEnabled}:${wrap}`)
  const columns = wrap ? measured : 0
  // Each row is its own grid, so both sides take the width of their widest line to stay in line with the other rows.
  const sideWidths = useMemo(() => wrap ? null : { left: longestLine(rows.map((row) => row.left)) + 3, right: longestLine(rows.map((row) => row.right)) + 3 }, [rows, wrap])
  const heights = useMemo(() => pieces.map((piece) => piece.reduce((sum, row) => rowHidden(row, folds) ? sum : sum + Math.max(row.left ? wrappedLines(row.left.text, columns) : 1, row.right ? wrappedLines(row.right.text, columns) : 1) * ROW_HEIGHT + (row.gap && row.gap.count > 0 ? GAP_HEIGHT : 0), 0)), [columns, folds, pieces])
  const inRow = (row: SplitRow, index: number) => row.leftIndex === index || row.rightIndex === index
  return (
    <>
    <Box ref={scrollRef} sx={[(theme) => ({ ...diffBaseStyles(theme),
      '& .split-row': { display: 'grid', gridTemplateColumns: blameEnabled ? '106px 88px minmax(0, 1fr) 106px 88px minmax(0, 1fr)' : '88px minmax(0, 1fr) 88px minmax(0, 1fr)', minHeight: 20 },
      ...blameCellStyles(theme),
      ...foldStyles(theme, '25px'),
      '& .split-row .blame-cell': { width: 106 },
      '& .split-row .blame-author': { display: 'none' },
      '& .split-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .split-row[data-search-active="true"]': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: -2 },
      '& mark': { backgroundColor: theme.palette.diff?.searchMatchBackground, color: theme.palette.diff?.searchMatchText },
      // As in the unified view: room for a 5-digit number, then the 16px of the fold toggle and the 26px of the comment button.
      '& .split-number': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.secondary, padding: '0 42px 0 6px', position: 'relative', textAlign: 'right', userSelect: 'none' },
      '& .split-number[data-side="new"]': hairline('left', { color: theme.palette.divider, position: false }),
      '& .split-code': { backgroundColor: theme.palette.background.paper, color: theme.palette.diff?.text, overflowWrap: 'anywhere', padding: '0 10px 0 6px', whiteSpace: 'pre-wrap' },
      '& [data-kind="remove"]': { backgroundColor: theme.palette.diff?.deletedBackground },
      '& .split-number[data-kind="remove"]': { color: theme.palette.diff?.deletedText },
      '& [data-kind="add"]': { backgroundColor: theme.palette.diff?.addedBackground },
      '& .split-number[data-kind="add"]': { color: theme.palette.diff?.addedText },
      '& [data-kind="empty"]': { backgroundColor: quietBand(theme) },
      '& .split-row:hover .diff-action, & .split-row:focus-within .diff-action, & .split-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .split-number[data-range="true"]': { boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` },
      '& .diff-gap > span': { position: 'static' },
      ...chunkStyles,
    }), sideWidths ? {
      ...unwrappedStyles,
      '& .split-row': { gridTemplateColumns: `${blameEnabled ? '106px ' : ''}88px minmax(${sideWidths.left}ch, 1fr) ${blameEnabled ? '106px ' : ''}88px minmax(${sideWidths.right}ch, 1fr)` },
      '& .split-code': { overflowWrap: 'normal', whiteSpace: 'pre' },
      // Opened unchanged lines are not in the width of the sides, so a long one wraps rather than being cut off.
      '& [data-testid="diff-opened-line"] .split-code': { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
      '& .diff-chunk': { minWidth: `calc(${sideWidths.left + sideWidths.right}ch + ${blameEnabled ? 388 : 176}px)` },
    } : false]} onMouseOver={allowComments ? dragOver(selection) : undefined}>
      {rows.length === 0 ? <Typography color="textSecondary" sx={{ fontFamily: 'fontFamily', p: 2 }} variant="body2">{t('review.diff.empty')}</Typography> : null}
      {pieces.map((piece, pieceIndex) => {
        if (pieceIndex >= shown) return <div key={piece[0].key} style={{ height: heights[pieceIndex] }} />
        const indices = piece.flatMap((row) => [row.leftIndex, row.rightIndex]).filter((index): index is number => index !== undefined)
        const from = Math.min(...indices)
        const to = Math.max(...indices)
        const hasMatch = searchMatchIndices.size > 0 && indices.some((index) => searchMatchIndices.has(index))
        const hasThreads = Boolean(threadView) && piece.some((row) => lineHasThreads(row.left, threadView) || lineHasThreads(row.right, threadView))
        const chosen = chosenRange !== null && chosenRange[1] >= from && chosenRange[0] <= to
        return <SplitRows
          activeSearchMatch={piece.some((row) => inRow(row, activeSearchMatch)) ? activeSearchMatch : -1}
          allowComments={allowComments}
          blameEnabled={blameEnabled}
          chosenFrom={chosen ? Math.max(chosenRange[0], from) : -1}
          chosenTo={chosen ? Math.min(chosenRange[1], to) : -1}
          folds={folds}
          gapExpansion={piece.some((row) => row.gap && row.gap.count > 0) ? gapExpansion : undefined}
          height={heights[pieceIndex]}
          key={piece[0].key}
          rows={piece}
          searchMatchIndices={hasMatch ? searchMatchIndices : NO_MATCHES}
          searchTerm={hasMatch ? searchTerm : ''}
          selectedPosition={selectedPosition && piece.some((row) => (row.left && matchesPosition(row.left, selectedPosition)) || (row.right && matchesPosition(row.right, selectedPosition))) ? selectedPosition : undefined}
          selection={selection}
          startIndex={startIndex}
          threadView={hasThreads ? threadView : undefined}
          tokens={tokens}
        />
      })}
    </Box>
    {sideWidths ? <DiffScrollbar content={`${sideWidths.left}:${sideWidths.right}:${blameEnabled}`} target={scrollRef} /> : null}
    </>
  )
}

/** A piece of a split page; it renders again only when what it shows changes. */
const SplitRows = memo(function SplitRows({ activeSearchMatch, allowComments, blameEnabled, chosenFrom, chosenTo, folds, gapExpansion, height, rows, searchMatchIndices, searchTerm, selectedPosition, selection, startIndex, threadView, tokens }: { activeSearchMatch: number; allowComments: boolean; blameEnabled: boolean; chosenFrom: number; chosenTo: number; folds: LineFolds; gapExpansion?: GapExpansion; height: number; rows: SplitRow[]; searchMatchIndices: ReadonlySet<number>; searchTerm: string; selectedPosition?: Position; selection: RowSelection; startIndex: number; threadView?: ThreadView; tokens: SyntaxToken[][] }) {
  const t = useT()
  const cell = (shownLine: ParsedLine | undefined, side: 'old' | 'new', lineIndex: number | undefined) => {
    // A side folded away is left empty, while the line paired with it is still shown.
    const line = lineIndex !== undefined && folds.hidden.has(lineIndex) ? undefined : shownLine
    // Context rows offer one comment action, on the new side, with both line numbers.
    const showAction = line && allowComments && (line.kind !== 'context' || side === 'new')
    const position = showAction ? linePosition(line) : undefined
    const number = side === 'old' ? line?.oldLine : line?.newLine
    const kind = !line ? 'empty' : line.kind
    const label = side === 'old' && line?.kind === 'remove'
      ? t('review.diff.commentOnOldLine', { path: line.oldPath, line: String(line.oldLine) })
      : line ? t('review.diff.commentOnLine', { path: line.newPath, line: String(line.newLine ?? line.oldLine) }) : ''
    const chosen = allowComments && lineIndex !== undefined && chosenFrom >= 0 && lineIndex >= chosenFrom && lineIndex <= chosenTo
    return <>
      {blameEnabled ? <BlameCell line={number} side={side} /> : null}
      <span className="split-number" data-kind={kind} data-line-index={line ? lineIndex : undefined} data-range={chosen ? 'true' : undefined} data-side={side}>
        {number ?? ''}
        {line && lineIndex !== undefined && (line.kind !== 'context' || side === 'new') ? foldToggle(lineIndex, folds) : null}
        {position && lineIndex !== undefined ? lineAction(lineIndex, label, selection) : null}
      </span>
      <span className="split-code" data-kind={kind} data-search-match={lineIndex !== undefined && searchMatchIndices.has(lineIndex) ? 'true' : undefined}>{line && lineIndex !== undefined ? renderCode(tokens[lineIndex - startIndex] ?? [{ text: line.text }], searchTerm) : ''}{line && lineIndex !== undefined && (line.kind !== 'context' || side === 'new') ? foldSummary(lineIndex, folds) : null}</span>
    </>
  }
  // Opened unchanged lines: the same text on both sides, outside paging and search.
  const openedRows = (opened: ParsedLine[], openedTokens: SyntaxToken[][]) => opened.map((line, index) => {
    const code = renderCode(openedTokens[index] ?? [{ text: line.text }], '')
    return <Fragment key={`opened-${line.newLine}`}>
      <div className="split-row" data-file-anchor={line.newLine} data-testid="diff-opened-line">
        {blameEnabled ? <BlameCell line={line.oldLine} side="old" /> : null}
        <span className="split-number" data-kind="context" data-side="old">{line.oldLine}</span>
        <span className="split-code" data-kind="context">{code}</span>
        {blameEnabled ? <BlameCell line={line.newLine} side="new" /> : null}
        <span className="split-number" data-kind="context" data-side="new">{line.newLine}</span>
        <span className="split-code" data-kind="context">{code}</span>
      </div>
      <LineThreads line={line} view={threadView} />
    </Fragment>
  })
  return <div className="diff-chunk" data-threads={threadView ? 'true' : undefined} style={chunkSize(height)}>
    {rows.map((row) => {
      const selected = Boolean(selectedPosition && ((row.left && matchesPosition(row.left, selectedPosition)) || (row.right && matchesPosition(row.right, selectedPosition))))
      const activeSearch = row.leftIndex === activeSearchMatch || row.rightIndex === activeSearchMatch
      const hasSearchMatch = (row.leftIndex !== undefined && searchMatchIndices.has(row.leftIndex)) || (row.rightIndex !== undefined && searchMatchIndices.has(row.rightIndex))
      if (rowHidden(row, folds)) return null
      return <Fragment key={row.key}>
        {row.gap && row.gap.count > 0 ? <DiffGap expansion={gapExpansion} gap={row.gap} renderLines={openedRows} /> : null}
        <div className="split-row" data-line-id={selected && selectedPosition ? positionLineId(selectedPosition) : undefined} data-search-active={activeSearch ? 'true' : undefined} data-search-match={hasSearchMatch ? 'true' : undefined} data-selected={selected ? 'true' : undefined} data-testid="diff-split-row" data-file-anchor={row.right?.newLine ?? row.left?.newLine} tabIndex={selected ? -1 : undefined}>
          {cell(row.left, 'old', row.leftIndex)}
          {cell(row.right, 'new', row.rightIndex)}
        </div>
        {row.leftIndex !== undefined && folds.hidden.has(row.leftIndex) ? null : <LineThreads line={row.left} view={threadView} />}
        {row.right !== row.left && !(row.rightIndex !== undefined && folds.hidden.has(row.rightIndex)) ? <LineThreads line={row.right} view={threadView} /> : null}
      </Fragment>
    })}
  </div>
})
