import { createContext, useContext } from 'react'

export const QueryRefreshPolicy = createContext(true)
export function useQueryRefreshAllowed() { return useContext(QueryRefreshPolicy) }

/**
 * How long fetched data stays in memory after its screen stops reading it; undefined keeps the
 * client's default. The MRs open as sidebar tabs keep theirs longer, so they show again at once.
 */
export const QueryRetention = createContext<number | undefined>(undefined)
export function useQueryRetention() { return useContext(QueryRetention) }
