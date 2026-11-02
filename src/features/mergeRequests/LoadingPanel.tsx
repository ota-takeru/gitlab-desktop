import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'

import { hairline, panelFrame } from '../../components/hairline'
import { Row } from '../../components/Row'

const bar = (width: string, height = 12) => <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height, width }} />

/**
 * The shape of threads or diffs while they are read from GitLab, shown at once: a screen
 * waits for saved data before it shows (see ScreenReadinessGate), so this only stands in
 * for a network read, and the content replaces it in the same place.
 */
export function LoadingSkeleton({ label, variant }: { label: string; variant: 'discussion' | 'changes' }) {
  return <Box aria-label={label} role="status" sx={{ py: 1 }}>
    {variant === 'discussion' ? <Stack spacing={1.5}>{['55%', '80%', '40%'].map((width) => <Stack key={width} spacing={1} sx={{ ...panelFrame(), borderRadius: 1, p: 1.5 }}>
      <Row spacing={1}><Box sx={{ bgcolor: 'action.hover', borderRadius: '50%', flexShrink: 0, height: 24, width: 24 }} />{bar('25%')}</Row>
      {bar('90%')}
      {bar(width)}
    </Stack>)}</Stack> : <Stack spacing={1.5}>{[['70%', '45%', '85%', '60%', '30%', '75%'], ['50%', '80%', '35%']].map((lines) => <Box key={lines.length} sx={{ ...panelFrame(), borderRadius: 1, overflow: 'hidden' }}>
      <Box sx={{ ...hairline('bottom'), px: 1.5, py: 1 }}>{bar('35%')}</Box>
      <Stack spacing={1} sx={{ px: 1.5, py: 1 }}>{lines.map((width, index) => <Box key={index}>{bar(width, 10)}</Box>)}</Stack>
    </Box>)}</Stack>}
  </Box>
}
