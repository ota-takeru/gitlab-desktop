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
