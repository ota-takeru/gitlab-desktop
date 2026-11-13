import type { SyntaxToken } from '../../lib/syntaxHighlight'
import type { ParsedLine } from './diffParser'

// Apart from useDiffTokens, so the app can clear it without loading the highlighter.
/** Files whose finished tokens are kept, so returning to a file or rebuilding the tab does not colour it again. */
const FINISHED_KEPT = 4
/** Characters of the lines those tokens cover, all files together. */
const FINISHED_CHARACTERS = 2_000_000
const finishedTokens = new Map<string, { characters: number; tokens: SyntaxToken[][] }>()

/** Forgets every kept set of finished tokens, as when memory runs short. */
export function clearDiffTokenCache(): void {
  finishedTokens.clear()
}

export function keepFinished(key: string, tokens: SyntaxToken[][], lines: ParsedLine[]): void {
  const characters = lines.reduce((total, line) => total + line.text.length, 0)
  finishedTokens.delete(key)
  if (characters > FINISHED_CHARACTERS) return
  finishedTokens.set(key, { characters, tokens })
  let total = 0
  for (const entry of finishedTokens.values()) total += entry.characters
  // The oldest entries are first in the map.
  for (const [oldKey, entry] of finishedTokens) {
    if (finishedTokens.size <= FINISHED_KEPT && total <= FINISHED_CHARACTERS) break
    finishedTokens.delete(oldKey)
    total -= entry.characters
  }
}

export function keptFinished(key: string, lineCount: number): SyntaxToken[][] | null {
  const kept = finishedTokens.get(key)
  if (!kept || kept.tokens.length !== lineCount) return null
  // The most recently used entry moves to the end, so it is the last one dropped.
  finishedTokens.delete(key)
  finishedTokens.set(key, kept)
  return kept.tokens
}
