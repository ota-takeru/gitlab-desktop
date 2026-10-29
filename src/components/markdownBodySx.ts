import { gridLine } from '../theme'
import { frame, hairline } from './hairline'

/** Typography for rendered Markdown, shared with the rich Markdown editor. */
export function markdownBodySx(size: 'body1' | 'body2') {
  // grid-exempt: table cells share collapsed borders; a frame per cell would double the lines between them.
  return { fontSize: `${size}.fontSize`, lineHeight: gridLine(size === 'body1' ? 6 : 5), overflowWrap: 'anywhere', minWidth: 0, overflowX: 'auto', '& > :first-of-type': { mt: 0 }, '& > :last-of-type': { mb: 0 }, '& p': { my: 1 }, '& ul, & ol': { pl: 2.5, my: 1 }, '& li + li': { mt: 0.5 }, '& blockquote': { ...hairline('left', { width: 3 }), ml: 0, pl: 1.5, color: 'text.secondary' }, '& pre': { bgcolor: 'action.hover', ...frame(), p: 1, overflowX: 'auto', borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', lineHeight: gridLine(5) }, '& :not(pre) > code': { bgcolor: 'action.hover', ...frame(), borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', px: 0.5, py: 0.25 }, '& table': { borderCollapse: 'collapse', my: 1 }, '& td, & th': { border: 1, borderColor: 'divider', px: 1, py: 0.5 }, '& h1, & h2, & h3, & h4, & h5, & h6': { fontSize: 'body1.fontSize', my: 1 } }
}
