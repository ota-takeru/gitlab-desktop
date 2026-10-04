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
import { parseDiff, splitFileLines, type ParsedLine } from './diffParser'

export const DIFF_PAGE_SIZE = 600
export const FILE_PAGE_SIZE = 1000

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
  const parsed = useMemo(() => selectedDiff ? parseDiff(selectedDiff.diff, selectedDiff.oldPath, selectedDiff.newPath) : { lines: [], status: 'valid' as const }, [selectedDiff])
  const diffKey = selectedDiff?.diff ?? ''
  const positionKey = selectedPosition ? `${selectedPosition.newPath}:${selectedPosition.oldPath}:${selectedPosition.oldLine ?? ''}:${selectedPosition.newLine ?? ''}` : ''
  const selectedLineIndex = useMemo(() => parsed.status === 'valid' && selectedPosition ? parsed.lines.findIndex((line) => matchesPosition(line, selectedPosition)) : -1, [parsed, selectedPosition])
  const requestedOffset = selectedLineIndex >= 0 ? Math.floor(selectedLineIndex / DIFF_PAGE_SIZE) * DIFF_PAGE_SIZE : 0
  const [diffPaging, setDiffPaging] = useState({ diffKey: '', positionKey: '', offset: 0 })
  const diffOffset = diffPaging.diffKey === diffKey && diffPaging.positionKey === positionKey ? diffPaging.offset : requestedOffset
  const updateDiffOffset = (update: (current: number) => number): void => {
    setDiffPaging((current) => {
      const currentOffset = current.diffKey === diffKey && current.positionKey === positionKey ? current.offset : requestedOffset
      return { diffKey, positionKey, offset: update(currentOffset) }
    })
  }

  const rows = parsed.lines.slice(diffOffset, diffOffset + DIFF_PAGE_SIZE)
  const commentsEnabled = allowComments && !selectedDiff?.collapsed && !selectedDiff?.tooLarge && parsed.status === 'valid'

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
        {view === 'file' ? <FullFileView content={fileContent} loading={fileLoading} /> : <>
          {parsed.status !== 'valid' ? <Typography color="warning.main" role="status" sx={{ px: 1.25, pt: 1 }} variant="caption">差分の一部を検証できないため、コメント位置を無効化しています。</Typography> : null}
          <PageControls offset={diffOffset} pageSize={DIFF_PAGE_SIZE} total={parsed.lines.length} onNext={() => updateDiffOffset((current) => Math.min(current + DIFF_PAGE_SIZE, Math.max(0, parsed.lines.length - 1)))} onPrevious={() => updateDiffOffset((current) => Math.max(0, current - DIFF_PAGE_SIZE))} />
          <UnifiedDiff allowComments={commentsEnabled} lines={rows} onComment={onComment} selectedPosition={selectedPosition} startIndex={diffOffset} />
        </>}
      </Paper>
    </Stack>
  )
}

function PageControls({ offset, pageSize, total, onNext, onPrevious }: { offset: number; pageSize: number; total: number; onNext: () => void; onPrevious: () => void }) {
  if (total === 0) return null
  const end = Math.min(total, offset + pageSize)
  const previous = offset
  const remaining = Math.max(0, total - end)
  return <Stack aria-label="行ページ" direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', px: 1.25, py: 0.75 }}>
    <Typography color="text.secondary" sx={{ mr: 'auto' }} variant="caption">表示 {offset + 1}–{end} / {total}行{remaining > 0 ? `（残り${remaining}行）` : ''}</Typography>
    <Button aria-label={`前の${pageSize}行`} disabled={previous === 0} onClick={onPrevious} size="small">前へ</Button>
    <Button aria-label={`次の${pageSize}行`} disabled={remaining === 0} onClick={onNext} size="small">次へ</Button>
  </Stack>
}

function UnifiedDiff({ allowComments, lines, onComment, selectedPosition, startIndex }: { allowComments: boolean; lines: ParsedLine[]; onComment: (position: Position) => void; selectedPosition?: Position; startIndex: number }) {
  return (
    <Box sx={{ maxHeight: 640, overflow: 'auto' }}>
      {lines.length === 0 ? <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">表示できる差分がありません。</Typography> : null}
      {lines.map((line, index) => {
        const position = line.commentable && (line.newLine !== undefined || line.oldLine !== undefined) ? ({ baseSha: '', headSha: '', newLine: line.newLine, newPath: line.newPath, oldPath: line.oldPath, oldLine: line.oldLine, positionType: 'text', startSha: '' } satisfies Position) : undefined
        return <Stack data-kind={line.kind} data-testid="diff-line" direction="row" key={`${startIndex + index}-${line.oldLine ?? ''}-${line.newLine ?? ''}`} sx={{ alignItems: 'stretch', bgcolor: line.kind === 'add' ? 'diff.addedBackground' : line.kind === 'remove' ? 'diff.deletedBackground' : undefined, color: line.kind === 'add' ? 'diff.addedText' : line.kind === 'remove' ? 'diff.deletedText' : 'text.primary', fontFamily: 'typography.code.fontFamily', fontSize: 'typography.code.fontSize', minHeight: 22, '&:hover .line-action': { opacity: 1 } }}>
          <Typography color="text.secondary" component="span" sx={{ flex: '0 0 44px', px: 0.75, textAlign: 'right', userSelect: 'none' }} variant="code">{line.oldLine ?? ''}</Typography>
          <Typography color="text.secondary" component="span" sx={{ flex: '0 0 44px', px: 0.75, textAlign: 'right', userSelect: 'none' }} variant="code">{line.newLine ?? ''}</Typography>
          <Typography component="span" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', px: 1, whiteSpace: 'pre' }} variant="code">{line.prefix}{line.text}</Typography>
          {position && allowComments ? <Button aria-label={`${line.newPath}の${line.newLine ?? line.oldLine}行にコメント`} className="line-action" onClick={() => onComment(position)} size="small" startIcon={<CommentOutlinedIcon fontSize="small" />} sx={{ '&:focus-visible': { opacity: 1 }, flex: '0 0 auto', minWidth: 30, opacity: matchesPosition(line, selectedPosition) ? 1 : 0, px: 0.5 }} /> : null}
        </Stack>
      })}
    </Box>
  )
}

function FullFileView({ content, loading }: { content?: string | null; loading: boolean }) {
  const lines = useMemo(() => content === null || content === undefined ? [] : splitFileLines(content), [content])
  const contentKey = content ?? '__missing__'
  const [filePaging, setFilePaging] = useState({ contentKey: '', offset: 0 })
  const offset = filePaging.contentKey === contentKey ? filePaging.offset : 0
  const updateOffset = (update: (current: number) => number): void => {
    setFilePaging((current) => {
      const currentOffset = current.contentKey === contentKey ? current.offset : 0
      return { contentKey, offset: update(currentOffset) }
    })
  }

  if (loading) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">ファイル全体を読み込み中…</Typography>
  if (content === null || content === undefined) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">ファイル全体は未取得です。ファイルを選び直して取得してください。</Typography>
  if (!content) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">空ファイルです。</Typography>
  const visibleLines = lines.slice(offset, offset + FILE_PAGE_SIZE)
  return <>
    <PageControls offset={offset} pageSize={FILE_PAGE_SIZE} total={lines.length} onNext={() => updateOffset((current) => Math.min(current + FILE_PAGE_SIZE, Math.max(0, lines.length - 1)))} onPrevious={() => updateOffset((current) => Math.max(0, current - FILE_PAGE_SIZE))} />
    <Box data-testid="file-lines" sx={{ maxHeight: 640, overflow: 'auto' }}>{visibleLines.map((line, index) => <Stack data-testid="file-line" direction="row" key={offset + index} sx={{ minHeight: 22 }}><Typography color="text.secondary" sx={{ flex: '0 0 48px', px: 1, textAlign: 'right', userSelect: 'none' }} variant="code">{offset + index + 1}</Typography><Typography component="span" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', px: 1, whiteSpace: 'pre' }} variant="code">{line}</Typography></Stack>)}</Box>
  </>
}

function matchesPosition(line: ParsedLine, position: Position | undefined): boolean {
  if (!position) return false
  const pathMatches = position.newPath === line.newPath || position.oldPath === line.oldPath
  if (!pathMatches) return false
  if (position.newLine !== undefined) return line.newLine === position.newLine
  if (position.oldLine !== undefined) return line.oldLine === position.oldLine
  return false
}
