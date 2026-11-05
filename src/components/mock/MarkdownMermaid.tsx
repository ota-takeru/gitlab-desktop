import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useEffect, useState, type ComponentProps } from 'react'

import { useT } from '../../i18n/useT'
import { finishedMermaidDiagram, renderMermaidDiagram } from '../../lib/mermaidDiagram'
import { grid } from '../../theme'

/** Draws a Mermaid block. Its source stays on screen until the diagram is ready, and if it cannot be drawn. */
export function MarkdownMermaid({ source, ...blockProps }: { source: string } & ComponentProps<'pre'>) {
  const dark = useTheme().palette.mode === 'dark'
  const t = useT()
  const [image, setImage] = useState(() => finishedMermaidDiagram(source, dark))
  const [rest, setRest] = useState(0)
  useEffect(() => {
    let current = true
    void renderMermaidDiagram(source, dark).then((rendered) => {
      if (current) setImage(rendered)
    })
    return () => { current = false }
  }, [dark, source])
  // A wide diagram scrolls by itself at its full size, because shrinking it to fit makes its text unreadable.
  if (image) {
    return <Box {...blockProps as ComponentProps<'div'>} component="div" data-mermaid-diagram sx={{ mb: `${rest}px`, mt: 1, overflowX: 'auto' }}>
      <Box component="img" alt={source} onLoad={(event) => { const { height } = event.currentTarget; setRest(Math.ceil(height / grid) * grid - height) }} src={image} sx={{ display: 'block', maxWidth: 'none' }} />
    </Box>
  }
  return <>
    {image === null ? <Typography color="textSecondary" component="div" variant="caption">{t('common.richMarkdown.diagramUnavailable')}</Typography> : null}
    <pre {...blockProps}><Typography component="code" variant="code" sx={{ fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>{source}</Typography></pre>
  </>
}
