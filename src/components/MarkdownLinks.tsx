import { useContext, useMemo, type ReactNode } from 'react'

import { MarkdownLinkContext, type MarkdownLinks } from './markdownLinksContext'

/** Tells rendered Markdown below where it was written and how to open its links; inner providers add to outer ones. */
export function MarkdownLinkProvider({ children, instanceUrl, open, projectUrl, repository, sessionId }: MarkdownLinks & { children: ReactNode }) {
  const outer = useContext(MarkdownLinkContext)
  const value = useMemo(() => ({
    instanceUrl: instanceUrl ?? outer.instanceUrl,
    open: open ?? outer.open,
    projectUrl: projectUrl ?? outer.projectUrl,
    repository: repository ?? outer.repository,
    sessionId: sessionId ?? outer.sessionId,
  }), [instanceUrl, open, outer, projectUrl, repository, sessionId])
  return <MarkdownLinkContext.Provider value={value}>{children}</MarkdownLinkContext.Provider>
}
