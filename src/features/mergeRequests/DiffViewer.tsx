import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import type { Diff, Position } from '../../types/gitlab'

interface DiffViewerProps {
  allowComments?: boolean
  diffs: Diff[]
  fileContent?: string | null
  fileLoading?: boolean
  onComment: (position: Position) => void
  onSelectFile: (path: string) => void
  selectedFile: string | null
  selectedPosition: Position | undefined
  view: 'diff' | 'file'
  onViewChange: (view: 'diff' | 'file') => void
}

export function DiffViewer({ allowComments = true, diffs, fileContent, fileLoading = false, onComment, onSelectFile, onViewChange, selectedFile, selectedPosition, view }: DiffViewerProps) {
  const selectedDiff = diffs.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? diffs[0]
  const [diffLimit, setDiffLimit] = useState(600)
  const parsedRows = useMemo(() => selectedDiff ? parseDiff(selectedDiff.diff, selectedDiff.oldPath, selectedDiff.newPath) : [], [selectedDiff])
  const rows = parsedRows.slice(0, diffLimit)

  return (
    <Stack direction={{ md: 'row', xs: 'column' }} spacing={1.25} sx={{ minHeight: 420 }}>
      <Paper sx={{ flex: '0 0 205px', minWidth: 0 }} variant="outlined">
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.25, py: 1 }}><InsertDriveFileOutlinedIcon color="primary" fontSize="small" /><Typography sx={{ fontWeight: 700 }} variant="body2">変更ファイル</Typography><Chip label={diffs.length} size="small" variant="outlined" /></Stack>
        <Divider />
        <List disablePadding>
          {diffs.map((diff) => {
            const path = diff.newPath || diff.oldPath
            return <ListItemButton key={path} onClick={() => onSelectFile(path)} selected={path === selectedFile} sx={{ px: 1.25, py: 0.75 }}><ListItemText primary={<Typography noWrap variant="body2">{path}</Typography>} secondary={diff.tooLarge ? '取得制限' : diff.deletedFile ? '削除' : diff.renamedFile ? `変更: ${diff.oldPath}` : undefined} /></ListItemButton>
          })}
          {diffs.length === 0 ? <Box sx={{ p: 2 }}><Typography color="text.secondary" variant="caption">変更ファイルはありません。</Typography></Box> : null}
        </List>
      </Paper>
      <Paper sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }} variant="outlined">
        <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', px: 1.25, py: 1 }}>
          <Typography noWrap sx={{ fontWeight: 700 }} variant="body2">{selectedFile ?? 'ファイルを選択'}</Typography>
          <ToggleButtonGroup exclusive onChange={(_, next: 'diff' | 'file' | null) => { if (next) onViewChange(next) }} size="small" value={view}>
            <ToggleButton value="diff">差分</ToggleButton>
            <ToggleButton value="file">ファイル全体</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Divider />
        {selectedDiff?.tooLarge ? <Box sx={{ p: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><ErrorOutlineRoundedIcon color="warning" fontSize="small" /><Typography variant="body2">この差分は大きすぎるため省略されています。</Typography></Stack></Box> : null}
        {selectedDiff?.collapsed ? <Box sx={{ p: 2 }}><Typography color="text.secondary" variant="body2">GitLabが省略した差分です。全体を正常な空ファイルとして扱っていません。</Typography></Box> : null}
        {view === 'file' ? <FullFileView content={fileContent} loading={fileLoading} /> : <UnifiedDiff allowComments={allowComments} lines={rows} onComment={onComment} selectedPosition={selectedPosition} />}
        {view === 'diff' && rows.length < parsedRows.length ? <Button onClick={() => setDiffLimit((current) => current + 600)} size="small" sx={{ m: 1 }} variant="outlined">さらに600行を表示（残り{parsedRows.length - rows.length}行）</Button> : null}
      </Paper>
    </Stack>
  )
}

function UnifiedDiff({ allowComments, lines, onComment, selectedPosition }: { allowComments: boolean; lines: ParsedLine[]; onComment: (position: Position) => void; selectedPosition?: Position }) {
  return (
    <Box sx={{ maxHeight: 640, overflow: 'auto' }}>
      {lines.length === 0 ? <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">表示できる差分がありません。</Typography> : null}
      {lines.map((line, index) => {
        const position = line.newLine || line.oldLine ? ({ baseSha: '', headSha: '', newLine: line.newLine, newPath: line.newPath, oldPath: line.oldPath, oldLine: line.oldLine, positionType: 'text', startSha: '' } satisfies Position) : undefined
        return <Stack direction="row" key={`${index}-${line.text}`} sx={{ alignItems: 'stretch', bgcolor: line.kind === 'add' ? 'diff.addedBackground' : line.kind === 'remove' ? 'diff.deletedBackground' : undefined, color: line.kind === 'add' ? 'diff.addedText' : line.kind === 'remove' ? 'diff.deletedText' : 'text.primary', fontFamily: 'typography.code.fontFamily', fontSize: 'typography.code.fontSize', minHeight: 22, '&:hover .line-action': { opacity: 1 } }}>
          <Typography color="text.secondary" component="span" sx={{ flex: '0 0 44px', px: 0.75, textAlign: 'right', userSelect: 'none' }} variant="code">{line.oldLine ?? ''}</Typography>
          <Typography color="text.secondary" component="span" sx={{ flex: '0 0 44px', px: 0.75, textAlign: 'right', userSelect: 'none' }} variant="code">{line.newLine ?? ''}</Typography>
          <Typography component="span" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', px: 1, whiteSpace: 'pre' }} variant="code">{line.prefix}{line.text}</Typography>
          {position && allowComments ? <Button aria-label={`${line.newPath}の${line.newLine ?? line.oldLine}行にコメント`} className="line-action" onClick={() => onComment(position)} size="small" startIcon={<CommentOutlinedIcon fontSize="small" />} sx={{ flex: '0 0 auto', minWidth: 30, opacity: selectedPosition?.newLine === position.newLine ? 1 : 0, px: 0.5 }} /> : null}
        </Stack>
      })}
    </Box>
  )
}

function FullFileView({ content, loading }: { content?: string | null; loading: boolean }) {
  const [limit, setLimit] = useState(2000)
  if (loading) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">ファイル全体を読み込み中…</Typography>
  if (content === null || content === undefined) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">ファイル全体は未取得です。ファイルを選び直して取得してください。</Typography>
  if (!content) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">空ファイルです。</Typography>
  const lines = content.split(/\r?\n/u)
  return <Box sx={{ maxHeight: 640, overflow: 'auto' }}>{lines.slice(0, limit).map((line, index) => <Stack direction="row" key={index} sx={{ minHeight: 22 }}><Typography color="text.secondary" sx={{ flex: '0 0 48px', px: 1, textAlign: 'right', userSelect: 'none' }} variant="code">{index + 1}</Typography><Typography component="span" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', px: 1, whiteSpace: 'pre' }} variant="code">{line}</Typography></Stack>)}{limit < lines.length ? <Button onClick={() => setLimit((current) => current + 2000)} size="small" sx={{ m: 1 }} variant="outlined">さらに2000行を表示（残り{lines.length - limit}行）</Button> : null}</Box>
}

interface ParsedLine { kind: 'add' | 'remove' | 'context'; newLine?: number; oldLine?: number; newPath: string; oldPath: string; prefix: string; text: string }

function parseDiff(diff: string, oldPath: string, newPath: string): ParsedLine[] {
  const lines = diff.split(/\r?\n/u)
  const result: ParsedLine[] = []
  let oldLine: number | undefined
  let newLine: number | undefined
  for (const raw of lines) {
    if (raw.startsWith('+++ ') || raw.startsWith('--- ') || raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('\\')) continue
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw)
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); continue }
    if (oldLine === undefined || newLine === undefined) continue
    const kind = raw.startsWith('+') ? 'add' : raw.startsWith('-') ? 'remove' : 'context'
    const text = kind === 'context' ? raw.slice(1) : raw.slice(1)
    result.push({ kind, newLine: kind === 'remove' ? undefined : newLine, oldLine: kind === 'add' ? undefined : oldLine, newPath, oldPath, prefix: kind === 'add' ? '+' : kind === 'remove' ? '-' : ' ', text })
    if (kind === 'add') newLine += 1
    else if (kind === 'remove') oldLine += 1
    else { oldLine += 1; newLine += 1 }
  }
  return result
}
