import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type SetUnsafe = (key: string, unsafe: boolean) => void

const noop = () => undefined
// The setter and the result are separate contexts: the many sources that only
// report (composers, writes, edits) do not render again whenever any source changes.
const SetUnsafeContext = createContext<SetUnsafe>(noop)
const SafeContext = createContext(true)
/** The keys of the sources holding the app back, for naming them when the window closes. */
const SourcesContext = createContext<readonly string[]>([])

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
  const sources = useMemo(() => Object.keys(flags), [flags])
  return <SetUnsafeContext.Provider value={setUnsafe}><SafeContext.Provider value={sources.length === 0}><SourcesContext.Provider value={sources}>{children}</SourcesContext.Provider></SafeContext.Provider></SetUnsafeContext.Provider>
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

export function useUnsafeSources(): readonly string[] {
  return useContext(SourcesContext)
}
