import { gridLine } from '../theme'
import { frame, hairline } from './hairline'

// A rendered table sits in a scrolling wrapper; the rich editor's does not.
const blockAfterLeadIn = '& > p + ul, & > p + ol, & > p + pre, & > p + [data-table-scroll], & > p + table'
const leadIn = '& > p:has(+ ul, + ol, + pre, + [data-table-scroll], + table)'
const blameRow = '[data-review-blame-line]'

/**
 * Typography for rendered Markdown, shared with the rich Markdown editor. The gaps say how blocks relate:
 * a heading sits closer to what it introduces than to what came before, a sentence leading into a list,
 * table or code block sits closer to it than to another paragraph, and a bigger heading opens a wider gap.
 */
export function markdownBodySx(size: 'body1' | 'body2') {
  const roomy = size === 'body1'
  const blockGap = roomy ? 2 : 1.5
  return {
    color: 'text.body',
    fontSize: `${size}.fontSize`,
    lineHeight: gridLine(roomy ? 6 : 5),
    overflowWrap: 'anywhere',
    minWidth: 0,
    overflowX: 'auto',
    '& > :first-child': { mt: 0 },
    '& > :last-child': { mb: 0 },
    '& p': { my: blockGap },
    '& ul, & ol': { pl: 2.5, my: blockGap },
    '& pre': { bgcolor: 'action.hover', ...frame(), my: blockGap, p: 1, overflowX: 'auto', borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', lineHeight: gridLine(5) },
    '& [data-table-scroll]': { maxHeight: 480, my: blockGap, overflow: 'auto', '& > table': { my: 0 }, '& thead th': { position: 'sticky', top: 0, zIndex: 1 } },
    [leadIn]: { mb: 1 },
    [blockAfterLeadIn]: { mt: 1 },
    '& li + li': { mt: 0.5 },
    '& li > ul, & li > ol': { mb: 0, mt: 0.5 },
    '& li > p': { my: 0 },
    '& li > p + p': { mt: 1 },
    '& blockquote': {
      ...hairline('left', { color: 'surface.borderStrong', width: 3 }),
      bgcolor: 'action.hover',
      color: 'text.secondary',
      mx: 0,
      my: blockGap,
      px: 1.5,
      py: 1,
      '& > :first-child': { mt: 0 },
      '& > :last-child': { mb: 0 },
    },
    '& :not(pre) > code': { bgcolor: 'action.hover', ...frame(), borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', px: 0.5, py: 0.25, verticalAlign: 'top' },
    '& table': { borderCollapse: 'collapse', ...frame(), my: blockGap },
    '& td, & th': { ...hairline(['right', 'bottom']), minWidth: '14em', px: 1, py: 0.5 },
    // Opaque, because the header row stays over the rows scrolling beneath it. That also covers the table's frame, so these cells draw it.
    '& th': { ...hairline(['top', 'right', 'bottom']), bgcolor: 'surface.nav', color: 'text.primary' },
    '& th:first-of-type': hairline(['top', 'right', 'bottom', 'left']),
    '& [data-short-cell]': { minWidth: 0, whiteSpace: 'nowrap', '& code': { whiteSpace: 'nowrap' } },
    '& hr': { border: 0, height: 0, my: roomy ? 4 : 3, ...hairline('top', { color: 'surface.borderStrong' }) },
    '& h1, & h2, & h3, & h4, & h5, & h6': { color: 'text.primary', fontSize: `${size}.fontSize`, fontWeight: 600, mb: 0.5, mt: roomy ? 3 : 2 },
    '& h1': { ...hairline('bottom', { color: 'surface.borderStrong' }), fontSize: roomy ? 'markdownTitle.fontSize' : 'markdownHeading.fontSize', fontWeight: 700, lineHeight: gridLine(roomy ? 9 : 7), mb: roomy ? 1.5 : 1, mt: roomy ? 4 : 3, pb: 0.5 },
    '& h2': { ...hairline('bottom'), fontSize: roomy ? 'markdownHeading.fontSize' : 'markdownSection.fontSize', lineHeight: gridLine(roomy ? 7 : 6), mb: roomy ? 1.5 : 1, mt: roomy ? 4 : 3, pb: 0.5 },
    '& h3': { fontSize: roomy ? 'markdownSection.fontSize' : 'subtitle1.fontSize', lineHeight: gridLine(6), mb: 1 },
    '& h4': { fontSize: roomy ? 'subtitle1.fontSize' : 'body1.fontSize' },
    '& h5, & h6': { color: 'text.secondary' },
    // What a heading introduces takes its distance from the heading alone.
    '& :is(h1, h2, h3, h4, h5, h6) + *, & :is(h1, h2, h3, h4, h5, h6) + [data-table-scroll]': { mt: 0 },
    // Blame puts each block in a grid row beside its author, so the gaps go on the rows to keep the two level.
    '& [data-review-blame-line] > :last-child > *': { mb: 0, mt: 0 },
    [`& > * + ${blameRow}`]: { mt: blockGap },
    [`& > * + ${blameRow}:has(> :last-child > :is(h3, h4, h5, h6))`]: { mt: roomy ? 3 : 2 },
    [`& > * + ${blameRow}:has(> :last-child > :is(h1, h2, hr)), & > ${blameRow}:has(> :last-child > hr) + ${blameRow}`]: { mt: roomy ? 4 : 3 },
    [`& > ${blameRow}:has(> :last-child > :is(h1, h2, h3, h4, h5, h6)) + ${blameRow}`]: { mt: 1 },
  }
}
