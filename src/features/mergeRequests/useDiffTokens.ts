import { startTransition, useEffect, useMemo, useState } from 'react'

import { highlightLines, highlightRuns, type SyntaxToken } from '../../lib/syntaxHighlight'
import { keepFinished, keptFinished } from './diffTokenCache'
import type { ParsedLine } from './diffParser'

export { clearDiffTokenCache } from './diffTokenCache'

type Step = (tokens: SyntaxToken[][]) => void

const NOTHING: { key: string | null; later: Step[]; tokens: SyntaxToken[][] } = { key: null, later: [], tokens: [] }

/** Context lines read before each run of removed lines, so a construct opened there still colours them. */
const OLD_SIDE_CONTEXT = 20
/** Characters highlighted in one step, the size of a run of `highlightRuns`. */
const STEP_CHARACTERS = 50_000

/**
 * Steps that write the tokens of `segments`, each a list of line indices read as one text.
 * Runs of different segments share a step while they fit in one run's characters.
 * `writes` limits which lines a step may write.
 */
function sideSteps(lines: ParsedLine[], segments: number[][], language: string, writes: (line: ParsedLine) => boolean = () => true): Step[] {
  const steps: Array<Array<{ end: number; segment: number[]; start: number; texts: string[] }>> = []
  let characters = Infinity
  for (const segment of segments) {
    const texts = segment.map((index) => lines[index].text)
    for (const [start, end] of highlightRuns(texts)) {
      const size = texts.slice(start, end).reduce((total, text) => total + text.length + 1, 0)
      if (characters + size > STEP_CHARACTERS) {
        steps.push([])
        characters = 0
      }
      steps[steps.length - 1].push({ end, segment, start, texts })
      characters += size
    }
  }
  return steps.map((runs) => (tokens) => {
    for (const { end, segment, start, texts } of runs) {
      highlightLines(texts.slice(start, end), language).forEach((lineTokens, offset) => {
        const index = segment[start + offset]
        if (writes(lines[index])) tokens[index] = lineTokens
      })
    }
  })
}

/** Each run of removed lines on the old side with up to `OLD_SIDE_CONTEXT` context lines before it. */
function removedSegments(lines: ParsedLine[], oldSide: number[]): number[][] {
  const segments: number[][] = []
  let segmentEnd = 0
  oldSide.forEach((index, position) => {
    if (lines[index].kind !== 'remove' || position < segmentEnd) return
    let start = position
    while (start > segmentEnd && position - start < OLD_SIDE_CONTEXT && lines[oldSide[start - 1]].kind !== 'remove') start -= 1
    let end = position
    while (end < oldSide.length && lines[oldSide[end]].kind === 'remove') end += 1
    // A segment that ends right where this one starts reads on, so the removed lines keep its state.
    const previous = segments.at(-1)
    if (previous && start === segmentEnd) previous.push(...oldSide.slice(start, end))
    else segments.push(oldSide.slice(start, end))
    segmentEnd = end
  })
  return segments
}

/**
 * The tokens of a file's diff lines. Context lines use the new side, so the old side is read
 * only around its removed lines. The first step of each side is highlighted with the render,
 * so a short file is coloured at once. A long file shows the rest as plain text until the
 * other steps, each between frames, have finished. With `cacheKey`, which must change
 * whenever the lines do, the finished tokens are kept and used again for the same key.
 */
export function useDiffTokens(lines: ParsedLine[], language: string | null, enabled: boolean, cacheKey: string | null = null): SyntaxToken[][] {
  const first = useMemo(() => {
    if (!enabled) return NOTHING
    const key = language && cacheKey !== null ? `${language}\0${cacheKey}` : null
    const kept = key ? keptFinished(key, lines.length) : null
    if (kept) return { key: null, later: [], tokens: kept }
    const tokens: SyntaxToken[][] = lines.map((line) => [{ text: line.text }])
    if (!language) return { key: null, later: [], tokens }
    const oldSide: number[] = []
    const newSide: number[] = []
    lines.forEach((line, index) => {
      if (line.kind !== 'add') oldSide.push(index)
      if (line.kind !== 'remove') newSide.push(index)
    })
    const later: Step[] = []
    const sides = [
      sideSteps(lines, removedSegments(lines, oldSide), language, (line) => line.kind === 'remove'),
      sideSteps(lines, [newSide], language),
    ]
    for (const [start, ...rest] of sides) {
      start?.(tokens)
      later.push(...rest)
    }
    return { key, later, tokens }
  }, [cacheKey, enabled, language, lines])
  const [finished, setFinished] = useState<{ first: typeof first; tokens: SyntaxToken[][] } | null>(null)

  useEffect(() => {
    if (first.later.length === 0) {
      if (first.key) keepFinished(first.key, first.tokens, lines)
      return
    }
    const tokens = [...first.tokens]
    let next = 0
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      first.later[next](tokens)
      next += 1
      if (next < first.later.length) timer = setTimeout(step)
      // Every row renders again with its colours, so this must not hold up scrolling or typing.
      else {
        if (first.key) keepFinished(first.key, tokens, lines)
        startTransition(() => setFinished({ first, tokens }))
      }
    }
    timer = setTimeout(step)
    return () => clearTimeout(timer)
  }, [first, lines])

  return finished?.first === first ? finished.tokens : first.tokens
}
