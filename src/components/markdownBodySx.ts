import { gridLine } from '../theme'
import { frame, hairline } from './hairline'

/** Typography for rendered Markdown, shared with the rich Markdown editor. */
export function markdownBodySx(size: 'body1' | 'body2') {
  return { fontSize: `${size}.fontSize`, lineHeight: gridLine(size === 'body1' ? 6 : 5), overflowWrap: 'anywhere', minWidth: 0, overflowX: 'auto', '& > :first-of-type': { mt: 0 }, '& > :last-of-type': { mb: 0 }, '& p': { my: 1 }, '& ul, & ol': { pl: 2.5, my: 1 }, '& li + li': { mt: 0.5 }, '& blockquote': { ...hairline('left', { width: 3 }), ml: 0, my: 1, pl: 1.5, color: 'text.secondary' }, '& pre': { bgcolor: 'action.hover', ...frame(), my: 1, p: 1, overflowX: 'auto', borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', lineHeight: gridLine(5) }, '& :not(pre) > code': { bgcolor: 'action.hover', ...frame(), borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', px: 0.5, py: 0.25, verticalAlign: 'top' }, '& table': { borderCollapse: 'collapse', ...frame(), my: 1 }, '& td, & th': { ...hairline(['right', 'bottom']), px: 1, py: 0.5 }, '& hr': { border: 0, height: 0, my: 2, ...hairline('top') }, '& h1, & h2, & h3, & h4, & h5, & h6': { fontSize: 'body1.fontSize', my: 1 } }
}
