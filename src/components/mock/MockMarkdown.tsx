import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { memo, type ReactElement, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { emojiForName, useEmojiCatalog, type EmojiCatalog } from '../../lib/awardEmoji'
import { remarkGitLabReferences, resolveMarkdownUrl, type MarkdownLinkBase } from '../../lib/markdownLinks'
import { useMarkdownLinks } from '../MarkdownLinks'
import { markdownBodySx } from '../markdownBodySx'
import { useGitLabImage } from '../../features/shared/useGitLabImage'

interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[] }

/** Replaces GitLab's `:name:` emoji in text; code keeps its own node types and is left as written. */
function remarkGitLabEmoji(catalog: EmojiCatalog | null) {
  const replace = (node: MarkdownNode) => {
    if (node.type === 'text' && node.value) node.value = node.value.replace(/:([a-z0-9_+-]+):/g, (_written, name: string) => emojiForName(name, catalog))
    node.children?.forEach(replace)
  }
  return () => replace
}

/** A web link opens through the app (in the default browser, or an MR in the app), never inside the window. */
function MarkdownAnchor({ children, href }: { children?: ReactNode; href?: string }) {
  const { open } = useMarkdownLinks()
  if (!href) return <span>{children}</span>
  const opensThroughApp = open && /^https?:\/\//iu.test(href)
  return <Link href={href} onClick={opensThroughApp ? (event) => { event.preventDefault(); open(href) } : undefined} rel="noopener noreferrer" target="_blank" title={href}>{children}</Link>
}

/** Uploads are read by Rust; WebView never follows an arbitrary image URL. */
function MarkdownImage({ alt, src }: { alt?: string; src?: string }) {
  const { sessionId } = useMarkdownLinks()
  const { data, ready } = useGitLabImage(sessionId, src)
  if (data) return <Box component="img" alt={alt ?? ''} loading="lazy" sx={{ display: 'block', height: 'auto', maxHeight: 480, maxWidth: '100%', objectFit: 'contain' }} src={data} />
  return <Typography component="span" color="textSecondary" variant="caption">[画像: {alt || '説明なし'} · {sessionId && src && !ready ? '読み込み中' : '表示できません'}]</Typography>
}

const components: Components = {
  a: ({ href, children }) => <MarkdownAnchor href={href}>{children}</MarkdownAnchor>,
  img: ({ alt, src }) => <MarkdownImage alt={alt} src={src} />,
  code: ({ children }) => <Typography component="code" variant="code" sx={{ fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>{children}</Typography>,
}

/** Parsed comment bodies, most recently used last; reopening a thread reuses them. */
const parsedBodies = new Map<string, ReactElement>()
const MAX_PARSED_BODIES = 2000

function parseMarkdown(body: string, catalog: EmojiCatalog | null, base: MarkdownLinkBase): ReactElement {
  // Bodies parsed before the emoji list loaded only know the common emoji, so they are kept apart;
  // so are bodies from different projects, whose references point elsewhere.
  const key = `${catalog ? 'emoji' : 'common'}\n${base.instanceUrl ?? ''}\n${base.projectUrl ?? ''}\n${body}`
  const cached = parsedBodies.get(key)
  if (cached) {
    parsedBodies.delete(key)
    parsedBodies.set(key, cached)
    return cached
  }
  const remarkPlugins = [remarkGfm, remarkGitLabEmoji(catalog), remarkGitLabReferences(base)]
  const urlTransform = (url: string) => resolveMarkdownUrl(url, base)
  // `Markdown` is synchronous and uses no hooks, so its output can be kept and reused.
  const parsed = Markdown({ children: body, components, remarkPlugins, skipHtml: true, urlTransform })
  parsedBodies.set(key, parsed)
  if (parsedBodies.size > MAX_PARSED_BODIES) parsedBodies.delete(parsedBodies.keys().next().value!)
  return parsed
}

/** A local preview of basic Markdown, GitLab emoji and references; other GitLab-specific commands are not executed. */
export const MockMarkdown = memo(function MockMarkdown({ body, size = 'body2' }: { body: string; size?: 'body1' | 'body2' }) {
  const { catalog } = useEmojiCatalog()
  const { instanceUrl, projectUrl } = useMarkdownLinks()
  return <Box sx={markdownBodySx(size)}>{parseMarkdown(body, catalog, { instanceUrl, projectUrl })}</Box>
})
