import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * A callback that keeps one identity and always runs the latest `callback`, so
 * memoized children that receive it do not render again for its sake. Call it
 * from events and effects only, not while rendering.
 */
export function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const latest = useRef(callback)
  useLayoutEffect(() => { latest.current = callback })
  return useCallback((...args: A) => latest.current(...args), [])
}
