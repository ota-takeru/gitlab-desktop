import type { GitLabUser } from '../../types/gitlab'

/** Matches the username or the display name, also when the name's spaces are left out. */
export function matchesMention(user: GitLabUser, search: string): boolean {
  const needle = search.toLocaleLowerCase()
  const name = user.name.toLocaleLowerCase()
  return user.username.toLocaleLowerCase().includes(needle) || name.includes(needle) || name.replace(/\s+/gu, '').includes(needle)
}
