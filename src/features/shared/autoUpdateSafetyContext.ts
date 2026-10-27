import { createContext, useCallback, useContext, useEffect } from 'react'

type SetUnsafe = (key: string, unsafe: boolean) => void

const noop = () => undefined
// The setter and the result are separate contexts: the many sources that only
// report (composers, writes, edits) do not render again whenever any source changes.
export const SetUnsafeContext = createContext<SetUnsafe>(noop)
export const SafeContext = createContext(true)
/** The keys of the sources holding the app back, for naming them when the window closes. */
export const SourcesContext = createContext<readonly string[]>([])

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
