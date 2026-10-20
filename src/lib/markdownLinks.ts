/** Where a Markdown body was written, so its relative links and GitLab references can point somewhere. */
export interface MarkdownLinkBase {
  /** The connected GitLab, e.g. `https://gitlab.example/gitlab`. */
  instanceUrl?: string
  /** The project the body belongs to, e.g. `https://gitlab.example/group/project`. */
  projectUrl?: string
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
 */
export function resolveMarkdownUrl(url: string, base: MarkdownLinkBase): string {
  if (/^(https?:\/\/|mailto:)/iu.test(url)) return url
  if (!url.startsWith('/') || url.startsWith('//')) return ''
  if (url.startsWith('/uploads/')) return base.projectUrl ? `${trimSlash(base.projectUrl)}${url}` : ''
  return base.instanceUrl ? `${trimSlash(base.instanceUrl)}${url}` : ''
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
