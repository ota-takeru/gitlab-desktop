import { gridLine } from '../theme'

/*
 * Vertical alignment in rows, one rule for every screen:
 * - A row of one-line items (text, chips, buttons, icons) centres them: `alignItems: 'center'`. Text of two
 *   sizes in equal grid line boxes then sits within half a pixel of a shared baseline, so rows never use
 *   baseline alignment, which stretches the row by that half pixel and lifts the rows after it off the grid.
 * - A mark (an icon, an avatar, a state marker, a control) beside content that can take more than one line
 *   sits on that content's first line, never in the middle of the block: the row is `alignTop`, and the mark
 *   is wrapped in `firstLine(steps)`, a box as tall as the first line (in grid steps) that centres it.
 * - Panels or columns of different heights side by side also start at the top with `alignTop`.
 * - A row whose cells must fill its height (diff lines, table cells) says so with `alignItems: 'stretch'`.
 * `npm run design:guard` rejects baseline alignment, a row that leaves its alignment unsaid, and top
 * alignment written by hand.
 */

export const alignTop = { alignItems: 'flex-start' } as const

/** A box as tall as the first line of the content beside it, centring the mark it wraps on that line. */
export const firstLine = (steps: number) => ({ alignItems: 'center', display: 'flex', flexShrink: 0, height: gridLine(steps), justifyContent: 'center' }) as const
