import { useSyncExternalStore } from 'react'

import type { GitLabCommandError } from '../types/gitlab'

/** Whether recent GitLab requests reached the server. Only network failures count; a denied or missing resource still means GitLab answered. */
export interface Connectivity {
  failing: boolean
  /** The failing request still showed data saved on this device. */
  showingCache: boolean
}

const reachable: Connectivity = { failing: false, showingCache: false }
let current: Connectivity = reachable
const listeners = new Set<() => void>()

function publish(next: Connectivity) {
  if (next.failing === current.failing && next.showingCache === current.showingCache) return
  current = next
  listeners.forEach((listener) => listener())
}

/**
 * Called with each finished GitLab request: an error code from the app's
 * normalized errors, or null after a request that reached GitLab.
 */
export function reportGitLabConnectivity(error: Pick<GitLabCommandError, 'code'> | null | undefined, showingCache = false): void {
  if (!error) {
    publish(reachable)
    return
  }
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT') publish({ failing: true, showingCache })
}

export function resetGitLabConnectivity(): void {
  publish(reachable)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getConnectivity() { return current }

export function useGitLabConnectivity(): Connectivity {
  return useSyncExternalStore(subscribe, getConnectivity, getConnectivity)
}
