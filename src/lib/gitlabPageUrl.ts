/** A project page on the connected GitLab that the app has its own screen for. */
export type GitLabPage =
  | { kind: 'project' | 'branches' | 'mrs'; path: string }
  /** A folder or file; `rest` is the ref followed by the path, split by GitLab's `/`, since a ref can contain `/`. */
  | { kind: 'tree' | 'blob'; path: string; rest: string[] }

// First path segments that are GitLab's own pages, never a namespace.
const RESERVED = new Set(['-', 'admin', 'api', 'assets', 'dashboard', 'explore', 'groups', 'help', 'oauth', 'profile', 'projects', 'search', 'snippets', 'uploads', 'users'])

/**
 * Reads a project, its branches, its MR list, or a folder or file in it from a
 * GitLab URL on the connected instance. MR and user URLs are read elsewhere;
 * anything else is null and opens in the browser.
 */
export function parseGitLabPageUrl(input: string, instanceUrl: string): GitLabPage | null {
  let url: URL
  let instance: URL
  try { url = new URL(input.trim()); instance = new URL(instanceUrl) } catch { return null }
  if (url.protocol !== 'https:' || url.origin !== instance.origin || url.username || url.password) return null
  const basePath = instance.pathname.replace(/\/+$/u, '')
  if (!url.pathname.startsWith(`${basePath}/`)) return null
  let segments: string[]
  try { segments = url.pathname.slice(basePath.length + 1).replace(/\/+$/u, '').split('/').map(decodeURIComponent) } catch { return null }
  if (segments.some((part) => !part || part === '.' || part === '..' || /[\\?#]/u.test(part) || Array.from(part).some((char) => char.charCodeAt(0) < 32))) return null
  const dash = segments.indexOf('-')
  const projectParts = dash === -1 ? segments : segments.slice(0, dash)
  // A project is at least `namespace/project`; one segment is a user or a group.
  if (projectParts.length < 2 || RESERVED.has(projectParts[0].toLowerCase())) return null
  const path = projectParts.join('/')
  if (dash === -1) return { kind: 'project', path }
  const [page, ...rest] = segments.slice(dash + 1)
  if (page === 'branches' && !rest.length) return { kind: 'branches', path }
  if (page === 'merge_requests' && !rest.length) return { kind: 'mrs', path }
  if ((page === 'tree' || page === 'blob') && rest.length >= (page === 'blob' ? 2 : 1)) return { kind: page, path, rest }
  return null
}
