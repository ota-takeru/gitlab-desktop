import { useCallback, useState } from 'react'

/**
 * Conditions of the project and branch lists, kept in memory for the session
 * so that returning from a project or a branch shows the list as it was left.
 * Nothing here is written to disk.
 */
const states = new Map<string, unknown>()
const MAX_STATES = 50

export function useRememberedListState<T extends object>(key: string, initial: T): [T, (patch: Partial<T>) => void] {
  const [value, setValue] = useState<T>(() => (states.get(key) as T | undefined) ?? initial)
  const update = useCallback((patch: Partial<T>) => setValue((current) => {
    const next = { ...current, ...patch }
    states.delete(key)
    states.set(key, next)
    // Oldest first in a Map, so the least recently changed list is forgotten first.
    if (states.size > MAX_STATES) states.delete(states.keys().next().value as string)
    return next
  }), [key])
  return [value, update]
}

/** For tests: forget every remembered list. */
export function forgetRememberedListStates(): void {
  states.clear()
}
