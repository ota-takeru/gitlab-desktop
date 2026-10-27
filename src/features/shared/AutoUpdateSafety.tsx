import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { SafeContext, SetUnsafeContext, SourcesContext } from './autoUpdateSafetyContext'

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
