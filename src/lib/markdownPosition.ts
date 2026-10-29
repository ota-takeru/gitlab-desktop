/**
 * Maps places between Markdown source and the text the rich editor shows for it. The shown text is matched
 * in order against the source, skipping what is never shown, such as link destinations, so a caret after a
 * link's text stays after the link instead of moving by the length of its URL.
 */

// `](destination "title")` of links and images.
const LINK_DESTINATION = /\]\([^)\s]*(?:\s+"[^"]*")?\)/gu
// A shown character not in the source as written, such as `<` written `&lt;`, is looked for only this far ahead.
const SEARCH_AHEAD = 200
// Syntax that closes what was shown before it; a caret after that text goes past it.
const CLOSING = new Set(['*', '_', '~', '`'])

/** For each shown character, the source index it was written at. */
function matchShown(markdown: string, shown: string): number[] {
  const hidden = new Uint8Array(markdown.length)
  for (const match of markdown.matchAll(LINK_DESTINATION)) hidden.fill(1, match.index, match.index + match[0].length)
  const indices: number[] = []
  let cursor = 0
  for (const char of shown) {
    const limit = Math.min(markdown.length, cursor + SEARCH_AHEAD)
    let found = -1
    for (let index = cursor; index < limit; index += 1) {
      if (!hidden[index] && markdown.startsWith(char, index)) {
        found = index
        break
      }
    }
    // Code units, as the shown offsets count them.
    for (let unit = 0; unit < char.length; unit += 1) indices.push(found < 0 ? cursor : found + unit)
    if (found >= 0) cursor = found + char.length
  }
  return indices
}

/** The source offset of the place after `count` code units of the shown text. */
export function sourceOffsetOfShown(markdown: string, shown: string, count: number): number {
  const indices = matchShown(markdown, shown)
  if (count <= 0) return indices[0] ?? 0
  if (count > indices.length) return markdown.length
  let offset = indices[count - 1] + 1
  const next = indices[count] ?? markdown.length
  while (offset < next && CLOSING.has(markdown[offset])) offset += 1
  // The rest of a link after its text: `](destination)`.
  for (const match of markdown.matchAll(LINK_DESTINATION)) if (match.index === offset) offset += match[0].length
  return Math.min(offset, next)
}

/** How many code units of the shown text come before the source offset. */
export function shownOffsetOfSource(markdown: string, shown: string, offset: number): number {
  const indices = matchShown(markdown, shown)
  let count = 0
  while (count < indices.length && indices[count] < offset) count += 1
  return count
}
