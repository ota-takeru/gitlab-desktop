import { isTauri as tauriIsTauri } from '@tauri-apps/api/core'
import { useCallback, useEffect, useId, useSyncExternalStore } from 'react'

import { acknowledgePendingOperation, getPendingOperation, type PendingOperation } from '../../lib/pendingOperations'
import { mutateGitLab, normalizeGitLabError } from '../../lib/gitlab'
import { GitLabCommandError, type GitLabAction } from '../../types/gitlab'

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

type HydrationState = 'idle' | 'loading' | 'ready' | 'failed'

interface ResourceIdentity {
  projectId: string
  iid: string
}

interface MutationEntry {
  sessionId: string | null
  resourceKey: string
  resource: ResourceIdentity | null
  durable: boolean
  hydration: HydrationState
  hydrationPromise: Promise<boolean> | null
  persistedReceipt: PendingOperation | null
  resetPromise: Promise<boolean> | null
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
  const resource = parseResourceIdentity(resourceKey)
  const durable = Boolean(sessionId && resource && isNativeRuntime())
  const entry: MutationEntry = {
    durable,
    hydration: durable ? 'idle' : 'ready',
    hydrationPromise: null,
    listeners: new Set(),
    persistedReceipt: null,
    resetPromise: null,
    resource,
    resourceKey,
    safetyOwners: new Map(),
    sessionId,
    snapshot: IDLE_SNAPSHOT,
  }
  registry.set(key, entry)
  return entry
}

function isNativeRuntime(): boolean {
  try {
    return tauriIsTauri()
  } catch {
    return false
  }
}

function parseResourceIdentity(resourceKey: string): ResourceIdentity | null {
  try {
    const value = JSON.parse(resourceKey) as { iid?: unknown; projectId?: unknown }
    if (typeof value.projectId !== 'string' || !value.projectId || typeof value.iid !== 'string' || !value.iid) return null
    return { iid: value.iid, projectId: value.projectId }
  } catch {
    // Existing preview/unit resources use human-readable keys such as
    // project-1:1. They intentionally remain memory-only.
    return null
  }
}

function isUnsafe(entry: MutationEntry): boolean {
  return entry.hydration !== 'ready' || entry.snapshot.status === 'pending' || entry.snapshot.status === 'unknown'
}

function hasReadyHydration(entry: MutationEntry): boolean {
  return entry.hydration === 'ready'
}

function getPersistedReceipt(entry: MutationEntry): PendingOperation | null {
  return entry.persistedReceipt
}

function notify(entry: MutationEntry): void {
  // Hydration can change the lock state while the visible mutation status is
  // still `idle`. Give useSyncExternalStore a new snapshot identity so that
  // `isLocked` and auto-update safety are recomputed when the lookup settles.
  entry.snapshot = { ...entry.snapshot }
  const unsafe = isUnsafe(entry)
  for (const owner of entry.safetyOwners.values()) owner.setUnsafe?.(unsafe)
  if (!unsafe) {
    for (const [ownerId, owner] of entry.safetyOwners) {
      if (!owner.mounted) entry.safetyOwners.delete(ownerId)
    }
  }
  for (const listener of entry.listeners) listener()
  pruneEntry(entry)
}

function publish(entry: MutationEntry, snapshot: MutationSnapshot): void {
  entry.snapshot = snapshot
  notify(entry)
}

function pruneEntry(entry: MutationEntry): void {
  if (entry.hydration !== 'ready' || entry.listeners.size || entry.safetyOwners.size || entry.snapshot.status === 'pending' || entry.snapshot.status === 'unknown') return
  const key = registryKey(entry.sessionId, entry.resourceKey)
  if (registry.get(key) === entry) registry.delete(key)
}

function unknownOutcomeError(): GitLabCommandError {
  return new GitLabCommandError({ code: 'UNKNOWN_OUTCOME', message: '前回の投稿結果を確認できません。GitLabで結果を確認してから再送してください。' })
}

function isActive(entry: MutationEntry): boolean {
  return registry.get(registryKey(entry.sessionId, entry.resourceKey)) === entry
}

/**
 * Start native receipt hydration once per registry entry. The entry remains
 * unsafe while the lookup is in flight; a slow response cannot recreate an
 * entry after logout because every continuation checks registry identity.
 */
function ensureHydrated(entry: MutationEntry): Promise<boolean> {
  if (!entry.durable) return Promise.resolve(true)
  if (entry.hydration === 'ready') return Promise.resolve(true)
  if (entry.hydration === 'failed') return Promise.resolve(false)
  if (entry.hydrationPromise) return entry.hydrationPromise

  entry.hydration = 'loading'
  notify(entry)
  const resource = entry.resource
  const sessionId = entry.sessionId
  if (!resource || !sessionId) {
    entry.hydration = 'failed'
    const error = normalizeGitLabError({ code: 'AUTH_REQUIRED', message: 'GitLabに接続してください。' })
    if (entry.snapshot.status === 'idle') publish(entry, { action: null, error, status: 'unknown' })
    else notify(entry)
    return Promise.resolve(false)
  }

  const key = registryKey(entry.sessionId, entry.resourceKey)
  entry.hydrationPromise = (async () => {
    try {
      const receipt = await getPendingOperation({ iid: resource.iid, projectId: resource.projectId, sessionId })
      if (!isActive(entry)) return false
      entry.persistedReceipt = receipt
      entry.hydration = 'ready'
      if (entry.snapshot.status === 'idle' && receipt) {
        publish(entry, { action: receipt.action, error: unknownOutcomeError(), status: 'unknown' })
      } else {
        notify(entry)
      }
      return true
    } catch (caught) {
      if (!isActive(entry)) return false
      entry.hydration = 'failed'
      const error = normalizeGitLabError(caught)
      if (entry.snapshot.status === 'idle' || entry.snapshot.status === 'unknown') {
        publish(entry, { action: entry.snapshot.action, error, status: 'unknown' })
      }
      else notify(entry)
      return false
    } finally {
      if (registry.get(key) === entry) entry.hydrationPromise = null
    }
  })()
  return entry.hydrationPromise
}

async function refreshReceiptAfterUnknown(entry: MutationEntry): Promise<PendingOperation | null> {
  if (!entry.durable || !entry.resource || !entry.sessionId || !isActive(entry)) return null
  try {
    const receipt = await getPendingOperation({ iid: entry.resource.iid, projectId: entry.resource.projectId, sessionId: entry.sessionId })
    if (!isActive(entry)) return null
    entry.persistedReceipt = receipt
    return receipt
  } catch {
    // The original UNKNOWN_OUTCOME remains sticky even when the verification
    // lookup itself is unavailable. Sending again is never made safe here.
    return null
  }
}

/**
 * Re-read the durable receipt without acknowledging it. This is used when a
 * restart lookup failed before the attempted action could be identified, and
 * while the native lookup is in flight the mutation remains unsafe.
 */
async function retryReceiptLookup(entry: MutationEntry): Promise<boolean> {
  if (!entry.durable) {
    if (entry.snapshot.status === 'unknown' && entry.snapshot.action === null) publish(entry, IDLE_SNAPSHOT)
    return true
  }
  if (!isActive(entry)) return false
  if (entry.hydration === 'loading' && entry.hydrationPromise) {
    const hydrated = await entry.hydrationPromise
    return isActive(entry) && hydrated
  }

  // Keep the last displayed receipt while the refresh is in flight. If the
  // lookup fails, a later verification must still reject a newer UUID rather
  // than treating it as the first receipt seen by this UI.
  entry.hydration = 'idle'
  entry.hydrationPromise = null
  notify(entry)
  const hydrated = await ensureHydrated(entry)
  if (!isActive(entry) || !hydrated || !hasReadyHydration(entry)) return false

  const receipt = getPersistedReceipt(entry)
  if (receipt) {
    publish(entry, { action: receipt.action, error: unknownOutcomeError(), status: 'unknown' })
  } else if (entry.snapshot.status === 'unknown' && entry.snapshot.action === null) {
    // No durable marker means the failed lookup did not correspond to a
    // known attempted action, so there is no write to keep locked.
    publish(entry, IDLE_SNAPSHOT)
  } else {
    notify(entry)
  }
  return true
}

/** Clear UI registry state for one disposed session without acknowledging native receipts. */
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
  const entry = getEntry(sessionId, resourceKey)
  const subscribe = useCallback((listener: () => void) => {
    const current = getEntry(sessionId, resourceKey)
    current.listeners.add(listener)
    void ensureHydrated(current)
    return () => {
      current.listeners.delete(listener)
      pruneEntry(current)
    }
  }, [resourceKey, sessionId])
  const getSnapshot = useCallback(() => registry.get(key)?.snapshot ?? IDLE_SNAPSHOT, [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    const current = getEntry(sessionId, resourceKey)
    current.safetyOwners.set(ownerId, { mounted: true, setUnsafe: onUnsafeChange })
    onUnsafeChange?.(isUnsafe(current))
    void ensureHydrated(current)
    return () => {
      const owner = current.safetyOwners.get(ownerId)
      if (!owner) return
      if (isUnsafe(current)) {
        owner.mounted = false
      } else {
        owner.setUnsafe?.(false)
        current.safetyOwners.delete(ownerId)
        pruneEntry(current)
      }
    }
  }, [onUnsafeChange, ownerId, resourceKey, sessionId])

  const runDetailed = useCallback(async (action: GitLabAction, localDraftKey?: string): Promise<MutationResult> => {
    const current = getEntry(sessionId, resourceKey)
    let hydrated = true
    if (current.durable && current.hydration !== 'ready') hydrated = await ensureHydrated(current)
    if (!isActive(current)) return { error: current.snapshot.error, ok: false, status: 'unknown' }
    if (!hydrated || current.hydration !== 'ready') return { error: current.snapshot.error, ok: false, status: 'unknown' }
    if (current.snapshot.status === 'pending' || current.snapshot.status === 'unknown') {
      return {
        error: current.snapshot.status === 'unknown' ? current.snapshot.error : null,
        ok: false,
        status: current.snapshot.status,
      }
    }
    if (!sessionId) {
      const error = normalizeGitLabError({ code: 'AUTH_REQUIRED', message: 'GitLabに接続してください。' })
      publish(current, { action, error, status: 'error' })
      return { error, ok: false, status: 'error' }
    }

    publish(current, { action, error: null, status: 'pending' })
    try {
      await mutateGitLab(localDraftKey === undefined ? { action, sessionId } : { action, localDraftKey, sessionId })
      if (!isActive(current)) {
        const error = new GitLabCommandError({ code: 'CANCELLED', message: '画面が閉じられたため投稿結果を適用できません。' })
        return { error, ok: false, status: 'error' }
      }
      publish(current, { action: null, error: null, status: 'success' })
      return { error: null, ok: true, status: 'success' }
    } catch (caught) {
      const error = normalizeGitLabError(caught)
      const status: MutationStatus = error.code === 'UNKNOWN_OUTCOME' ? 'unknown' : 'error'
      if (isActive(current)) {
        if (status === 'unknown') {
          const receipt = await refreshReceiptAfterUnknown(current)
          if (isActive(current)) publish(current, { action: receipt?.action ?? action, error, status })
        } else {
          publish(current, { action, error, status })
        }
      }
      return { error, ok: false, status }
    }
  }, [resourceKey, sessionId])

  const run = useCallback(async (action: GitLabAction, localDraftKey?: string): Promise<boolean> => (await runDetailed(action, localDraftKey)).ok, [runDetailed])

  const retryLookup = useCallback((): Promise<boolean> => {
    const current = getEntry(sessionId, resourceKey)
    return retryReceiptLookup(current)
  }, [resourceKey, sessionId])

  const reset = useCallback((): Promise<boolean> | boolean => {
    const current = getEntry(sessionId, resourceKey)
    if (!current.durable) {
      if (current.snapshot.status === 'pending') return false
      publish(current, IDLE_SNAPSHOT)
      // Keep the memory-only preview/unit-test path synchronous. `await`
      // callers still accept the boolean, while old in-memory consumers do
      // not need a remount just to observe the reset.
      return true
    }
    if (current.resetPromise) return current.resetPromise
    const resetPromise = (async () => {
      const previousReceiptId = current.persistedReceipt?.id ?? null
      const retryVerificationLookup = current.snapshot.status === 'unknown' || current.hydration === 'failed'
      if (retryVerificationLookup) {
        if (current.snapshot.status === 'pending') return false
        if (!await retryReceiptLookup(current)) return false
      } else {
        const hydrated = await ensureHydrated(current)
        if (!hydrated) return false
      }
      if (!isActive(current) || current.hydration !== 'ready' || current.snapshot.status === 'pending') return false
      const receipt = current.persistedReceipt
      if (receipt && receipt.id !== previousReceiptId) return false
      if (!receipt) {
        publish(current, IDLE_SNAPSHOT)
        return true
      }
      try {
        await acknowledgePendingOperation({ iid: current.resource?.iid ?? '', projectId: current.resource?.projectId ?? '', receiptId: receipt.id, sessionId: current.sessionId ?? '' })
      } catch (caught) {
        if (isActive(current)) publish(current, { action: current.snapshot.action ?? receipt.action, error: normalizeGitLabError(caught), status: 'unknown' })
        return false
      }
      if (!isActive(current) || current.persistedReceipt?.id !== receipt.id) return false
      current.persistedReceipt = null
      publish(current, IDLE_SNAPSHOT)
      return true
    })()
    current.resetPromise = resetPromise
    resetPromise.then(
      () => { if (current.resetPromise === resetPromise) current.resetPromise = null },
      () => { if (current.resetPromise === resetPromise) current.resetPromise = null },
    )
    return resetPromise
  }, [resourceKey, sessionId])

  const locked = entry.hydration !== 'ready' || snapshot.status === 'unknown'
  return {
    error: snapshot.error,
    isLocked: locked,
    isPending: snapshot.status === 'pending',
    retryLookup,
    reset,
    run,
    runDetailed,
    status: snapshot.status,
    unknownAction: snapshot.status === 'unknown' ? snapshot.action : null,
  }
}
