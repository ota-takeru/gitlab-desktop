/** Whether a `@username` in a comment names an existing user. */
export type MentionStatus = 'resolved' | 'unresolved'

/** Statuses by lower-case username; a username missing from it is still being looked up. */
export type MentionStatuses = ReadonlyMap<string, MentionStatus>

export interface MentionRange { end: number; start: number; username: string }

/**
 * The user mentions GitLab links in Markdown, as `mentionsUser` reads them: not part of an
 * address such as `a@b.c`, without a trailing full stop, and not in code. Group mentions
 * (`@group/name`) and `@all` name no user and are left out.
 */
export function findMentionRanges(markdown: string): MentionRange[] {
  const text = maskCode(markdown)
  const ranges: MentionRange[] = []
  for (const match of text.matchAll(/(?:^|[^\w@.-])@([\w.-]+(?:\/[\w.-]+)*)/gu)) {
    const username = match[1].replace(/\.+$/u, '')
    if (!username || username.includes('/') || username.toLowerCase() === 'all') continue
    const start = match.index + match[0].length - match[1].length - 1
    ranges.push({ end: start + 1 + username.length, start, username })
  }
  return ranges
}

/** Blanks out code spans and fenced blocks, keeping every other offset. */
function maskCode(markdown: string): string {
  const blank = (code: string) => code.replace(/[^\n]/gu, ' ')
  return markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gmu, blank)
    .replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/gu, blank)
}
