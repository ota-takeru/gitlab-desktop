import { createContext, useContext, useEffect, useState } from 'react'

import { getMemoryPressure } from '../../lib/runtime'

/** How often the system's memory is read while the window is visible. */
const MEMORY_CHECK_INTERVAL_MS = 15_000

/** While the system is short of memory, screens keep fewer hidden views and less fetched data. */
export const MemoryPressure = createContext(false)
export function useMemoryPressure() { return useContext(MemoryPressure) }

/** Reads the system's memory now and then while the window is visible; `onReading` hears every reading. */
export function useMemoryPressureReading(onReading: (constrained: boolean) => void): boolean {
  const [constrained, setConstrained] = useState(false)
  useEffect(() => {
    let cancelled = false
    const check = () => {
      if (document.visibilityState !== 'visible') return
      void getMemoryPressure().then((next) => {
        if (cancelled) return
        setConstrained(next)
        onReading(next)
      }, () => undefined)
    }
    check()
    const timer = globalThis.setInterval(check, MEMORY_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      cancelled = true
      globalThis.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [onReading])
  return constrained
}
