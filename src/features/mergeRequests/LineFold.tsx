import type { Theme } from '@mui/material/styles'

import { translate } from '../../i18n/i18n'
import type { LineFolds } from './lineFolds'

/**
 * The ▾ of a line that can be folded, in the gutter. Rows are plain elements, as a page holds many,
 * so this is one too. It shows on hover, and stays while its lines are folded.
 */
export function foldToggle(index: number, folds: LineFolds) {
  const end = folds.ranges.get(index)
  if (end === undefined) return null
  const folded = folds.folded.has(index)
  const label = translate(folded ? 'review.fold.expand' : 'review.fold.collapse', { count: end - index })
  return <button aria-expanded={!folded} aria-label={label} className="line-fold" data-folded={folded ? 'true' : undefined} onClick={() => folds.toggle(index)} title={label} type="button">
    <svg aria-hidden focusable="false" viewBox="0 0 16 16"><path d="M4.5 6 8 9.5 11.5 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>
  </button>
}

/** The 「⋯ n行」 after the code of a folded line; it opens the lines again. */
export function foldSummary(index: number, folds: LineFolds) {
  const folded = folds.folded.get(index)
  if (!folded) return null
  const text = translate('review.fold.summary', { count: folded.lines })
  return <button aria-label={translate('review.fold.expand', { count: folded.lines })} className="line-fold-summary" onClick={() => folds.toggle(index)} type="button">
    {folded.marked > 0 ? `${text} · ${translate('review.fold.hasThreads')}` : text}
  </button>
}

/** Styles of `foldToggle` and `foldSummary`. The toggle sits at `right` in a gutter that is `position: relative`. */
export function foldStyles(theme: Theme, right: string) {
  return {
    '& .line-fold': { alignItems: 'center', background: 'none', border: 0, borderRadius: `${theme.shape.borderRadius}px`, color: theme.palette.text.secondary, cursor: 'pointer', display: 'flex', height: 20, justifyContent: 'center', opacity: 0, padding: 0, position: 'absolute', right, top: 0, width: 16 },
    '& .line-fold svg': { height: 14, transition: theme.transitions.create('transform', { duration: theme.transitions.duration.shortest }), width: 14 },
    '& .line-fold[data-folded="true"]': { color: theme.palette.primary.main, opacity: 1 },
    '& .line-fold[data-folded="true"] svg': { transform: 'rotate(-90deg)' },
    '& .line-fold:hover': { backgroundColor: theme.palette.action.hover },
    '& .line-fold:focus-visible': { opacity: 1, outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -1 },
    // Like an editor, the toggles show while the pointer is over the code.
    '&:hover .line-fold': { opacity: 1 },
    '& .line-fold-summary': { backgroundColor: theme.palette.action.selected, border: 0, borderRadius: `${theme.shape.borderRadius}px`, color: theme.palette.text.secondary, cursor: 'pointer', font: 'inherit', fontFamily: theme.typography.fontFamily, fontSize: theme.typography.caption.fontSize, lineHeight: '16px', marginLeft: '8px', padding: '0 6px', userSelect: 'none', whiteSpace: 'nowrap' },
    '& .line-fold-summary:hover': { backgroundColor: theme.palette.action.focus, color: theme.palette.text.primary },
    '& .line-fold-summary:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
  }
}
