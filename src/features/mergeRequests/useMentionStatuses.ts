import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { queryGitLab } from '../../lib/gitlab'
import { findMentionRanges, type MentionStatus, type MentionStatuses } from '../../lib/mentionRanges'
import type { GitLabUser } from '../../types/gitlab'

/** Usernames GitLab answered for, lower-case, by session; each answer replaces the session's map. */
const lookedUp = new Map<string, MentionStatuses>()
const pending = new Set<string>()
const listeners = new Set<() => void>()

/**
 * Whether each `@username` in `text` names a GitLab user. Known people count at once; others
 * are looked up once per session after typing pauses, and have no status until GitLab answers.
 */
export function useMentionStatuses(sessionId: string | null, text: string, known: GitLabUser[]): MentionStatuses | undefined {
  const [debouncedText, setDebouncedText] = useState(text)
  const looked = useSyncExternalStore(subscribe, useCallback(() => (sessionId ? lookedUp.get(sessionId) : undefined) ?? NO_STATUSES, [sessionId]))
  const knownNames = useMemo(() => new Set(known.map((user) => user.username.toLowerCase())), [known])

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedText(text), LOOKUP_DELAY_MS)
    return () => globalThis.clearTimeout(timer)
  }, [text])

  useEffect(() => {
    if (!sessionId) return
    for (const { username } of findMentionRanges(debouncedText)) {
      const name = username.toLowerCase()
      const key = `${sessionId}\n${name}`
      if (knownNames.has(name) || lookedUp.get(sessionId)?.has(name) || pending.has(key)) continue
      pending.add(key)
      queryGitLab({ mode: 'network', query: { kind: 'user', username }, sessionId })
        .then((result) => {
          lookedUp.set(sessionId, new Map(lookedUp.get(sessionId)).set(name, result?.data ? 'resolved' : 'unresolved'))
          for (const listener of listeners) listener()
        })
        // Unknown until a later edit asks again, rather than shown as a mistake.
        .catch(() => undefined)
        .finally(() => { pending.delete(key) })
    }
  }, [debouncedText, knownNames, sessionId])

  return useMemo(() => {
    if (!sessionId) return undefined
    const statuses = new Map<string, MentionStatus>()
    for (const { username } of findMentionRanges(text)) {
      const name = username.toLowerCase()
      const status = knownNames.has(name) ? 'resolved' : looked.get(name)
      if (status) statuses.set(name, status)
    }
    return statuses
  }, [knownNames, looked, sessionId, text])
}

export function clearMentionLookups() {
  lookedUp.clear()
  pending.clear()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const LOOKUP_DELAY_MS = 350
const NO_STATUSES: MentionStatuses = new Map()
