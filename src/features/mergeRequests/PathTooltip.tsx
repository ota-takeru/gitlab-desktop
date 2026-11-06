import Box from '@mui/material/Box'
import Tooltip, { type TooltipProps } from '@mui/material/Tooltip'
import type { ReactElement } from 'react'

import { splitPath } from './diffFileOrder'

const tooltipSlots = { tooltip: { sx: { maxWidth: 'min(640px, 80vw)' } } }

/** A whole path on hover, with the file's name set apart from its folders. Long paths break anywhere, as they have no spaces. */
export function PathTooltip({ children, notes, oldPath, path, placement = 'right' }: {
  children: ReactElement
  /** What else there is to know about the row, such as its threads. */
  notes?: string[]
  /** The path before a rename. */
  oldPath?: string
  path: string | null
  placement?: TooltipProps['placement']
}) {
  if (!path) return children
  const { directory, name } = splitPath(path)
  return <Tooltip describeChild placement={placement} slotProps={tooltipSlots} title={<>
    <Box dir="ltr" sx={{ fontFamily: 'code.fontFamily', overflowWrap: 'anywhere' }}>
      {oldPath ? <Box sx={{ opacity: 0.72 }}>{oldPath} →</Box> : null}
      {directory ? <Box sx={{ opacity: 0.72 }}>{directory}/</Box> : null}
      <Box sx={{ fontWeight: 600 }}>{name}</Box>
    </Box>
    {notes?.map((note) => <Box key={note}>{note}</Box>)}
  </>}>{children}</Tooltip>
}
