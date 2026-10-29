import type { CSSObject } from '@mui/material/styles'

type Side = 'top' | 'right' | 'bottom' | 'left'

interface LineOptions {
  /** A theme key in sx ('divider', 'surface.borderStrong') or a colour in the theme's own overrides. */
  color?: string
  width?: number
}

interface HairlineOptions extends LineOptions {
  /** For a box that already draws something with ::after. */
  pseudo?: '::after' | '::before'
  /** Off when the box is placed by its own position (sticky, absolute) or a component style sets one. */
  position?: boolean
}

/*
 * A CSS border adds its width to the box (one device pixel: 0.8px at 125% scaling), so every row after a
 * bordered row would start off the 4px grid. These lines are drawn over the box's edge instead. They are
 * still borders or outlines, which browsers snap to whole device pixels, so they stay sharp.
 */

const lines = (sides: Side | readonly Side[], { color = 'divider', width = 1 }: LineOptions) => {
  const on = (side: Side) => (typeof sides === 'string' ? sides === side : sides.includes(side)) ? `${width}px` : '0'
  return {
    borderColor: color,
    borderRadius: 'inherit',
    borderStyle: 'solid',
    borderWidth: `${on('top')} ${on('right')} ${on('bottom')} ${on('left')}`,
    content: '""',
    inset: 0,
    pointerEvents: 'none',
    position: 'absolute',
  } as const
}

/** Lines along some edges: a divider under a header, between rows or beside a column. */
export function hairline(sides: Side | readonly Side[] = 'bottom', { pseudo = '::after', position = true, ...options }: HairlineOptions = {}) {
  return { ...(position ? { position: 'relative' } : {}), [`&${pseudo}`]: lines(sides, options) } as const
}

/**
 * A frame for a box whose content never paints over its edge (a code block, a chip, a button), drawn as an
 * inset outline. It follows the corner radius, works on scrolling and inline boxes, and a focus ring simply
 * takes its place.
 */
export function frame({ color = 'divider', width = 1 }: LineOptions = {}) {
  return { outline: `${width}px solid`, outlineColor: color, outlineOffset: -width } as const
}

/**
 * A frame for a card or panel whose rows reach its edges. Browsers paint positioned rows (and sticky ones with
 * a z-index) over an outline, so the frame is a line of its own, kept above the panel's content: the panel is
 * its own stacking context, so the line never rises above anything outside it.
 */
export function panelFrame({ position = true, ...options }: LineOptions & { position?: boolean } = {}): CSSObject {
  return {
    isolation: 'isolate',
    ...(position ? { position: 'relative' } : {}),
    '&::after': { ...lines(['top', 'right', 'bottom', 'left'], options), zIndex: 3 },
  }
}
