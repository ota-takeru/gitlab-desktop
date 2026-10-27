/** Where a Markdown body was written, so its relative links and GitLab references can point somewhere. */
export interface MarkdownLinkBase {
  /** The connected GitLab, e.g. `https://gitlab.example/gitlab`. */
  instanceUrl?: string
  /** The project the body belongs to, e.g. `https://gitlab.example/group/project`. */
  projectUrl?: string
  /** The repository file the body was read from, so its relative images can be read from the same version. */
  repository?: MarkdownRepositoryFile
}

export interface MarkdownRepositoryFile {
  projectId: string
  /** A branch, tag or commit; the default branch when omitted. */
  ref?: string
  /** The file's path in the repository, e.g. `docs/guide.md`. */
  path: string
}

const trimSlash = (url: string) => url.replace(/\/+$/u, '')

/** The project's web URL from an MR's web URL. */
export function projectUrlOf(mergeRequestUrl: string): string | undefined {
  const index = mergeRequestUrl.indexOf('/-/merge_requests/')
  return index > 0 ? mergeRequestUrl.slice(0, index) : undefined
}

/**
 * The URL a link opens: web and mail links as written, and GitLab's root-relative
 * links on the connected instance (`/uploads/` belongs to the project). Anything
 * else, such as `javascript:` or a path relative to an unknown file, opens nothing.
 * An image (`key` is `src`) in a repository file is read from that file's version, and a
 * relative link in one opens the linked file on GitLab at that version (which the app opens itself).
 */
export function resolveMarkdownUrl(url: string, base: MarkdownLinkBase, key?: string): string {
  if (/^(https?:\/\/|mailto:)/iu.test(url)) return url
  if (key === 'src' && base.repository && base.instanceUrl && !url.startsWith('/uploads/') && !url.startsWith('//') && !/^[a-z][a-z\d+.-]*:/iu.test(url)) {
    return repositoryImageUrl(url, base.repository, base.instanceUrl)
  }
  if (key === 'href' && base.repository && base.projectUrl && !url.startsWith('#') && !url.startsWith('/uploads/') && !url.startsWith('//') && !/^[a-z][a-z\d+.-]*:/iu.test(url)) {
    return repositoryFileUrl(url, base.repository, base.projectUrl)
  }
  if (!url.startsWith('/') || url.startsWith('//')) return ''
  if (url.startsWith('/uploads/')) return base.projectUrl ? `${trimSlash(base.projectUrl)}${url}` : ''
  return base.instanceUrl ? `${trimSlash(base.instanceUrl)}${url}` : ''
}

/** The repository path a relative path in a repository file names, or null when it leaves the repository. */
function repositoryPath(url: string, repository: MarkdownRepositoryFile): string | null {
  const written = url.replace(/[?#].*$/u, '')
  let decoded: string
  try { decoded = decodeURIComponent(written) } catch { return null }
  const segments = decoded.startsWith('/') ? [] : repository.path.split('/').slice(0, -1)
  for (const segment of decoded.split('/')) {
    if (segment === '..') { if (!segments.pop()) return null }
    else if (segment && segment !== '.') segments.push(segment)
  }
  return segments.length ? segments.join('/') : null
}

/** A relative link in a repository file: the linked file on GitLab, at the shown version, with its section. */
function repositoryFileUrl(url: string, repository: MarkdownRepositoryFile, projectUrl: string): string {
  const path = repositoryPath(url, repository)
  if (!path) return ''
  const section = url.includes('#') ? url.slice(url.indexOf('#')) : ''
  const encode = (value: string) => value.split('/').map(encodeURIComponent).join('/')
  return `${trimSlash(projectUrl)}/-/blob/${encode(repository.ref || 'HEAD')}/${encode(path)}${section}`
}

/**
 * An image path in a repository file, as GitLab resolves it: relative to the file's folder,
 * or to the repository root when it starts with `/`. It is read through the repository files API.
 */
function repositoryImageUrl(url: string, repository: MarkdownRepositoryFile, instanceUrl: string): string {
  const path = repositoryPath(url, repository)
  if (!path) return ''
  const ref = encodeURIComponent(repository.ref || 'HEAD')
  return `${trimSlash(instanceUrl)}/api/v4/projects/${encodeURIComponent(repository.projectId)}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`
}

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }

// `!12` / `#12` (optionally after `group/project`) and `@username`, not inside words, paths or e-mail addresses.
const REFERENCE = /(?<![\w@/.!#-])(?:((?:[\w.-]+\/)+[\w.-]+)?([!#])([1-9]\d*)|@(\w(?:[\w.-]*\w)?))(?![\w])/gu

function referenceUrl(match: RegExpExecArray, base: MarkdownLinkBase): string | undefined {
  const [, project, sigil, number, username] = match
  const instance = base.instanceUrl ? trimSlash(base.instanceUrl) : undefined
  if (username) return instance ? `${instance}/${username}` : undefined
  const projectUrl = project ? (instance ? `${instance}/${project}` : undefined) : base.projectUrl && trimSlash(base.projectUrl)
  if (!projectUrl) return undefined
  return `${projectUrl}/-/${sigil === '!' ? 'merge_requests' : 'issues'}/${number}`
}

function linkReferences(text: string, base: MarkdownLinkBase): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = []
  let last = 0
  for (const match of text.matchAll(REFERENCE)) {
    const url = referenceUrl(match, base)
    if (!url) continue
    if (match.index > last) nodes.push({ type: 'text', value: text.slice(last, match.index) })
    nodes.push({ type: 'link', url, children: [{ type: 'text', value: match[0] }] })
    last = match.index + match[0].length
  }
  if (!nodes.length) return null
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) })
  return nodes
}

/** Links GitLab's `!12`, `#12` and `@user` references in text, as GitLab does; code and existing links are left as written. */
export function remarkGitLabReferences(base: MarkdownLinkBase) {
  const visit = (node: MarkdownNode) => {
    if (!node.children || node.type === 'link' || node.type === 'linkReference') return
    node.children = node.children.flatMap((child) => child.type === 'text' && child.value ? linkReferences(child.value, base) ?? [child] : (visit(child), [child]))
  }
  return () => visit
}
