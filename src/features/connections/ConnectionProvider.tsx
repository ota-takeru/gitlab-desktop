import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  connectGitLab,
  connectGitLabFromGlab,
  disconnectGitLab,
  isTauri,
  normalizeGitLabError,
  restoreGitLabSession,
  verifyGitLabSession,
  type ConnectGitLabInput,
} from '../../lib/gitlab'
import { translate } from '../../i18n/i18n'
import { reauthenticateGitLab } from '../../lib/session'
import type { GitLabCommandError, GitLabSession } from '../../types/gitlab'
import { clearPreferences } from '../shared/preferences'
import { readLastInstanceUrl, writeLastInstanceUrl } from './lastInstance'
import { ConnectionContext, type ConnectionContextValue, type ConnectionStatus, type ReauthAccount } from './connectionContext'

export type { ConnectionStatus, ReauthAccount } from './connectionContext'

interface AccountIdentity {
  instanceUrl: string
  userId: string
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GitLabSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>(() => (isTauri() ? 'checking' : 'unsupported'))
  const [error, setError] = useState<GitLabCommandError | null>(null)
  const [reauthRequired, setReauthRequired] = useState<ReauthAccount | null>(null)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const operationRef = useRef(0)
  const lastKnownAccountRef = useRef<AccountIdentity | null>(null)

  const adoptSession = useCallback((nextSession: GitLabSession) => {
    const nextAccount = getAccountIdentity(nextSession)
    const previousAccount = lastKnownAccountRef.current
    if (previousAccount && !sameAccount(previousAccount, nextAccount)) {
      globalThis.dispatchEvent(new Event('gitlab-account-replaced'))
    }
    lastKnownAccountRef.current = nextAccount
    writeLastInstanceUrl(nextSession.instanceUrl)
    setReauthRequired(null)
    setRestoreFailed(false)
    setSession(nextSession)
    setStatus('connected')
  }, [])

  const requireReauthentication = useCallback((expired: GitLabSession) => {
    clearPreferences({ instanceUrl: expired.instanceUrl, userId: expired.user.id })
    operationRef.current += 1
    setReauthRequired({ instanceUrl: expired.instanceUrl, username: expired.user.username })
    setSession(null)
    setStatus('disconnected')
    setError(normalizeGitLabError({ code: 'AUTH_REQUIRED', message: translate('connection.errors.authRequired') }))
  }, [])

  const restore = useCallback(async () => {
    if (!isTauri()) {
      setStatus('unsupported')
      return null
    }
    const operation = ++operationRef.current
    setStatus('checking')
    setError(null)
    try {
      const restored = await restoreGitLabSession()
      if (operation !== operationRef.current) return null
      const validSession = restored && isSessionShape(restored) ? restored : null
      if (validSession) {
        adoptSession(validSession)
        // The saved answers show while GitLab confirms the account; Rust ends the session
        // and removes them if it is refused.
        void verifyGitLabSession(validSession.id).catch((caught: unknown) => {
          if (operation !== operationRef.current) return
          const nextError = normalizeGitLabError(caught)
          if (nextError.code === 'AUTH_REQUIRED') {
            requireReauthentication(validSession)
            return
          }
          operationRef.current += 1
          setSession(null)
          setError(nextError)
          setRestoreFailed(true)
          setStatus('error')
        })
      } else {
        setSession(null)
        setRestoreFailed(false)
        setStatus('disconnected')
      }
      return validSession
    } catch (caught) {
      if (operation !== operationRef.current) return null
      const nextError = normalizeGitLabError(caught)
      setSession(null)
      setError(nextError)
      setRestoreFailed(true)
      // An expired saved token can be replaced in place; Rust knows the account.
      const lastInstanceUrl = readLastInstanceUrl()
      if (nextError.code === 'AUTH_REQUIRED' && lastInstanceUrl) setReauthRequired({ instanceUrl: lastInstanceUrl, username: null })
      setStatus(nextError.code === 'AUTH_REQUIRED' ? 'disconnected' : 'error')
      return null
    }
  }, [adoptSession, requireReauthentication])

  useEffect(() => {
    let active = true
    const timer = isTauri() ? globalThis.setTimeout(() => { if (active) void restore() }, 0) : undefined
    return () => {
      active = false
      if (timer !== undefined) globalThis.clearTimeout(timer)
    }
  }, [restore])

  useEffect(() => {
    const handleAuthRequired = (event: Event) => {
      const failedSessionId = (event as CustomEvent<{ sessionId: string }>).detail?.sessionId
      if (!session || failedSessionId !== session.id) return
      requireReauthentication(session)
    }
    globalThis.addEventListener('gitlab-auth-required', handleAuthRequired)
    return () => globalThis.removeEventListener('gitlab-auth-required', handleAuthRequired)
  }, [requireReauthentication, session])

  const connectWith = useCallback(async (attempt: () => Promise<GitLabSession>) => {
    const previousSession = session
    if (!isTauri()) {
      const unsupported = new Error(translate('connection.errors.browserPreview'))
      setError(normalizeGitLabError(unsupported))
      setStatus('unsupported')
      return null
    }

    const operation = ++operationRef.current
    setStatus('checking')
    setError(null)
    try {
      const nextSession = await attempt()
      if (operation !== operationRef.current) return null
      if (!isSessionShape(nextSession)) throw new Error(translate('connection.errors.invalidSession'))
      adoptSession(nextSession)
      return nextSession
    } catch (caught) {
      if (operation !== operationRef.current) return null
      const nextError = normalizeGitLabError(caught)
      setSession(previousSession)
      setError(nextError)
      setStatus(previousSession ? 'connected' : nextError.code === 'AUTH_REQUIRED' || nextError.code === 'BUSY' ? 'disconnected' : 'error')
      return null
    }
  }, [adoptSession, session])

  const connect = useCallback((input: ConnectGitLabInput) => connectWith(() => connectGitLab(input)), [connectWith])
  const connectFromGlab = useCallback((url: string) => connectWith(() => connectGitLabFromGlab(url)), [connectWith])
  // Rust reconnects the saved account and refuses another user's token before
  // changing anything, so unsent input and receipts are kept either way.
  const refreshToken = useCallback((token: string) => connectWith(() => reauthenticateGitLab(token)), [connectWith])

  const disconnect = useCallback(async () => {
    const current = session
    if (!current) {
      setStatus(isTauri() ? 'disconnected' : 'unsupported')
      return
    }
    const scope = { instanceUrl: current.instanceUrl, userId: current.user.id }
    const operation = ++operationRef.current
    let logoutAccepted = false
    setStatus('checking')
    setError(null)
    try {
      await disconnectGitLab(current.id)
      logoutAccepted = true
      if (operation !== operationRef.current) return
      setReauthRequired(null)
      clearPreferences(scope)
      setSession(null)
      setStatus('disconnected')
    } catch (caught) {
      if (operation !== operationRef.current) return
      const nextError = normalizeGitLabError(caught)
      if (nextError.code === 'BUSY') {
        setError(nextError)
        setStatus('connected')
        return
      }
      logoutAccepted = true
      setReauthRequired(null)
      clearPreferences(scope)
      setSession(null)
      setError(nextError)
      setStatus('error')
    } finally {
      // Native refuses logout before touching private data while a write is
      // in flight; that refusal must retain the current input and session.
      if (logoutAccepted && operation === operationRef.current) {
        lastKnownAccountRef.current = null
        globalThis.dispatchEvent(new Event('gitlab-explicit-logout'))
      }
    }
  }, [session])

  const value = useMemo<ConnectionContextValue>(() => ({
    connect,
    connectFromGlab,
    disconnect,
    error,
    reauthRequired,
    refreshToken,
    restore,
    restoreFailed,
    session,
    status,
  }), [connect, connectFromGlab, disconnect, error, reauthRequired, refreshToken, restore, restoreFailed, session, status])

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

function isSessionShape(value: GitLabSession | null): value is GitLabSession {
  return Boolean(value && typeof value.id === 'string' && typeof value.instanceUrl === 'string' && value.user && typeof value.user.id === 'string' && typeof value.user.username === 'string')
}

function getAccountIdentity(session: GitLabSession): AccountIdentity {
  return { instanceUrl: session.instanceUrl, userId: session.user.id }
}

function sameAccount(left: AccountIdentity, right: AccountIdentity): boolean {
  return left.instanceUrl === right.instanceUrl && left.userId === right.userId
}
