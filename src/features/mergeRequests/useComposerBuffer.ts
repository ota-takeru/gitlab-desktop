import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { getLocalDraft, isDesktopRuntime, setLocalDraft } from '../../lib/localDrafts'
import type { GitLabSession, Position } from '../../types/gitlab'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'

const MAX_COMPOSER_BUFFERS = 100
const MAX_COMPOSER_BODY_LENGTH = 64 * 1024
const MAX_COMPOSER_KEY_LENGTH = 4096
const COMPOSER_SAVE_DEBOUNCE_MS = 500
const LOCAL_DRAFT_SAVE_ERROR = 'この端末への保存に失敗しました。入力は保持されています。'

export type ComposerPersistenceStatus = 'memory' | 'hydrating' | 'saving' | 'saved' | 'error'

interface BufferEntry {
  backendKey: string
  body: string
  error: string | null
  generation: number
  hydratedSessionId: string | null
  hydrationSessionId: string | null
  listeners: Set<() => void>
  persistFailed: boolean
  queue: Promise<boolean>
  resetTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  revision: number
  sessionId: string | null
  setUnsafe?: (unsafe: boolean) => void
  status: ComposerPersistenceStatus
}

const composerBuffers = new Map<string, BufferEntry>()
const composerStoreListeners = new Set<() => void>()
let composerStoreGeneration = 0
let retainedComposerUnsafe = false

function subscribeComposerStore(listener: () => void): () => void {
  composerStoreListeners.add(listener)
  return () => composerStoreListeners.delete(listener)
}

function getRetainedComposerUnsafeSnapshot(): boolean {
  return retainedComposerUnsafe
}

/**
 * Read the retained composer state independently of the React safety context.
 *
 * Composer entries intentionally outlive their mounted editor while navigating
 * between routes. Keeping this subscription at module scope lets the close and
 * update guards recover the state after an error-boundary/provider remount.
 */
export function useRetainedComposerUnsafe(): boolean {
  return useSyncExternalStore(
    subscribeComposerStore,
    getRetainedComposerUnsafeSnapshot,
    getRetainedComposerUnsafeSnapshot,
  )
}

export function createComposerBufferKey(
  session: GitLabSession | null,
  projectId: string,
  iid: string,
  replyId: string,
  position?: Position,
): string {
  return JSON.stringify({
    account: { instanceUrl: session?.instanceUrl ?? '', userId: session?.user.id ?? '' },
    iid,
    position: position ? {
      baseSha: position.baseSha,
      headSha: position.headSha,
      newLine: position.newLine ?? null,
      newPath: position.newPath,
      oldLine: position.oldLine ?? null,
      oldPath: position.oldPath,
      positionType: position.positionType,
      startSha: position.startSha,
    } : null,
    projectId,
    replyId,
  })
}

/** Return the stable native-storage target without the account partition. */
export function createComposerBackendKey(bufferKey: string): string {
  try {
    const parsed = JSON.parse(bufferKey) as unknown
    if (!isRecord(parsed) || !Object.prototype.hasOwnProperty.call(parsed, 'account')) return bufferKey
    return JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'account')))
  } catch {
    // Tests and callers may use opaque non-JSON keys for memory-only buffers.
    return bufferKey
  }
}

/** Clear all private in-memory review text when the user explicitly logs out. */
export function clearComposerBufferStore(): void {
  composerStoreGeneration += 1
  const entries = [...composerBuffers.entries()]
  for (const [key, entry] of entries) {
    if (entry.resetTimer !== undefined) globalThis.clearTimeout(entry.resetTimer)
    entry.resetTimer = undefined
    entry.generation = composerStoreGeneration
    entry.body = ''
    entry.error = null
    entry.hydratedSessionId = null
    entry.hydrationSessionId = null
    entry.persistFailed = false
    entry.revision += 1
    entry.sessionId = null
    entry.status = 'memory'
    if (entry.listeners.size === 0) {
      composerBuffers.delete(key)
    } else {
      // Keep subscribed entries in place so a mounted composer remains wired
      // to the store after its contents are cleared.
      notify(entry)
    }
  }
  notifyComposerStore()
}

/** Flush pending saves before an explicit destructive action or window close. */
export async function flushComposerBuffers(): Promise<boolean> {
  const entries = [...composerBuffers.values()]
  for (const entry of entries) flushEntryTimer(entry)

  const results = await Promise.all(entries.map((entry) => entry.queue))
  return results.every(Boolean) && entries.every((entry) => !entry.persistFailed)
}

export function useComposerBuffer(bufferKey: string, sessionId: string | null = null) {
  const [, forceUpdate] = useState(0)
  const { setUnsafe } = useAutoUpdateSafety(`composer:${bufferKey}`, { persistOnUnmount: true })
  const entry = getOrCreateEntry(bufferKey)

  useEffect(() => {
    const current = getOrCreateEntry(bufferKey)
    const listener = () => forceUpdate((value) => value + 1)
    current.listeners.add(listener)
    current.setUnsafe = setUnsafe
    updateSession(current, sessionId)
    syncSafety(current)
    listener()
    void hydrateEntry(current, sessionId)

    return () => {
      current.listeners.delete(listener)
      if (!current.listeners.size) current.setUnsafe = undefined
      // Keep the entry and its debounce timer alive across route/unmount
      // changes. The updater guard intentionally remains active for retained
      // text until an explicit clear or a successful deletion.
      if (!current.listeners.size && !current.body && current.status === 'memory') {
        composerBuffers.delete(bufferKey)
        notifyComposerStore()
      }
    }
  }, [bufferKey, forceUpdate, sessionId, setUnsafe])

  const change = useCallback((nextBody: string): boolean => {
    const currentEntry = getOrCreateEntry(bufferKey)
    if (new TextEncoder().encode(nextBody).byteLength > MAX_COMPOSER_BODY_LENGTH) {
      currentEntry.error = 'コメントは64 KiB以内で入力してください。超過した内容は保存されていません。'
      notify(currentEntry)
      return false
    }
    if (!nextBody && !currentEntry.body && currentEntry.status === 'memory') {
      currentEntry.error = null
      notify(currentEntry)
      return true
    }
    if (nextBody && !currentEntry.body && countNonEmptyBuffers() >= MAX_COMPOSER_BUFFERS) {
      currentEntry.error = '未送信コメントは100件まで保持できます。既存の入力を送信または破棄してください。'
      notify(currentEntry)
      return false
    }

    currentEntry.body = nextBody
    currentEntry.error = null
    currentEntry.persistFailed = false
    currentEntry.revision += 1
    if (canPersist(currentEntry)) {
      currentEntry.status = 'saving'
      scheduleEntrySave(currentEntry)
    } else {
      currentEntry.status = 'memory'
    }
    notify(currentEntry)
    return true
  }, [bufferKey])

  const discard = useCallback(() => {
    change('')
  }, [change])

  return {
    body: entry.body,
    change,
    discard,
    error: entry.error,
    persistenceStatus: entry.status,
  }
}

function getOrCreateEntry(bufferKey: string): BufferEntry {
  const existing = composerBuffers.get(bufferKey)
  if (existing) return existing

  const entry: BufferEntry = {
    backendKey: createComposerBackendKey(bufferKey),
    body: '',
    error: null,
    generation: composerStoreGeneration,
    hydratedSessionId: null,
    hydrationSessionId: null,
    listeners: new Set(),
    persistFailed: false,
    queue: Promise.resolve(true),
    resetTimer: undefined,
    revision: 0,
    sessionId: null,
    status: 'memory',
  }
  composerBuffers.set(bufferKey, entry)
  return entry
}

function updateSession(entry: BufferEntry, sessionId: string | null): void {
  if (entry.sessionId === sessionId) return
  const wasPersisting = entry.status === 'saving'
  const hasBody = Boolean(entry.body)
  entry.sessionId = sessionId
  entry.hydratedSessionId = null
  entry.hydrationSessionId = null
  if (sessionId && isDesktopRuntime()) {
    entry.status = 'hydrating'
    // Re-authentication replaces the native session id. Requeue the current
    // text against that session so a pending write cannot remain attached to
    // the expired session.
    if (hasBody || wasPersisting) scheduleEntrySave(entry)
  } else {
    if (entry.resetTimer !== undefined) globalThis.clearTimeout(entry.resetTimer)
    entry.resetTimer = undefined
    entry.status = 'memory'
  }
  notify(entry)
}

async function hydrateEntry(entry: BufferEntry, sessionId: string | null): Promise<void> {
  if (!sessionId || !isDesktopRuntime()) return
  if (entry.hydratedSessionId === sessionId || entry.hydrationSessionId === sessionId) return

  entry.hydrationSessionId = sessionId
  const generation = entry.generation
  const revision = entry.revision
  if (!entry.body) {
    entry.status = 'hydrating'
    entry.error = null
    notify(entry)
  }

  try {
    const draft = await getLocalDraft(sessionId, entry.backendKey)
    if (!isActiveEntry(entry, generation) || entry.sessionId !== sessionId) return
    entry.hydrationSessionId = null
    entry.hydratedSessionId = sessionId

    // Never let a late read overwrite text entered while hydration was in
    // flight. The user's revision always wins over persisted content.
    if (entry.revision === revision && draft?.body) {
      if (new TextEncoder().encode(draft.body).byteLength > MAX_COMPOSER_BODY_LENGTH) {
        entry.status = 'error'
        entry.error = LOCAL_DRAFT_SAVE_ERROR
      } else if (!entry.body && countNonEmptyBuffers() < MAX_COMPOSER_BUFFERS) {
        entry.body = draft.body
        entry.status = 'saved'
      } else if (!entry.body) {
        entry.status = 'error'
        entry.error = '未送信コメントは100件まで保持できます。既存の入力を送信または破棄してください。'
      } else {
        entry.status = 'saved'
      }
    } else if (entry.revision === revision && entry.status === 'hydrating') {
      entry.status = 'saved'
    }
    notify(entry)
  } catch {
    if (!isActiveEntry(entry, generation) || entry.sessionId !== sessionId) return
    entry.hydrationSessionId = null
    entry.status = 'error'
    entry.error = LOCAL_DRAFT_SAVE_ERROR
    notify(entry)
  }
}

function scheduleEntrySave(entry: BufferEntry): void {
  if (entry.resetTimer !== undefined) globalThis.clearTimeout(entry.resetTimer)
  if (!canPersist(entry)) {
    entry.resetTimer = undefined
    return
  }
  entry.resetTimer = globalThis.setTimeout(() => {
    entry.resetTimer = undefined
    const sessionId = entry.sessionId
    if (!sessionId) return
    enqueuePersist(entry, sessionId, entry.body, entry.revision)
  }, COMPOSER_SAVE_DEBOUNCE_MS)
}

function flushEntryTimer(entry: BufferEntry): void {
  if (entry.resetTimer === undefined) return
  globalThis.clearTimeout(entry.resetTimer)
  entry.resetTimer = undefined
  const sessionId = entry.sessionId
  if (!sessionId || !canPersist(entry)) return
  enqueuePersist(entry, sessionId, entry.body, entry.revision)
}

function enqueuePersist(entry: BufferEntry, sessionId: string, body: string, revision: number): void {
  const generation = entry.generation
  const operation = async (): Promise<boolean> => {
    if (!isActiveEntry(entry, generation) || entry.sessionId !== sessionId) return true
    try {
      await setLocalDraft(sessionId, entry.backendKey, body)
      if (isActiveEntry(entry, generation) && entry.sessionId === sessionId && entry.revision === revision) {
        entry.status = 'saved'
        entry.error = null
        entry.persistFailed = false
        notify(entry)
      }
      return true
    } catch {
      if (isActiveEntry(entry, generation) && entry.sessionId === sessionId && entry.revision === revision) {
        entry.status = 'error'
        entry.error = LOCAL_DRAFT_SAVE_ERROR
        entry.persistFailed = true
        notify(entry)
      }
      return false
    }
  }
  entry.queue = entry.queue.then(operation, operation)
}

function canPersist(entry: BufferEntry): boolean {
  return Boolean(entry.sessionId && isDesktopRuntime() && isValidBackendKey(entry.backendKey))
}

function isValidBackendKey(key: string): boolean {
  const size = new TextEncoder().encode(key).byteLength
  return size > 0 && size <= MAX_COMPOSER_KEY_LENGTH
}

function isActiveEntry(entry: BufferEntry, generation: number): boolean {
  return entry.generation === generation && [...composerBuffers.values()].includes(entry)
}

function countNonEmptyBuffers(): number {
  let count = 0
  for (const entry of composerBuffers.values()) if (entry.body) count += 1
  return count
}

function notify(entry: BufferEntry): void {
  syncSafety(entry)
  for (const listener of [...entry.listeners]) listener()
  notifyComposerStore()
}

function syncSafety(entry: BufferEntry): void {
  entry.setUnsafe?.(isEntryUnsafe(entry))
}

function notifyComposerStore(): void {
  retainedComposerUnsafe = [...composerBuffers.values()].some(isEntryUnsafe)
  for (const listener of [...composerStoreListeners]) listener()
}

function isEntryUnsafe(entry: BufferEntry): boolean {
  return Boolean(entry.body) || entry.status === 'saving' || entry.status === 'hydrating' || entry.persistFailed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
