import type { Theme } from '@mui/material/styles'

import { hairline } from '../../components/hairline'
import { alignTop } from '../../components/rows'
import type { BlameBlock } from '../../types/gitlab'

export const BLAME_WINDOW = 80

/** Aligned windows share one React Query cache entry across nearby rows. */
export function blameWindowStart(line: number): number {
  return Math.floor((Math.max(1, line) - 1) / BLAME_WINDOW) * BLAME_WINDOW + 1
}

export interface BlameAttribution {
  block: BlameBlock
  first: boolean
}

/** The GitLab API returns ordered runs; each belongs to consecutive line numbers
 * at the requested revision, not to diff-row indices. */
export function blameAttributions(blocks: readonly BlameBlock[], startLine: number): ReadonlyMap<number, BlameAttribution> {
  const lines = new Map<number, BlameAttribution>()
  let line = startLine
  for (const block of blocks) {
    for (let offset = 0; offset < block.lines.length; offset += 1) {
      lines.set(line, { block, first: offset === 0 })
      line += 1
    }
  }
  return lines
}

/** The Blame gutter's look, shared by every view that shows it. */
export function blameCellStyles(theme: Theme) {
  return {
    '& .blame-cell': { alignItems: 'stretch', bgcolor: 'surface.list', ...hairline('right'), color: 'text.secondary', display: 'inline-flex', flexShrink: 0, fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', width: 132 },
    '& .blame-cell[data-first="true"]': { boxShadow: `inset 0 1px 0 ${theme.palette.divider}` },
    // Top-aligned with the line number, so a wrapped code line keeps its commit on its first row.
    '& .blame-action': { ...alignTop, background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', display: 'flex', flex: 1, font: 'inherit', fontSize: 'caption.fontSize', gap: '6px', lineHeight: '20px', minWidth: 0, padding: '0 4px', textAlign: 'left', whiteSpace: 'nowrap' },
    '& .blame-action[data-continued="true"]': { opacity: 0.5 },
    '& .blame-action:hover, & .blame-action:focus-visible': { bgcolor: 'action.hover', color: theme.palette.primary.main, opacity: 1 },
    '& .blame-action:hover .blame-sha, & .blame-action:focus-visible .blame-sha': { textDecoration: 'underline' },
    '& .blame-sha': { flexShrink: 0 },
    '& .blame-author': { fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '& .blame-status': { alignItems: 'center', display: 'flex', lineHeight: '20px', padding: '0 4px' },
  }
}
