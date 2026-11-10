import type { Theme } from '@mui/material/styles'
import { createContext } from 'react'

/** Over the whole window and its own scroll, with the same elements, so open comment editors and opened lines stay as they are. No top padding: a sticky row stops below it, and what scrolls under it would show through. */
export const MAXIMIZED_SX = { '--detail-header-height': '0px', bgcolor: 'background.default', inset: 0, overflowX: 'hidden', overflowY: 'auto', p: 1, position: 'fixed', pt: 0, zIndex: (theme: Theme) => theme.zIndex.drawer + 1 } as const

/** A maximized view held above the diff: it covers the window with what is around the diff too, and stays maximized while the diff under it is replaced. */
export const DiffMaximizeContext = createContext<{ maximized: boolean; setMaximized: (update: (value: boolean) => boolean) => void } | null>(null)
