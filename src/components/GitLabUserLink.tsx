import Link from '@mui/material/Link'
import type { ReactNode } from 'react'

import type { GitLabUser } from '../types/gitlab'
import { useMarkdownLinks } from './markdownLinksContext'

/** User identities and Markdown mentions share the app's profile navigation. */
export function GitLabUserLink({ children, user }: { children?: ReactNode; user: GitLabUser }) {
  const { instanceUrl, open } = useMarkdownLinks()
  const label = children ?? user.name
  if (!instanceUrl || !user.username) return <>{label}</>
  const href = `${instanceUrl.replace(/\/+$/u, '')}/${encodeURIComponent(user.username)}`
  return <Link color="inherit" href={href} onClick={open ? (event) => { event.preventDefault(); event.stopPropagation(); open(href) } : undefined} rel="noopener noreferrer" target="_blank" title={`${user.name} @${user.username}`} underline="hover">{label}</Link>
}
