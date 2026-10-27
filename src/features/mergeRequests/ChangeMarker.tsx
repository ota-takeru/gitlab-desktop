import Box from '@mui/material/Box'
import { changeMarkerStyles, type ChangeMarkerKind } from './changeMarkerStyles'

export function ChangeMarker({ firstLine, kind, lastLine, title }: { firstLine: number; kind: ChangeMarkerKind; lastLine: number; title: string }) {
  const range = firstLine === lastLine ? `L${firstLine}` : `L${firstLine}–${lastLine}`
  return <Box aria-hidden component="span" sx={(theme) => changeMarkerStyles(theme, kind)} title={title}><span>{kind === 'remove' ? '−' : '+'}</span><span>{range}</span></Box>
}
