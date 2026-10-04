import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  connectGitLab,
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
  disconnect: () => Promise<void>
  restore: () => Promise<GitLabSession | null>
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GitLabSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>(() => (isTauri() ? 'checking' : 'unsupported'))
  const [error, setError] = useState<GitLabCommandError | null>(null)
  const operationRef = useRef(0)

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
      setSession(validSession)
      setStatus(validSession ? 'connected' : 'disconnected')
      return validSession
    } catch (caught) {
      if (operation !== operationRef.current) return null
      const nextError = normalizeGitLabError(caught)
      setSession(null)
      setError(nextError)
      setStatus(nextError.code === 'AUTH_REQUIRED' ? 'disconnected' : 'error')
      return null
    }
  }, [])

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

  const connect = useCallback(async (input: ConnectGitLabInput) => {
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
      const nextSession = await connectGitLab(input)
      if (operation !== operationRef.current) return null
      if (!isSessionShape(nextSession)) throw new Error('GitLab接続の応答が不正です。')
      setSession(nextSession)
      setStatus('connected')
      return nextSession
    } catch (caught) {
      if (operation !== operationRef.current) return null
      const nextError = normalizeGitLabError(caught)
      setSession(null)
      setError(nextError)
      setStatus(nextError.code === 'AUTH_REQUIRED' ? 'disconnected' : 'error')
      return null
    }
  }, [])

  const disconnect = useCallback(async () => {
    const current = session
    if (!current) {
      setStatus(isTauri() ? 'disconnected' : 'unsupported')
      return
    }
    const scope = { instanceUrl: current.instanceUrl, userId: current.user.id }
    const operation = ++operationRef.current
    setStatus('checking')
    setError(null)
    try {
      await disconnectGitLab(current.id)
      if (operation !== operationRef.current) return
      clearPreferences(scope)
      setSession(null)
      setStatus('disconnected')
    } catch (caught) {
      if (operation !== operationRef.current) return
      const nextError = normalizeGitLabError(caught)
      clearPreferences(scope)
      setSession(null)
      setError(nextError)
      setStatus('error')
    }
  }, [session])

  const value = useMemo<ConnectionContextValue>(() => ({
    connect,
    disconnect,
    error,
    restore,
    session,
    status,
  }), [connect, disconnect, error, restore, session, status])

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
