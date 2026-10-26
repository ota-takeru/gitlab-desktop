import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { BlameCell } from './BlamePanel'
import { markdownDiffChanges, type MarkdownChangeSide } from './markdownDiff'
import type { ParsedLine } from './diffParser'

interface MarkdownDiffPreviewProps {
  blameEnabled?: boolean
  layout: 'unified' | 'split'
  lines: ParsedLine[]
}

/** Render only edited fragments, not the entire README or source-code rows.
 * Line-accurate review actions remain available through the source-diff switch. */
export function MarkdownDiffPreview({ blameEnabled = false, layout, lines }: MarkdownDiffPreviewProps) {
  const changes = useMemo(() => markdownDiffChanges(lines), [lines])
  return <Box aria-label="Markdown差分プレビュー" component="section" sx={{
    minWidth: 0, px: { xs: 1, sm: 2 }, py: 1.5,
    '& .blame-cell': { alignItems: 'center', display: 'inline-flex', maxWidth: '100%', minWidth: 0 },
    '& .blame-action': { bgcolor: 'transparent', border: 0, color: 'text.secondary', cursor: 'pointer', fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', px: 0.5 },
    '& .blame-author': { color: 'text.secondary', fontSize: 'caption.fontSize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }}>
    <Typography color="textSecondary" sx={{ mb: 1.5 }} variant="caption">変更部分だけをMarkdownで表示しています。行コメントや記法の確認には「ソース差分」を使用してください。</Typography>
    {changes.length === 0 ? <Typography color="textSecondary" role="status" variant="body2">この範囲に表示する変更はありません。</Typography> : null}
    <Stack spacing={1.5}>
      {changes.map((change, index) => <Box aria-label={`変更ブロック${index + 1}`} component="section" key={change.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 0, overflow: 'hidden' }}>
        <Box sx={{ bgcolor: 'surface.list', borderBottom: 1, borderColor: 'divider', px: 1.5, py: 0.5 }}>
          <Typography color="textSecondary" variant="caption">変更 {index + 1}/{changes.length}</Typography>
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
  const removed = kind === 'remove'
  const label = removed ? '削除' : '追加'
  const sideType = removed ? 'old' : 'new'
  const lineLabel = side.firstLine === side.lastLine ? String(side.firstLine) : `${side.firstLine}〜${side.lastLine}`
  return <Box aria-label={`${label} ${lineLabel}行`} data-kind={kind} component="section" sx={(theme) => ({
    bgcolor: removed ? theme.palette.diff?.deletedBackground : theme.palette.diff?.addedBackground,
    borderLeft: 3,
    borderColor: removed ? 'error.main' : 'success.main',
    minWidth: 0,
    px: 1.5,
    py: 1,
  })}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
      <Typography sx={{ fontWeight: 600 }} variant="caption">{label} · {lineLabel}行</Typography>
      {blameEnabled ? <BlameCell line={side.firstLine} side={sideType} /> : null}
    </Stack>
    <MockMarkdown body={side.text} size="body1" />
  </Box>
}
