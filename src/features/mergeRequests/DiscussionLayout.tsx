import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import type { ReactNode } from 'react'

/** Detail-pane width from which the discussion tab uses a side column. */
const WIDE = '@container (min-width: 1200px)'

/**
 * Discussion tab layout. Wide panes keep the threads at a readable width and
 * put the navigator and the pending review in a sticky side column; narrow
 * panes keep one column in the order threads, pending review, new comment.
 */
export function DiscussionLayout({ composer, navigator, side, threads }: { composer: ReactNode; navigator?: ReactNode; side: ReactNode; threads: ReactNode }) {
  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Box sx={{ columnGap: 3, display: 'grid', gridTemplateAreas: '"threads" "side" "composer"', gridTemplateColumns: 'minmax(0, 1fr)', rowGap: 0.75, [WIDE]: { gridTemplateAreas: '"threads side" "composer side"', gridTemplateColumns: 'minmax(0, 1fr) 340px', gridTemplateRows: 'auto 1fr' } }}>
        <Stack spacing={0.75} sx={{ gridArea: 'threads', minWidth: 0 }}>{threads}</Stack>
        <Stack component="aside" spacing={0.75} sx={{ gridArea: 'side', minWidth: 0, [WIDE]: { alignSelf: 'start', maxHeight: 'calc(100vh - var(--detail-header-height, 0px) - 48px)', overflowY: 'auto', position: 'sticky', top: 'calc(var(--detail-header-height, 0px) + 16px)' } }}>
          {/* Narrow panes already filter unresolved threads in the list itself. */}
          {navigator ? <Box sx={{ display: 'none', [WIDE]: { display: 'block' } }}>{navigator}</Box> : null}
          {side}
        </Stack>
        <Box sx={{ gridArea: 'composer', minWidth: 0 }}>{composer}</Box>
      </Box>
    </Box>
  )
}
