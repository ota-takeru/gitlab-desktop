import { startTransition, useEffect, useRef, useState } from 'react'

/**
 * useSyncExternalStore for data that arrives by itself (GitLab answers, loaded pages):
 * every render reads the latest snapshot, but a change of the store renders in a
 * transition, in slices a click or a keystroke interrupts, instead of holding up the
 * frame. useSyncExternalStore always renders a change at once. Not for state that
 * must follow the reader's own input, such as text being typed. The store must not
 * notify while a component renders (the query cache does; see useQueryCacheSubscription).
 */
export function useStoreInTransition<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T {
  const snapshot = getSnapshot()
  // Only a trigger: setting the snapshot it already holds renders nothing.
  const [, setSeen] = useState(snapshot)
  const read = useRef(getSnapshot)
  const shown = useRef(snapshot)
  useEffect(() => { read.current = getSnapshot; shown.current = snapshot })
  useEffect(() => {
    const follow = () => {
      const next = read.current()
      if (!Object.is(next, shown.current)) startTransition(() => setSeen(next))
    }
    // A change between rendering and subscribing would otherwise be missed.
    follow()
    return subscribe(follow)
  }, [subscribe])
  return snapshot
}
