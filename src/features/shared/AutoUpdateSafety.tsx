import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type SetUnsafe = (key: string, unsafe: boolean) => void

const noop = () => undefined
// The setter and the result are separate contexts: the many sources that only
// report (composers, writes, edits) do not render again whenever any source changes.
const SetUnsafeContext = createContext<SetUnsafe>(noop)
const SafeContext = createContext(true)

export function AutoUpdateSafetyProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const setUnsafe = useCallback((key: string, unsafe: boolean) => {
    setFlags((current) => {
      if (current[key] === unsafe) return current
      if (!unsafe) {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      return { ...current, [key]: true }
    })
  }, [])
  const safe = Object.keys(flags).length === 0
  return <SetUnsafeContext.Provider value={setUnsafe}><SafeContext.Provider value={safe}>{children}</SafeContext.Provider></SetUnsafeContext.Provider>
}

/** Register an unsaved or in-flight source for the global updater guard. */
export function useAutoUpdateSafety(key: string, options?: { persistOnUnmount?: boolean }) {
  const setContextUnsafe = useContext(SetUnsafeContext)
  const setUnsafe = useCallback((unsafe: boolean) => setContextUnsafe(key, unsafe), [key, setContextUnsafe])
  useEffect(() => options?.persistOnUnmount ? undefined : () => setContextUnsafe(key, false), [key, options?.persistOnUnmount, setContextUnsafe])
  return { setUnsafe }
}

export function useAutoUpdateAllowed(): boolean {
  return useContext(SafeContext)
}
