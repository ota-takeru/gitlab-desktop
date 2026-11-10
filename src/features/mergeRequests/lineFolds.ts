import { useMemo, useState } from 'react'

/** A tab counts as this many columns when indents are compared. */
const TAB_COLUMNS = 4

const MARKDOWN_HEADING = /^ {0,3}(#{1,6})(?:\s|$)/u
const MARKDOWN_FENCE = /^ {0,3}(?:```|~~~)/u

function indentOf(text: string): number | null {
  let columns = 0
  for (const char of text) {
    if (char === ' ') columns += 1
    else if (char === '\t') columns += TAB_COLUMNS - (columns % TAB_COLUMNS)
    else return columns
  }
  // Blank lines belong to the block around them.
  return null
}

/**
 * Lines that can be folded, by the index of their first line, with the index of their last hidden line.
 * As editors do without a parser, a line folds the lines after it that are indented deeper, ending at
 * the last of them that is not blank, so a closing brace stays in view. Markdown folds a heading
 * down to the next heading of the same or a higher level. No range runs over a line where
 * `breakBefore` is true, as lines left out of a diff can hold anything.
 */
export function foldRanges(texts: readonly string[], markdown: boolean, breakBefore?: (index: number) => boolean): Map<number, number> {
  const ranges = new Map<number, number>()
  // Starts still open, innermost last, with their indent or heading level.
  const open: Array<{ start: number; depth: number }> = []
  let lastFilled = -1
  let fenced = false
  const close = (depth: number) => {
    while (open.length && open[open.length - 1].depth >= depth) {
      const { start } = open.pop()!
      if (lastFilled > start) ranges.set(start, lastFilled)
    }
  }
  texts.forEach((text, index) => {
    if (index > 0 && breakBefore?.(index)) {
      close(Number.NEGATIVE_INFINITY)
      fenced = false
    }
    if (markdown) {
      if (MARKDOWN_FENCE.test(text)) fenced = !fenced
      const heading = fenced ? null : MARKDOWN_HEADING.exec(text)
      if (heading) {
        close(heading[1].length)
        open.push({ depth: heading[1].length, start: index })
      }
      if (text.trim()) lastFilled = index
      return
    }
    const indent = indentOf(text)
    if (indent === null) return
    close(indent)
    open.push({ depth: indent, start: index })
    lastFilled = index
  })
  close(Number.NEGATIVE_INFINITY)
  return ranges
}

export interface LineFolds {
  /** The last line folded with each foldable line. */
  ranges: ReadonlyMap<number, number>
  /** Lines folded now, by their first line, with the number of lines under them that `marked` counts. */
  folded: ReadonlyMap<number, { lines: number; marked: number }>
  /** Lines inside a folded range. */
  hidden: ReadonlySet<number>
  toggle: (start: number) => void
}

const NONE_FOLDED: ReadonlySet<number> = new Set()

export const NO_FOLDS: LineFolds = { folded: new Map(), hidden: new Set(), ranges: new Map(), toggle: () => {} }

/**
 * Which ranges are folded, kept per `resetKey` (the file shown). A line in `reveal`, such as a
 * search result or the line of a link, opens the folds around it, as an editor does on a jump.
 */
export function useLineFolds(ranges: ReadonlyMap<number, number>, resetKey: string, reveal: readonly number[], marked?: (index: number) => boolean): LineFolds {
  const revealKey = `${resetKey}\0${reveal.join(',')}`
  const [state, setState] = useState<{ resetKey: string; revealKey: string; collapsed: ReadonlySet<number> }>({ collapsed: new Set(), resetKey, revealKey })
  let collapsed = state.resetKey === resetKey ? state.collapsed : NONE_FOLDED
  if (state.revealKey !== revealKey) {
    // Adjusted while rendering, so a jump finds its row in the same commit.
    const opened = new Set(Array.from(collapsed).filter((start) => !reveal.some((line) => line > start && line <= (ranges.get(start) ?? start))))
    if (opened.size !== collapsed.size) collapsed = opened
    setState({ collapsed, resetKey, revealKey })
  }
  return useMemo(() => {
    const hidden = new Set<number>()
    const folded = new Map<number, { lines: number; marked: number }>()
    for (const start of Array.from(collapsed).sort((a, b) => a - b)) {
      const end = ranges.get(start)
      // Inside a range already folded, or no longer foldable.
      if (end === undefined || hidden.has(start)) continue
      let count = 0
      for (let line = start + 1; line <= end; line += 1) {
        hidden.add(line)
        if (marked?.(line)) count += 1
      }
      folded.set(start, { lines: end - start, marked: count })
    }
    const toggle = (start: number) => setState((current) => {
      const next = new Set(current.resetKey === resetKey ? current.collapsed : [])
      if (!next.delete(start)) next.add(start)
      return { ...current, collapsed: next, resetKey }
    })
    return { folded, hidden, ranges, toggle }
  }, [collapsed, marked, ranges, resetKey])
}
