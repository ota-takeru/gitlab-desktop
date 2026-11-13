import type { ReactElement } from 'react'

/** Parsed comment bodies, most recently used last; reopening a thread reuses them. */
export const parsedBodies = new Map<string, ReactElement>()
/** Empties the parsed bodies: on logout, on account replacement and when memory runs short. */
export function clearParsedMarkdown() { parsedBodies.clear() }
globalThis.addEventListener?.('gitlab-explicit-logout', clearParsedMarkdown)
globalThis.addEventListener?.('gitlab-account-replaced', clearParsedMarkdown)
