import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { BlameCell } from './BlamePanel'
import { ChangeMarker } from './ChangeMarker'
import { markdownDiffChanges, type MarkdownChangeSide } from './markdownDiff'
import type { ParsedLine } from './diffParser'
import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

interface MarkdownDiffPreviewProps {
  blameEnabled?: boolean
  layout: 'unified' | 'split'
  lines: ParsedLine[]
}

/** Render only edited fragments, not the entire README or source-code rows.
 * Line-accurate review actions remain available through the source-diff switch. */
export function MarkdownDiffPreview({ blameEnabled = false, layout, lines }: MarkdownDiffPreviewProps) {
  const t = useT()
  const changes = useMemo(() => markdownDiffChanges(lines), [lines])
  return <Box aria-label={t('review.markdownDiff.label')} component="section" sx={{
    minWidth: 0, px: { xs: 1, sm: 2 }, py: 1.5,
    '& .blame-cell': { alignItems: 'center', display: 'inline-flex', maxWidth: '100%', minWidth: 0 },
    '& .blame-action': { bgcolor: 'transparent', border: 0, color: 'text.secondary', cursor: 'pointer', fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', px: 0.5 },
    '& .blame-author': { color: 'text.secondary', fontSize: 'caption.fontSize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }}>
    <Typography color="textSecondary" sx={{ mb: 1.5 }} variant="caption">{t('review.markdownDiff.hint')}</Typography>
    {changes.length === 0 ? <Typography color="textSecondary" role="status" variant="body2">{t('review.markdownDiff.empty')}</Typography> : null}
    <Stack spacing={1.5}>
      {changes.map((change, index) => <Box aria-label={t('review.markdownDiff.block', { number: index + 1 })} data-file-anchor={change.new?.firstLine ?? lines.find((line) => line.kind !== 'remove' && line.oldLine !== undefined && change.old && line.oldLine >= change.old.lastLine)?.newLine ?? change.old?.firstLine ?? 1} component="section" key={change.id} sx={{ ...panelFrame(), borderRadius: 1, minWidth: 0, overflow: 'hidden' }}>
        <Box sx={{ bgcolor: 'surface.list', ...hairline('bottom'), px: 1.5, py: 0.5 }}>
          <Typography color="textSecondary" variant="caption">{t('review.markdownDiff.position', { number: index + 1, total: changes.length })}</Typography>
        </Box>
        <Box sx={{ display: 'grid', gap: 0.5, gridTemplateColumns: layout === 'split' ? { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } : 'minmax(0, 1fr)', p: 0.5 }}>
          {change.old ? <ChangedFragment blameEnabled={blameEnabled} kind="remove" side={change.old} /> : layout === 'split' && change.new ? <Box /> : null}
          {change.new ? <ChangedFragment blameEnabled={blameEnabled} kind="add" side={change.new} /> : null}
        </Box>
      </Box>)}
    </Stack>
  </Box>
}

function ChangedFragment({ blameEnabled, kind, side }: { blameEnabled: boolean; kind: 'add' | 'remove'; side: MarkdownChangeSide }) {
  const t = useT()
  const removed = kind === 'remove'
  const sideType = removed ? 'old' : 'new'
  const lineLabel = side.firstLine === side.lastLine ? String(side.firstLine) : t('review.lineRange', { start: String(side.firstLine), end: String(side.lastLine) })
  return <Box aria-label={t(removed ? 'review.markdownDiff.removedLines' : 'review.markdownDiff.addedLines', { lines: lineLabel })} data-kind={kind} component="section" sx={(theme) => ({
    bgcolor: removed ? theme.palette.diff?.deletedBackground : theme.palette.diff?.addedBackground,
    ...hairline('left', { color: removed ? 'error.main' : 'success.main', width: 3 }),
    minWidth: 0,
    px: 1.5,
    py: 1,
  })}>
    <Row spacing={1} sx={{ flexWrap: 'wrap', mb: 0.5 }}>
      <ChangeMarker firstLine={side.firstLine} kind={kind} lastLine={side.lastLine} title={t(removed ? 'review.markdownDiff.removeTitle' : 'review.markdownDiff.addTitle', { lines: lineLabel })} />
      {blameEnabled ? <BlameCell line={side.firstLine} side={sideType} /> : null}
    </Row>
    <MockMarkdown body={side.text} size="body1" />
  </Box>
}
