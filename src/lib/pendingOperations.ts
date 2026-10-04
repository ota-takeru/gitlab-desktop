import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'

import { normalizeGitLabError } from './gitlab'
import type { GitLabAction } from '../types/gitlab'

export interface PendingOperationLookup {
  sessionId: string
  projectId: string
  iid: string
}

export interface PendingOperation {
  id: string
  action: GitLabAction
  startedAt: number
}

/**
 * Reads the native receipt for a resource. Memory-only preview resources do
 * not have a durable receipt and are handled by the mutation registry.
 */
export async function getPendingOperation(input: PendingOperationLookup): Promise<PendingOperation | null> {
  if (!tauriIsTauri()) return null
  try {
    const value = await invoke<unknown>('get_pending_operation', { ...input })
    return value === null ? null : parsePendingOperation(value)
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

/**
 * A receipt is acknowledged only after the user has verified the result.
 * Native code compares the complete receipt id while holding its mutation
 * lock, so an old UI cannot acknowledge a newer operation.
 */
export async function acknowledgePendingOperation(input: PendingOperationLookup & { receiptId: string }): Promise<void> {
  if (!tauriIsTauri()) return
  try {
    await invoke<void>('acknowledge_pending_operation', { ...input })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

function parsePendingOperation(value: unknown): PendingOperation {
  if (!value || typeof value !== 'object') throw new Error('保留中の投稿記録が不正です。')
  const candidate = value as { id?: unknown; action?: unknown; startedAt?: unknown }
  if (typeof candidate.id !== 'string' || !candidate.id || !Number.isFinite(candidate.startedAt) || !isGitLabAction(candidate.action)) {
    throw new Error('保留中の投稿記録が不正です。')
  }
  return { action: candidate.action, id: candidate.id, startedAt: candidate.startedAt as number }
}

function isGitLabAction(value: unknown): value is GitLabAction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { kind?: unknown; projectId?: unknown; iid?: unknown }
  const kinds = ['comment', 'reply', 'editNote', 'deleteNote', 'resolve', 'saveDraft', 'editDraft', 'deleteDraft', 'publishDraft', 'approve', 'unapprove'] as const
  return typeof candidate.kind === 'string' && (kinds as readonly string[]).includes(candidate.kind) && typeof candidate.projectId === 'string' && typeof candidate.iid === 'string'
}
