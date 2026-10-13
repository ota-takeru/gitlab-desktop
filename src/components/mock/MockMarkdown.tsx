import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { memo, type ReactElement } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { markdownBodySx } from '../markdownBodySx'

const remarkPlugins = [remarkGfm]
const components: Components = {
  a: ({ href, children }) => href ? <Link href={href} target="_blank" rel="noopener noreferrer">{children}</Link> : <span>{children}</span>,
  img: ({ alt }) => <Typography component="span" color="text.secondary" variant="caption">[画像: {alt || '説明なし'} · 外部画像は読み込みません]</Typography>,
  code: ({ children }) => <Typography component="code" variant="code" sx={{ fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>{children}</Typography>,
}
const urlTransform = (url: string) => /^(https?:\/\/|mailto:)/i.test(url) ? url : ''

/** Parsed comment bodies, most recently used last; reopening a thread reuses them. */
const parsedBodies = new Map<string, ReactElement>()
const MAX_PARSED_BODIES = 2000

function parseMarkdown(body: string): ReactElement {
  const cached = parsedBodies.get(body)
  if (cached) {
    parsedBodies.delete(body)
    parsedBodies.set(body, cached)
    return cached
  }
  // `Markdown` is synchronous and uses no hooks, so its output can be kept and reused.
  const parsed = Markdown({ children: body, components, remarkPlugins, skipHtml: true, urlTransform })
  parsedBodies.set(body, parsed)
  if (parsedBodies.size > MAX_PARSED_BODIES) parsedBodies.delete(parsedBodies.keys().next().value!)
  return parsed
}

/** A local preview of basic Markdown; GitLab-specific commands are not executed. */
export const MockMarkdown = memo(function MockMarkdown({ body, size = 'body2' }: { body: string; size?: 'body1' | 'body2' }) {
  return <Box sx={markdownBodySx(size)}>{parseMarkdown(body)}</Box>
})
