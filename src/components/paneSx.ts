/**
 * Loading placeholders appear only after a short wait: data read from the
 * local cache arrives within it, and the screen goes straight to the content
 * instead of flashing a placeholder for one frame.
 */
export const delayedRevealSx = {
  '@keyframes gitlab-delayed-reveal': { from: { opacity: 0 }, to: { opacity: 1 } },
  animation: 'gitlab-delayed-reveal 0s linear 200ms both',
} as const

/** A screen that comes into view, or content that replaces a placeholder, fades in over a moment instead of cutting to it. */
export const fadeInSx = {
  '@keyframes gitlab-fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
  animation: 'gitlab-fade-in 150ms ease-out',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
} as const

/** Content that replaces a faint placeholder: it starts partly visible, as fading from nothing would first dim the pane below the placeholder. */
export const contentFadeInSx = {
  '@keyframes gitlab-content-fade-in': { from: { opacity: 0.4 }, to: { opacity: 1 } },
  animation: 'gitlab-content-fade-in 150ms ease-out',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
} as const

/** The scrolling results of a list; rows of the previous page or conditions stay, dimmed, until the new ones arrive. */
export function paneResultsSx(previous: boolean) {
  return { flex: 1, minHeight: 0, minWidth: 0, opacity: previous ? 0.6 : 1, overflowY: 'auto', transition: 'opacity 120ms', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } } as const
}

/** Left and right padding of every pane (16px), so a list and the MR it opens start on the same edge. */
export const paneGutter = 2
