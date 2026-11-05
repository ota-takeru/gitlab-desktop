import { startTransition, useEffect, useMemo, useState } from 'react'

import { highlightLines, highlightRuns, type SyntaxToken } from '../../lib/syntaxHighlight'
import type { ParsedLine } from './diffParser'

type Step = (tokens: SyntaxToken[][]) => void

const NOTHING: { later: Step[]; tokens: SyntaxToken[][] } = { later: [], tokens: [] }

/** One step per run of one side of the diff; each writes the tokens of its lines. */
function sideSteps(lines: ParsedLine[], side: number[], language: string): Step[] {
  const texts = side.map((index) => lines[index].text)
  return highlightRuns(texts).map(([start, end]) => (tokens) => {
    highlightLines(texts.slice(start, end), language).forEach((lineTokens, offset) => {
      tokens[side[start + offset]] = lineTokens
    })
  })
}

/**
 * The tokens of a file's diff lines. Context lines use the new side. The first run of
 * each side is highlighted with the render, so a short file is coloured at once. A long
 * file shows the rest as plain text until the other runs, each between frames, have finished.
 */
export function useDiffTokens(lines: ParsedLine[], language: string | null, enabled: boolean): SyntaxToken[][] {
  const first = useMemo(() => {
    if (!enabled) return NOTHING
    const tokens: SyntaxToken[][] = lines.map((line) => [{ text: line.text }])
    if (!language) return { later: [], tokens }
    const oldSide: number[] = []
    const newSide: number[] = []
    lines.forEach((line, index) => {
      if (line.kind !== 'add') oldSide.push(index)
      if (line.kind !== 'remove') newSide.push(index)
    })
    const later: Step[] = []
    for (const side of [oldSide, newSide]) {
      const [start, ...rest] = sideSteps(lines, side, language)
      start?.(tokens)
      later.push(...rest)
    }
    return { later, tokens }
  }, [enabled, language, lines])
  const [finished, setFinished] = useState<{ first: typeof first; tokens: SyntaxToken[][] } | null>(null)

  useEffect(() => {
    if (first.later.length === 0) return
    const tokens = [...first.tokens]
    let next = 0
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      first.later[next](tokens)
      next += 1
      if (next < first.later.length) timer = setTimeout(step)
      // Every row renders again with its colours, so this must not hold up scrolling or typing.
      else startTransition(() => setFinished({ first, tokens }))
    }
    timer = setTimeout(step)
    return () => clearTimeout(timer)
  }, [first])

  return finished?.first === first ? finished.tokens : first.tokens
}
