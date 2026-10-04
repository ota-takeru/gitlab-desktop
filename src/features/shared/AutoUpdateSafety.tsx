import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

interface AutoUpdateSafetyContextValue {
  flags: Readonly<Record<string, boolean>>
  safe: boolean
  setUnsafe: (key: string, unsafe: boolean) => void
}

const noop = () => undefined
const defaultContext: AutoUpdateSafetyContextValue = { flags: {}, safe: true, setUnsafe: noop }
const AutoUpdateSafetyContext = createContext<AutoUpdateSafetyContextValue>(defaultContext)

export function AutoUpdateSafetyProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const setUnsafe = useCallback((key: string, unsafe: boolean) => {
    setFlags((current) => {
      if (current[key] === unsafe) return current
      if (!unsafe) {
        const next = { ...current }
        delete next[key]
        return next
      }
      return { ...current, [key]: true }
    })
  }, [])
  const safe = Object.keys(flags).length === 0
  const value = useMemo(() => ({ flags, safe, setUnsafe }), [flags, safe, setUnsafe])
  return <AutoUpdateSafetyContext.Provider value={value}>{children}</AutoUpdateSafetyContext.Provider>
}

/** Register an unsaved or in-flight source for the global updater guard. */
export function useAutoUpdateSafety(key: string, options?: { persistOnUnmount?: boolean }) {
  const context = useContext(AutoUpdateSafetyContext)
  const setContextUnsafe = context.setUnsafe
  const setUnsafe = useCallback((unsafe: boolean) => setContextUnsafe(key, unsafe), [key, setContextUnsafe])
  useEffect(() => options?.persistOnUnmount ? undefined : () => setContextUnsafe(key, false), [key, options?.persistOnUnmount, setContextUnsafe])
  return { safe: context.safe, setUnsafe, unsafe: Boolean(context.flags[key]) }
}

export function useAutoUpdateAllowed(): boolean {
  return useContext(AutoUpdateSafetyContext).safe
}
