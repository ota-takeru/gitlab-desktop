/** The start of a comment as plain text: link and emphasis markers are dropped. */
export function plainExcerpt(body: string, length = 160): string {
  const text = body
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gmu, '')
    .replace(/[`*~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return text.length > length ? `${text.slice(0, length)}…` : text
}
