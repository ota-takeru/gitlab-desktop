import { gridLine, typeLines } from '../theme'

/*
 * Vertical alignment in rows, one rule for every screen. Rows are written with Row and Bar
 * (components/Row), which carry it:
 * - A row of one-line items (text, chips, buttons, icons) centres them (Row's default). Text of two
 *   sizes in equal grid line boxes then sits within half a pixel of a shared baseline, so rows never use
 *   baseline alignment, which stretches the row by that half pixel and lifts the rows after it off the grid.
 * - A mark (an icon, an avatar, a state marker, a control) beside content that can take more than one line
 *   sits on that content's first line, never in the middle of the block: the row is `align="top"`, and the
 *   mark is wrapped in `firstLine(line)`, a box as tall as that first line that centres it. `line` names the
 *   text variant of the first line ('body1'), or gives grid steps for a first line set by controls.
 * - Panels or columns of different heights side by side also start at the top with `align="top"`.
 * - A row whose cells must fill its height (diff lines, layout panes) says `align="stretch"`.
 * `npm run design:guard` rejects a row Stack or flex Box written by hand, baseline alignment and top
 * alignment written by hand.
 */

export const alignTop = { alignItems: 'flex-start' } as const

/** A box as tall as the first line of the content beside it (a text variant, or grid steps), centring the mark it wraps on that line. */
export const firstLine = (line: keyof typeof typeLines | number) => ({ alignItems: 'center', display: 'flex', flexShrink: 0, height: gridLine(typeof line === 'number' ? line : typeLines[line]), justifyContent: 'center' }) as const
