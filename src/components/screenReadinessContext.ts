import { createContext, useContext } from 'react'

/** Holds the screen out of sight until the returned release is called. */
export type HoldScreen = () => () => void

/** Set inside a screen waiting to show (see ScreenReadinessGate); null elsewhere. */
export const ScreenReadinessContext = createContext<HoldScreen | null>(null)
export function useScreenReadiness() { return useContext(ScreenReadinessContext) }
