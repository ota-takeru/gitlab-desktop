import type { Theme } from '@mui/material/styles'

import { frame } from '../../components/hairline'
import { gridLine } from '../../theme'

export type ChangeMarkerKind = 'add' | 'remove'

/** A compact UI badge, styled apart from rendered Markdown so it is not read as document text. */
export function changeMarkerStyles(theme: Theme, kind: ChangeMarkerKind) {
  const color = kind === 'remove' ? theme.palette.error.main : theme.palette.success.main
  return {
    alignItems: 'center', ...frame({ color }), borderRadius: 1, color, display: 'inline-flex', fontFamily: 'code.fontFamily',
    fontSize: 'caption.fontSize', fontWeight: 600, gap: 0.5, height: 20, lineHeight: gridLine(4), px: 0.5, userSelect: 'none', whiteSpace: 'nowrap',
  } as const
}
