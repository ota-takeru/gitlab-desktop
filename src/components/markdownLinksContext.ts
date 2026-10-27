import { createContext, useContext } from 'react'
import type { MarkdownLinkBase } from '../lib/markdownLinks'

export interface MarkdownLinks extends MarkdownLinkBase {
  /** Opens a clicked http(s) link; without it links behave as plain anchors. */
  open?: (url: string) => void
  /** Only a real authenticated session may load uploads. */
  sessionId?: string
}

export const MarkdownLinkContext = createContext<MarkdownLinks>({})

export function useMarkdownLinks(): MarkdownLinks { return useContext(MarkdownLinkContext) }
