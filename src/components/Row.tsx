import Stack, { type StackProps } from '@mui/material/Stack'
import { forwardRef } from 'react'

import { edgeRow } from './edges'

type RowProps = Omit<StackProps, 'direction'> & {
  /** 'center' (the default) for one-line items, 'top' beside content that wraps (with firstLine around the mark), 'stretch' for cells that fill the row. */
  align?: 'center' | 'top' | 'stretch'
}

const alignItems = { center: 'center', stretch: 'stretch', top: 'flex-start' } as const
const merged = (base: object, sx: StackProps['sx']) => [base, ...(Array.isArray(sx) ? sx : [sx])]

/** A row of items, aligned by the shared rule (components/rows): centred unless told otherwise. */
export const Row = forwardRef<HTMLDivElement, RowProps>(function Row({ align = 'center', sx, ...props }, ref) {
  return <Stack direction="row" ref={ref} sx={merged({ alignItems: alignItems[align] }, sx)} {...props} />
})

/** A row at the edge of a pane, card or bar (a header, a toolbar): its first and last frameless controls meet the edge line (components/edges). */
export const Bar = forwardRef<HTMLDivElement, RowProps>(function Bar({ align = 'center', sx, ...props }, ref) {
  return <Stack direction="row" ref={ref} sx={merged({ alignItems: alignItems[align], ...edgeRow }, sx)} {...props} />
})
