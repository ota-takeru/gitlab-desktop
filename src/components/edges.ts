/*
 * Edge alignment. A frameless control (a text button, an icon button, the tabs) pads its label or icon, so at
 * the start or end of a row its ink would sit inside the edge line that the fields, cards and titles keep.
 * Each such control declares that padding as `--edge-inset` (the theme does it for MUI's own sizes; a custom
 * size declares its own), and a row given edgeRow pulls its first and last control out by it. A control is
 * found as the row's first or last child, or the first or last inside one or two wrappers (a tooltip's span,
 * a group), so a screen never writes these margins itself.
 */

const control = ':is(.MuiButton-text, .MuiButton-quiet, .MuiIconButton-root, .MuiTabs-root)'
const at = (position: 'first-child' | 'last-child') => [`& > ${control}:${position}`, `& > :${position} > ${control}:${position}`, `& > :${position} > :${position} > ${control}:${position}`].join(', ')

export const edgeRow = {
  [at('first-child')]: { marginInlineStart: 'calc(-1 * var(--edge-inset, 0px))' },
  [at('last-child')]: { marginInlineEnd: 'calc(-1 * var(--edge-inset, 0px))' },
} as const
