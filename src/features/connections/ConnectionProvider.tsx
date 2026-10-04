import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  connectGitLab,
  connectGitLabFromGlab,
  disconnectGitLab,
  isTauri,
  normalizeGitLabError,
  restoreGitLabSession,
  type ConnectGitLabInput,
} from '../../lib/gitlab'
import type { GitLabCommandError, GitLabSession } from '../../types/gitlab'
import { clearPreferences } from '../shared/preferences'

export type ConnectionStatus = 'checking' | 'disconnected' | 'connected' | 'error' | 'unsupported'

interface ConnectionContextValue {
  session: GitLabSession | null
  status: ConnectionStatus
  error: GitLabCommandError | null
  connect: (input: ConnectGitLabInput) => Promise<GitLabSession | null>
  connectFromGlab: (url: string) => Promise<GitLabSession | null>
  disconnect: () => Promise<void>
  restore: () => Promise<GitLabSession | null>
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

interface AccountIdentity {
  instanceUrl: string
  userId: string
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GitLabSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>(() => (isTauri() ? 'checking' : 'unsupported'))
  const [error, setError] = useState<GitLabCommandError | null>(null)
  const operationRef = useRef(0)
  const lastKnownAccountRef = useRef<AccountIdentity | null>(null)

  const adoptSession = useCallback((nextSession: GitLabSession) => {
    const nextAccount = getAccountIdentity(nextSession)
    const previousAccount = lastKnownAccountRef.current
    if (previousAccount && !sameAccount(previousAccount, nextAccount)) {
      globalThis.dispatchEvent(new Event('gitlab-account-replaced'))
    }
    lastKnownAccountRef.current = nextAccount
    setSession(nextSession)
    setStatus('connected')
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
      if (validSession) adoptSession(validSession)
      else {
        setSession(null)
        setStatus('disconnected')
      }
      return validSession
    } catch (caught) {
      if (operation !== operationRef.current) return null
      const nextError = normalizeGitLabError(caught)
      setSession(null)
      setError(nextError)
      setStatus(nextError.code === 'AUTH_REQUIRED' ? 'disconnected' : 'error')
      return null
    }
  }, [adoptSession])

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
      if (session) clearPreferences({ instanceUrl: session.instanceUrl, userId: session.user.id })
      operationRef.current += 1
      setSession(null)
      setStatus('disconnected')
      setError(normalizeGitLabError({ code: 'AUTH_REQUIRED', message: 'GitLabの認証が必要です。再接続してください。' }))
    }
    globalThis.addEventListener('gitlab-auth-required', handleAuthRequired)
    return () => globalThis.removeEventListener('gitlab-auth-required', handleAuthRequired)
  }, [session])

  const connectWith = useCallback(async (attempt: () => Promise<GitLabSession>) => {
    const previousSession = session
    if (!isTauri()) {
      const unsupported = new Error('ブラウザプレビューではGitLab接続を利用できません。')
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
      if (!isSessionShape(nextSession)) throw new Error('GitLab接続の応答が不正です。')
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
    restore,
    session,
    status,
  }), [connect, connectFromGlab, disconnect, error, restore, session, status])

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used within ConnectionProvider')
  return value
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
