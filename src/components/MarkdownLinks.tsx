import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { MarkdownLinkBase } from '../lib/markdownLinks'

export interface MarkdownLinks extends MarkdownLinkBase {
  /** Opens a clicked http(s) link; without it links behave as plain anchors. */
  open?: (url: string) => void
}

const MarkdownLinkContext = createContext<MarkdownLinks>({})

/** Tells rendered Markdown below where it was written and how to open its links; inner providers add to outer ones. */
export function MarkdownLinkProvider({ children, instanceUrl, open, projectUrl }: MarkdownLinks & { children: ReactNode }) {
  const outer = useContext(MarkdownLinkContext)
  const value = useMemo(() => ({
    instanceUrl: instanceUrl ?? outer.instanceUrl,
    open: open ?? outer.open,
    projectUrl: projectUrl ?? outer.projectUrl,
  }), [instanceUrl, open, outer, projectUrl])
  return <MarkdownLinkContext.Provider value={value}>{children}</MarkdownLinkContext.Provider>
}

export function useMarkdownLinks(): MarkdownLinks { return useContext(MarkdownLinkContext) }
