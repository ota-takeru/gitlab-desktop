import { useCallback, useSyncExternalStore } from 'react'

import type { MergeRequestActivity } from './activityFeed'

/**
 * The events the workspace monitor found on the user's MRs, per session and MR. The monitor
 * fetches them in the background; the notification button and stack read them here.
 */
const loaded = new Map<string, Map<string, MergeRequestActivity[]>>()
const flattened = new Map<string, MergeRequestActivity[]>()
const listeners = new Set<() => void>()
const empty: MergeRequestActivity[] = []

function changed(sessionId: string) {
  flattened.delete(sessionId)
  for (const listener of listeners) listener()
}

export function publishActivity(sessionId: string, mrKey: string, items: MergeRequestActivity[]) {
  const session = loaded.get(sessionId) ?? new Map<string, MergeRequestActivity[]>()
  loaded.set(sessionId, session)
  session.set(mrKey, items)
  changed(sessionId)
}

export function forgetActivity(sessionId: string, mrKey: string) {
  if (!loaded.get(sessionId)?.delete(mrKey)) return
  changed(sessionId)
}

function snapshot(sessionId: string | null): MergeRequestActivity[] {
  if (!sessionId) return empty
  const session = loaded.get(sessionId)
  if (!session?.size) return empty
  let items = flattened.get(sessionId)
  if (!items) {
    items = [...session.values()].flat()
    flattened.set(sessionId, items)
  }
  return items
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Every loaded event of the session, the same array until one MR's events change. */
export function useLoadedActivity(sessionId: string | null): MergeRequestActivity[] {
  const get = useCallback(() => snapshot(sessionId), [sessionId])
  return useSyncExternalStore(subscribe, get, get)
}
