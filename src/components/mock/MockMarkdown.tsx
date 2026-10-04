import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** A local preview of basic Markdown; GitLab-specific commands are not executed. */
export function MockMarkdown({ body }: { body: string }) {
  return (
    <Box sx={{ fontSize: 'body2.fontSize', lineHeight: 1.65, overflowWrap: 'anywhere', minWidth: 0, overflowX: 'auto', '& > :first-of-type': { mt: 0 }, '& > :last-of-type': { mb: 0 }, '& p': { my: 0.75 }, '& ul, & ol': { pl: 2.5, my: 0.75 }, '& blockquote': { borderLeft: 2, borderColor: 'divider', ml: 0, pl: 1.25, color: 'text.secondary' }, '& pre': { bgcolor: 'action.hover', p: 1, overflowX: 'auto', borderRadius: 1 }, '& table': { borderCollapse: 'collapse', my: 1 }, '& td, & th': { border: 1, borderColor: 'divider', px: 1, py: 0.5 }, '& h1, & h2, & h3, & h4, & h5, & h6': { fontSize: 'body1.fontSize', my: 1 } }}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => /^(https?:\/\/|mailto:)/i.test(url) ? url : ''}
        components={{
          a: ({ href, children }) => href ? <Link href={href} target="_blank" rel="noopener noreferrer">{children}</Link> : <span>{children}</span>,
          img: ({ alt }) => <Typography component="span" color="text.secondary" variant="caption">[画像: {alt || '説明なし'} · 外部画像は読み込みません]</Typography>,
          code: ({ children }) => <Typography component="code" variant="code" sx={{ fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>{children}</Typography>,
        }}
      >{body}</Markdown>
    </Box>
  )
}
