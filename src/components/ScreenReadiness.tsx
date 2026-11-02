import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ScreenReadinessContext, type HoldScreen } from './screenReadinessContext'

/** How long a screen waits at most for its reads to check the saved data before it shows anyway. */
const READINESS_LIMIT_MS = 1000

/**
 * While `waiting`, tells `onReady` once no read inside holds the screen any more
 * for a whole frame (reads that start from another's data get to start), or after
 * READINESS_LIMIT_MS at most.
 */
export function ScreenReadinessGate({ children, onReady, waiting }: { children: ReactNode; onReady: () => void; waiting: boolean }) {
  const onReadyRef = useRef(onReady)
  useLayoutEffect(() => { onReadyRef.current = onReady })
  const holds = useRef(0)
  const done = useRef(true)
  const frame = useRef(0)
  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    onReadyRef.current()
  }, [])
  const check = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => { if (holds.current === 0) finish() })
  }, [finish])
  const hold = useCallback<HoldScreen>(() => {
    holds.current += 1
    cancelAnimationFrame(frame.current)
    let released = false
    return () => {
      if (released) return
      released = true
      holds.current -= 1
      if (holds.current === 0) check()
    }
  }, [check])
  useEffect(() => {
    if (!waiting) return
    // The reads inside registered their holds in their own effects, which ran before this one.
    done.current = false
    check()
    const timer = setTimeout(finish, READINESS_LIMIT_MS)
    return () => {
      done.current = true
      clearTimeout(timer)
      cancelAnimationFrame(frame.current)
    }
  }, [check, finish, waiting])
  return <ScreenReadinessContext.Provider value={waiting ? hold : null}>{children}</ScreenReadinessContext.Provider>
}
