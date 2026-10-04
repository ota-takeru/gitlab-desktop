import { useCallback, useEffect, useId, useSyncExternalStore } from 'react'

import { mutateGitLab, normalizeGitLabError } from '../../lib/gitlab'
import type { GitLabAction, GitLabCommandError } from '../../types/gitlab'

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error' | 'unknown'

export interface MutationResult {
  ok: boolean
  status: MutationStatus
  error: GitLabCommandError | null
}

interface MutationSnapshot {
  status: MutationStatus
  error: GitLabCommandError | null
  action: GitLabAction | null
}

interface SafetyOwner {
  mounted: boolean
  setUnsafe: ((unsafe: boolean) => void) | undefined
}

interface MutationEntry {
  sessionId: string | null
  resourceKey: string
  snapshot: MutationSnapshot
  listeners: Set<() => void>
  safetyOwners: Map<string, SafetyOwner>
}

const IDLE_SNAPSHOT: MutationSnapshot = { action: null, error: null, status: 'idle' }
const registry = new Map<string, MutationEntry>()

function registryKey(sessionId: string | null, resourceKey: string): string {
  return JSON.stringify([sessionId ?? '', resourceKey])
}

function getEntry(sessionId: string | null, resourceKey: string): MutationEntry {
  const key = registryKey(sessionId, resourceKey)
  const existing = registry.get(key)
  if (existing) return existing
  const entry: MutationEntry = {
    listeners: new Set(),
    resourceKey,
    safetyOwners: new Map(),
    sessionId,
    snapshot: IDLE_SNAPSHOT,
  }
  registry.set(key, entry)
  return entry
}

function publish(entry: MutationEntry, snapshot: MutationSnapshot): void {
  entry.snapshot = snapshot
  const unsafe = snapshot.status === 'pending' || snapshot.status === 'unknown'
  for (const owner of entry.safetyOwners.values()) owner.setUnsafe?.(unsafe)
  if (!unsafe) {
    for (const [ownerId, owner] of entry.safetyOwners) {
      if (!owner.mounted) entry.safetyOwners.delete(ownerId)
    }
  }
  for (const listener of entry.listeners) listener()
  pruneEntry(entry)
}

function pruneEntry(entry: MutationEntry): void {
  if (entry.listeners.size || entry.safetyOwners.size || entry.snapshot.status === 'pending' || entry.snapshot.status === 'unknown') return
  const key = registryKey(entry.sessionId, entry.resourceKey)
  if (registry.get(key) === entry) registry.delete(key)
}

/** Clear sticky and in-flight UI state when the owning GitLab session is disposed. */
export function clearGitLabMutationStates(sessionId?: string): void {
  for (const [key, entry] of registry) {
    if (sessionId !== undefined && entry.sessionId !== sessionId) continue
    for (const owner of entry.safetyOwners.values()) owner.setUnsafe?.(false)
    entry.listeners.clear()
    entry.safetyOwners.clear()
    registry.delete(key)
  }
}

export function useGitLabMutation(
  sessionId: string | null,
  resourceKey: string,
  onUnsafeChange?: (unsafe: boolean) => void,
) {
  const ownerId = useId()
  const key = registryKey(sessionId, resourceKey)
  const subscribe = useCallback((listener: () => void) => {
    const entry = getEntry(sessionId, resourceKey)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      pruneEntry(entry)
    }
  }, [resourceKey, sessionId])
  const getSnapshot = useCallback(() => registry.get(key)?.snapshot ?? IDLE_SNAPSHOT, [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    const entry = getEntry(sessionId, resourceKey)
    entry.safetyOwners.set(ownerId, { mounted: true, setUnsafe: onUnsafeChange })
    onUnsafeChange?.(entry.snapshot.status === 'pending' || entry.snapshot.status === 'unknown')
    return () => {
      const owner = entry.safetyOwners.get(ownerId)
      if (!owner) return
      if (entry.snapshot.status === 'pending' || entry.snapshot.status === 'unknown') {
        owner.mounted = false
      } else {
        owner.setUnsafe?.(false)
        entry.safetyOwners.delete(ownerId)
        pruneEntry(entry)
      }
    }
  }, [onUnsafeChange, ownerId, resourceKey, sessionId])

  const runDetailed = useCallback(async (action: GitLabAction): Promise<MutationResult> => {
    const entry = getEntry(sessionId, resourceKey)
    if (entry.snapshot.status === 'pending' || entry.snapshot.status === 'unknown') {
      return {
        error: entry.snapshot.status === 'unknown' ? entry.snapshot.error : null,
        ok: false,
        status: entry.snapshot.status,
      }
    }
    if (!sessionId) {
      const error = normalizeGitLabError({ code: 'AUTH_REQUIRED', message: 'GitLabに接続してください。' })
      publish(entry, { action, error, status: 'error' })
      return { error, ok: false, status: 'error' }
    }

    publish(entry, { action, error: null, status: 'pending' })
    try {
      await mutateGitLab({ action, sessionId })
      if (registry.get(key) === entry) publish(entry, { action: null, error: null, status: 'success' })
      return { error: null, ok: true, status: 'success' }
    } catch (caught) {
      const error = normalizeGitLabError(caught)
      const status: MutationStatus = error.code === 'UNKNOWN_OUTCOME' ? 'unknown' : 'error'
      if (registry.get(key) === entry) publish(entry, { action, error, status })
      return { error, ok: false, status }
    }
  }, [key, resourceKey, sessionId])

  const run = useCallback(async (action: GitLabAction): Promise<boolean> => (await runDetailed(action)).ok, [runDetailed])

  const reset = useCallback(() => {
    const entry = getEntry(sessionId, resourceKey)
    if (entry.snapshot.status === 'pending') return
    publish(entry, IDLE_SNAPSHOT)
  }, [resourceKey, sessionId])

  return {
    error: snapshot.error,
    isLocked: snapshot.status === 'unknown',
    isPending: snapshot.status === 'pending',
    reset,
    run,
    runDetailed,
    status: snapshot.status,
    unknownAction: snapshot.status === 'unknown' ? snapshot.action : null,
  }
}
