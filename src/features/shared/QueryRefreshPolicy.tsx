import { createContext, useContext } from 'react'

export const QueryRefreshPolicy = createContext(true)
export function useQueryRefreshAllowed() { return useContext(QueryRefreshPolicy) }
