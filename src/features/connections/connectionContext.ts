import { createContext, useContext } from 'react'

import type { ConnectGitLabInput } from '../../lib/gitlab'
import type { GitLabCommandError, GitLabSession } from '../../types/gitlab'

export type ConnectionStatus = 'checking' | 'disconnected' | 'connected' | 'error' | 'unsupported'

/** The saved account whose token stopped working; its username is known when it expired during use. */
export interface ReauthAccount {
  instanceUrl: string
  username: string | null
}

export interface ConnectionContextValue {
  session: GitLabSession | null
  status: ConnectionStatus
  error: GitLabCommandError | null
  connect: (input: ConnectGitLabInput) => Promise<GitLabSession | null>
  connectFromGlab: (url: string) => Promise<GitLabSession | null>
  disconnect: () => Promise<void>
  restore: () => Promise<GitLabSession | null>
  /** Set after the token expired: the screen stays where it was until the user reconnects. */
  reauthRequired: ReauthAccount | null
  /** Restoring the saved connection failed, so retrying it can help. */
  restoreFailed: boolean
  /** A new token for the connected (or expired) account, keeping its unsent input and receipts. */
  refreshToken: (token: string) => Promise<GitLabSession | null>
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used within ConnectionProvider')
  return value
}
