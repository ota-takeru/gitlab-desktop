import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'

import {
  GitLabCommandError,
  isGitLabErrorShape,
  type GitLabAction,
  type GitLabErrorCode,
  type GitLabErrorShape,
  type GitLabQuery,
  type GitLabQueryData,
  type GitLabQueryMode,
  type GitLabSession,
  type GitLabSnapshot,
} from '../types/gitlab'

export interface ConnectGitLabInput {
  url: string
  token: string
}

export interface QueryGitLabInput<Q extends GitLabQuery> {
  sessionId: string
  query: Q
  mode: GitLabQueryMode
  requestId?: string
}

export interface MutateGitLabInput {
  sessionId: string
  action: GitLabAction
  localDraftKey?: string
  requestId?: string
}

const browserError: GitLabErrorShape = {
  code: 'UNSUPPORTED',
  message: 'ブラウザプレビューではGitLab接続を利用できません。デスクトップ版で接続してください。',
}

export function isTauri(): boolean {
  return tauriIsTauri()
}

export function createRequestId(prefix = 'gitlab'): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function connectGitLab(input: ConnectGitLabInput): Promise<GitLabSession> {
  ensureDesktop()
  try {
    return await invoke<GitLabSession>('connect_gitlab', { input })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

/**
 * Imports a credential that glab already keeps for the requested GitLab
 * origin. The credential itself never crosses into the frontend; Rust reads
 * it and returns only the normal, typed session DTO.
 */
export async function connectGitLabFromGlab(url: string): Promise<GitLabSession> {
  ensureDesktop()
  try {
    return await invoke<GitLabSession>('connect_gitlab_from_glab', { url })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export async function restoreGitLabSession(): Promise<GitLabSession | null> {
  ensureDesktop()
  try {
    return await invoke<GitLabSession | null>('restore_session')
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export async function disconnectGitLab(sessionId: string): Promise<void> {
  ensureDesktop()
  try {
    await invoke<void>('disconnect_gitlab', { sessionId })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export async function queryGitLab<Q extends GitLabQuery>({
  mode,
  query,
  requestId = createRequestId('query'),
  sessionId,
}: QueryGitLabInput<Q>): Promise<GitLabSnapshot<GitLabQueryData<Q>> | null> {
  ensureDesktop()
  try {
    return await invoke<GitLabSnapshot<GitLabQueryData<Q>> | null>('query_gitlab', {
      input: { mode, query, requestId, sessionId },
    })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export async function mutateGitLab({
  action,
  localDraftKey,
  requestId = createRequestId('mutation'),
  sessionId,
}: MutateGitLabInput): Promise<void> {
  ensureDesktop()
  try {
    const input = localDraftKey === undefined
      ? { action, requestId, sessionId }
      : { action, localDraftKey, requestId, sessionId }
    await invoke<void>('mutate_gitlab', {
      input,
    })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export async function clearGitLabCache(sessionId: string): Promise<void> {
  ensureDesktop()
  try {
    await invoke<void>('clear_gitlab_cache', { sessionId })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export async function cancelGitLabRequest(sessionId: string, requestId: string): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke<void>('cancel_gitlab_request', { sessionId, requestId })
  } catch (error) {
    // Cancellation is best effort during unmount. A completed request or a
    // native shutdown should never turn into a visible page error.
    void error
  }
}

export async function openGitLabUrl(sessionId: string, url: string): Promise<void> {
  ensureDesktop()
  try {
    await invoke<void>('open_gitlab_url', { sessionId, url })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

/**
 * Reads a cached page immediately and then asks Rust for a network refresh.
 * Each callback is guarded by the caller's lifecycle, so a page can unmount
 * while an IPC request is still in flight without updating stale UI.
 */
export async function queryCacheFirst<Q extends GitLabQuery>(
  input: Omit<QueryGitLabInput<Q>, 'mode'>,
  callbacks: {
    onSnapshot: (snapshot: GitLabSnapshot<GitLabQueryData<Q>>) => void
    onError: (error: GitLabCommandError) => void
  },
): Promise<void> {
  const requestId = input.requestId ?? createRequestId('query')
  try {
    const cached = await queryGitLab({ ...input, mode: 'cache', requestId })
    if (cached) callbacks.onSnapshot(cached)
  } catch (error) {
    // A cache miss is represented by null. Storage failures still matter but
    // must not prevent a network request from recovering the page.
    if (error instanceof GitLabCommandError && error.code !== 'NOT_FOUND') callbacks.onError(error)
  }

  try {
    const fresh = await queryGitLab({ ...input, mode: 'network', requestId })
    if (fresh) callbacks.onSnapshot(fresh)
  } catch (error) {
    callbacks.onError(normalizeGitLabError(error))
  }
}

export function normalizeGitLabError(error: unknown): GitLabCommandError {
  if (error instanceof GitLabCommandError) return error

  if (isGitLabErrorShape(error)) {
    return new GitLabCommandError({
      code: normalizeErrorCode(error.code),
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    })
  }

  if (error instanceof Error) {
    return new GitLabCommandError({ code: 'UNKNOWN', message: error.message })
  }

  if (typeof error === 'string' && error.length > 0) {
    return new GitLabCommandError({ code: 'UNKNOWN', message: error })
  }

  return new GitLabCommandError({ code: 'UNKNOWN', message: 'GitLabコマンドに失敗しました。' })
}

function ensureDesktop(): void {
  if (!isTauri()) throw new GitLabCommandError(browserError)
}

function normalizeErrorCode(code: string): GitLabErrorCode {
  const codes: readonly GitLabErrorCode[] = [
    'AUTH_REQUIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'NETWORK',
    'TIMEOUT',
    'RATE_LIMITED',
    'BUSY',
    'INVALID_INPUT',
    'STORAGE',
    'UNSUPPORTED',
    'TOO_LARGE',
    'UNKNOWN_OUTCOME',
    'CANCELLED',
    'UNKNOWN',
  ]
  return codes.includes(code as GitLabErrorCode) ? (code as GitLabErrorCode) : 'UNKNOWN'
}
