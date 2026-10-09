import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import VerticalSplitOutlinedIcon from '@mui/icons-material/VerticalSplitOutlined'
import ViewStreamOutlinedIcon from '@mui/icons-material/ViewStreamOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { Theme } from '@mui/material/styles'
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Diff, Position } from '../../types/gitlab'
import { parseDiff, splitFileLines, type ParsedLine } from './diffParser'

export const DIFF_PAGE_SIZE = 600
export const FILE_PAGE_SIZE = 1000
/** Keep the file list and code inside the window so long diffs scroll in place. */
const DIFF_VIEWPORT_HEIGHT = 'max(360px, calc(100vh - 290px))'

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
  const displayedPath = selectedDiff ? selectedDiff.newPath || selectedDiff.oldPath : null
  const parsed = useMemo(() => selectedDiff ? parseDiff(selectedDiff.diff, selectedDiff.oldPath, selectedDiff.newPath) : { lines: [], status: 'valid' as const }, [selectedDiff])
  const diffKey = selectedDiff?.diff ?? ''
  const positionKey = selectedPosition ? `${selectedPosition.newPath}:${selectedPosition.oldPath}:${selectedPosition.oldLine ?? ''}:${selectedPosition.newLine ?? ''}` : ''
  const selectedLineIndex = useMemo(() => parsed.status === 'valid' && selectedPosition ? parsed.lines.findIndex((line) => matchesPosition(line, selectedPosition)) : -1, [parsed, selectedPosition])
  const requestedOffset = selectedLineIndex >= 0 ? Math.floor(selectedLineIndex / DIFF_PAGE_SIZE) * DIFF_PAGE_SIZE : 0
  const [diffPaging, setDiffPaging] = useState({ diffKey: '', positionKey: '', offset: 0 })
  const diffOffset = diffPaging.diffKey === diffKey && diffPaging.positionKey === positionKey ? diffPaging.offset : requestedOffset
  const diffScrollRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout)
  const changeLayout = (next: DiffLayout) => {
    setLayout(next)
    saveDiffLayout(next)
  }
  const updateDiffOffset = (update: (current: number) => number): void => {
    setDiffPaging((current) => {
      const currentOffset = current.diffKey === diffKey && current.positionKey === positionKey ? current.offset : requestedOffset
      return { diffKey, positionKey, offset: update(currentOffset) }
    })
  }

  const rows = parsed.lines.slice(diffOffset, diffOffset + DIFF_PAGE_SIZE)
  const lineCounts = useMemo(() => ({ added: parsed.lines.filter((line) => line.kind === 'add').length, removed: parsed.lines.filter((line) => line.kind === 'remove').length }), [parsed])
  const commentsEnabled = allowComments && !selectedDiff?.collapsed && !selectedDiff?.tooLarge && parsed.status === 'valid'

  useLayoutEffect(() => {
    if (!selectedPosition || view !== 'diff' || selectedLineIndex < 0) return
    const wantedLineId = positionLineId(selectedPosition)
    const target = Array.from(diffScrollRef.current?.querySelectorAll<HTMLElement>('[data-line-id]') ?? [])
      .find((line) => line.dataset.lineId === wantedLineId)
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({ behavior: 'auto', block: 'center' })
  }, [diffOffset, layout, positionKey, selectedLineIndex, selectedPosition, view])

  const displayedIndex = diffs.findIndex((diff) => (diff.newPath || diff.oldPath) === displayedPath)
  const selectRelative = (delta: number) => {
    const next = diffs[displayedIndex + delta]
    if (next) onSelectFile(next.newPath || next.oldPath)
  }

  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', minHeight: 420 }}>
        <Box component="nav" aria-label="変更ファイル" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, display: 'none', flex: '0 0 240px', flexDirection: 'column', maxHeight: DIFF_VIEWPORT_HEIGHT, minWidth: 0, position: 'sticky', top: 0, '@container (min-width: 820px)': { display: 'flex' } }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.25, py: 0.75 }}><Typography color="text.secondary" variant="overline">変更ファイル</Typography><Typography color="text.secondary" variant="caption">{diffs.length}</Typography></Stack>
          <List disablePadding sx={{ overflowY: 'auto', p: 0.5 }}>
            {diffs.map((diff) => {
              const path = diff.newPath || diff.oldPath
              const { directory, name } = splitPath(path)
              const kind = diff.tooLarge ? '取得制限' : diff.newFile ? '新規' : diff.deletedFile ? '削除' : diff.renamedFile ? `名前変更: ${diff.oldPath}` : null
              return <ListItemButton aria-label={path} key={path} onClick={() => onSelectFile(path)} selected={path === displayedPath} sx={{ px: 1, py: 0.5 }} title={path}><ListItemText primary={<Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}><FileKindMark diff={diff} /><Typography noWrap sx={{ fontWeight: path === displayedPath ? 600 : 400 }} variant="body2">{name}</Typography></Stack>} secondary={<Typography color="text.secondary" component="span" noWrap sx={{ display: 'block', pl: 2 }} variant="caption">{[kind, directory].filter(Boolean).join(' · ') || '/'}</Typography>} sx={{ m: 0 }} /></ListItemButton>
            })}
            {diffs.length === 0 ? <Box sx={{ p: 2 }}><Typography color="text.secondary" variant="caption">変更ファイルはありません。</Typography></Box> : null}
          </List>
        </Box>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', bgcolor: 'surface.list', borderBottom: 1, borderColor: 'divider', minHeight: 40, px: 1, py: 0.5 }}>
            <Tooltip title="前のファイル"><span><IconButton aria-label="前のファイル" disabled={displayedIndex <= 0} onClick={() => selectRelative(-1)}><KeyboardArrowUpRoundedIcon /></IconButton></span></Tooltip>
            <Tooltip title="次のファイル"><span><IconButton aria-label="次のファイル" disabled={displayedIndex < 0 || displayedIndex >= diffs.length - 1} onClick={() => selectRelative(1)}><KeyboardArrowDownRoundedIcon /></IconButton></span></Tooltip>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flex: 1, minWidth: 0 }}>
              <Typography noWrap title={displayedPath ?? undefined} sx={{ direction: 'rtl', fontFamily: 'typography.code.fontFamily', fontSize: 12.5, fontWeight: 600, minWidth: 0, textAlign: 'left' }} variant="body2">{displayedPath ?? 'ファイルを選択'}</Typography>
              {diffs.length > 1 ? <Typography color="text.secondary" sx={{ flexShrink: 0 }} variant="caption">{displayedIndex + 1}/{diffs.length}</Typography> : null}
              {selectedDiff && view === 'diff' ? <Typography aria-label={`追加${lineCounts.added}行、削除${lineCounts.removed}行`} component="span" sx={{ flexShrink: 0, fontFamily: 'typography.code.fontFamily', whiteSpace: 'nowrap' }} variant="caption"><Box component="span" sx={{ color: 'success.main' }}>+{lineCounts.added}</Box> <Box component="span" sx={{ color: 'error.main' }}>−{lineCounts.removed}</Box></Typography> : null}
            </Stack>
            {view === 'diff' ? <ToggleButtonGroup aria-label="差分の表示形式" exclusive onChange={(_, next: DiffLayout | null) => { if (next) changeLayout(next) }} size="small" sx={{ flexShrink: 0 }} value={layout}>
              <Tooltip title="統合表示（変更前後を1列に）"><ToggleButton aria-label="統合表示" value="unified"><ViewStreamOutlinedIcon sx={{ fontSize: 16 }} /></ToggleButton></Tooltip>
              <Tooltip title="左右に並べて比較（左: 変更前 / 右: 変更後）"><ToggleButton aria-label="左右に並べて比較" value="split"><VerticalSplitOutlinedIcon sx={{ fontSize: 16 }} /></ToggleButton></Tooltip>
            </ToggleButtonGroup> : null}
            <ToggleButtonGroup exclusive onChange={(_, next: 'diff' | 'file' | null) => { if (next) onViewChange(next) }} size="small" sx={{ flexShrink: 0 }} value={view}>
              <ToggleButton value="diff">差分</ToggleButton>
              <ToggleButton value="file">ファイル全体</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {selectedDiff?.tooLarge ? <Box sx={{ p: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><ErrorOutlineRoundedIcon color="warning" fontSize="small" /><Typography variant="body2">この差分は大きすぎるため省略されています。</Typography></Stack></Box> : null}
          {selectedDiff?.collapsed ? <Box sx={{ p: 2 }}><Typography color="text.secondary" variant="body2">GitLabが省略した差分です。全体を正常な空ファイルとして扱っていません。</Typography></Box> : null}
          {view === 'file' ? <FullFileView content={fileContent} loading={fileLoading} /> : <>
            {parsed.status !== 'valid' ? <Typography color="warning.main" role="status" sx={{ px: 1.25, pt: 1 }} variant="caption">差分の一部を検証できないため、コメント位置を無効化しています。</Typography> : null}
            <PageControls offset={diffOffset} pageSize={DIFF_PAGE_SIZE} total={parsed.lines.length} onNext={() => updateDiffOffset((current) => Math.min(current + DIFF_PAGE_SIZE, Math.max(0, parsed.lines.length - 1)))} onPrevious={() => updateDiffOffset((current) => Math.max(0, current - DIFF_PAGE_SIZE))} />
            {layout === 'split'
              ? <SplitDiff allowComments={commentsEnabled} lines={rows} onComment={onComment} scrollRef={diffScrollRef} selectedPosition={selectedPosition} startIndex={diffOffset} />
              : <UnifiedDiff allowComments={commentsEnabled} lines={rows} onComment={onComment} scrollRef={diffScrollRef} selectedPosition={selectedPosition} startIndex={diffOffset} />}
          </>}
        </Box>
      </Stack>
    </Box>
  )
}

function FileKindMark({ diff }: { diff: Diff }) {
  const [label, color] = diff.newFile ? ['A', 'success.main'] : diff.deletedFile ? ['D', 'error.main'] : diff.renamedFile ? ['R', 'info.main'] : ['M', 'warning.main']
  return <Box aria-hidden component="span" sx={{ color, flexShrink: 0, fontFamily: 'typography.code.fontFamily', fontSize: 11, fontWeight: 700, width: 10 }}>{label}</Box>
}

function PageControls({ offset, pageSize, total, onNext, onPrevious }: { offset: number; pageSize: number; total: number; onNext: () => void; onPrevious: () => void }) {
  if (total <= pageSize && offset === 0) return null
  const end = Math.min(total, offset + pageSize)
  const previous = offset
  const remaining = Math.max(0, total - end)
  return <Stack aria-label="行ページ" direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', px: 1.25, py: 0.75 }}>
    <Typography color="text.secondary" sx={{ mr: 'auto' }} variant="caption">表示 {offset + 1}–{end} / {total}行{remaining > 0 ? `（残り${remaining}行）` : ''}</Typography>
    <Button aria-label={`前の${pageSize}行`} disabled={previous === 0} onClick={onPrevious} size="small">前へ</Button>
    <Button aria-label={`次の${pageSize}行`} disabled={remaining === 0} onClick={onNext} size="small">次へ</Button>
  </Stack>
}

function UnifiedDiff({ allowComments, lines, onComment, scrollRef, selectedPosition, startIndex }: { allowComments: boolean; lines: ParsedLine[]; onComment: (position: Position) => void; scrollRef: React.RefObject<HTMLDivElement | null>; selectedPosition?: Position; startIndex: number }) {
  const skipped = skippedLines(lines, startIndex)
  // Rows are plain elements styled from this one block: a page holds up to
  // DIFF_PAGE_SIZE rows, and per-row styled components dominate render time.
  return (
    <Box ref={scrollRef} sx={(theme) => ({ ...diffBaseStyles(theme),
      '& .diff-rows': { minWidth: '100%', width: 'max-content' },
      '& .diff-row': { '--row-bg': theme.palette.background.paper, backgroundColor: 'var(--row-bg)', color: theme.palette.text.primary, display: 'flex', minHeight: 22 },
      '& .diff-row[data-kind="add"]': { '--row-bg': theme.palette.diff?.addedBackground, color: theme.palette.diff?.addedText },
      '& .diff-row[data-kind="remove"]': { '--row-bg': theme.palette.diff?.deletedBackground, color: theme.palette.diff?.deletedText },
      '& .diff-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .diff-gutter': { backgroundColor: 'var(--row-bg)', display: 'flex', flexShrink: 0, left: 0, paddingRight: '26px', position: 'sticky', zIndex: 1 },
      '& .diff-number': { color: theme.palette.text.secondary, opacity: 0.8, padding: '0 6px', textAlign: 'right', userSelect: 'none', width: 44 },
      '& .diff-row:hover .diff-action, & .diff-row:focus-within .diff-action, & .diff-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .diff-code': { flex: 1, paddingRight: '24px', whiteSpace: 'pre' },
      '& .diff-gap > span': { left: '12px', position: 'sticky' },
    })}>
      {lines.length === 0 ? <Typography color="text.secondary" sx={{ fontFamily: 'typography.fontFamily', p: 2 }} variant="body2">表示できる差分がありません。</Typography> : null}
      <div className="diff-rows">
        {lines.map((line, index) => {
          const isSelectedPosition = matchesPosition(line, selectedPosition)
          const position = linePosition(line)
          const key = `${startIndex + index}-${line.oldLine ?? ''}-${line.newLine ?? ''}`
          return <Fragment key={key}>
            {skipped[index] > 0 ? <div aria-hidden className="diff-gap"><span>⋯ 変更のない{skipped[index]}行</span></div> : null}
            <div className="diff-row" data-kind={line.kind} data-line-id={isSelectedPosition && selectedPosition ? positionLineId(selectedPosition) : undefined} data-selected={isSelectedPosition ? 'true' : undefined} data-testid="diff-line" tabIndex={isSelectedPosition ? -1 : undefined}>
              <span className="diff-gutter">
                <span className="diff-number">{line.oldLine ?? ''}</span>
                <span className="diff-number">{line.newLine ?? ''}</span>
                {position && allowComments ? <button aria-label={`${line.newPath}の${line.newLine ?? line.oldLine}行にコメント`} className="diff-action line-action" onClick={() => onComment(position)} title="この行にコメント" type="button">+</button> : null}
              </span>
              <span className="diff-code">{line.prefix} {line.text}</span>
            </div>
          </Fragment>
        })}
      </div>
    </Box>
  )
}

type DiffLayout = 'unified' | 'split'
const DIFF_LAYOUT_KEY = 'gitlab-desktop:diff-layout'

function readDiffLayout(): DiffLayout {
  try {
    return globalThis.localStorage?.getItem(DIFF_LAYOUT_KEY) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

function saveDiffLayout(layout: DiffLayout): void {
  try {
    globalThis.localStorage?.setItem(DIFF_LAYOUT_KEY, layout)
  } catch {
    // The choice still applies until the viewer is reopened.
  }
}

function linePosition(line: ParsedLine): Position | undefined {
  return line.commentable && (line.newLine !== undefined || line.oldLine !== undefined)
    ? { baseSha: '', headSha: '', newLine: line.newLine, newPath: line.newPath, oldPath: line.oldPath, oldLine: line.oldLine, positionType: 'text', startSha: '' }
    : undefined
}

interface SplitRow {
  key: string
  /** Unchanged lines GitLab omitted before this row. */
  gap: number
  left?: ParsedLine
  right?: ParsedLine
}

/**
 * Pairs a unified diff for side-by-side display: context lines appear on both
 * sides, and each run of removed lines is aligned with the added lines that
 * follow it, row by row.
 */
function buildSplitRows(lines: ParsedLine[], startIndex: number): SplitRow[] {
  const skipped = skippedLines(lines, startIndex)
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'context') {
      rows.push({ gap: skipped[index], key: `${startIndex + index}`, left: line, right: line })
      index += 1
      continue
    }
    const start = index
    const removed: ParsedLine[] = []
    const added: ParsedLine[] = []
    while (index < lines.length && lines[index].kind !== 'context') {
      if (lines[index].kind === 'remove') removed.push(lines[index])
      else added.push(lines[index])
      index += 1
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      rows.push({ gap: pair === 0 ? skipped[start] : 0, key: `${startIndex + start}-${pair}`, left: removed[pair], right: added[pair] })
    }
  }
  return rows
}

function SplitDiff({ allowComments, lines, onComment, scrollRef, selectedPosition, startIndex }: { allowComments: boolean; lines: ParsedLine[]; onComment: (position: Position) => void; scrollRef: React.RefObject<HTMLDivElement | null>; selectedPosition?: Position; startIndex: number }) {
  const rows = useMemo(() => buildSplitRows(lines, startIndex), [lines, startIndex])
  const cell = (line: ParsedLine | undefined, side: 'old' | 'new') => {
    // Context rows offer one comment action, on the new side, with both line numbers.
    const showAction = line && allowComments && (line.kind !== 'context' || side === 'new')
    const position = showAction ? linePosition(line) : undefined
    const number = side === 'old' ? line?.oldLine : line?.newLine
    const kind = !line ? 'empty' : line.kind
    const label = side === 'old' && line?.kind === 'remove'
      ? `${line.oldPath}の変更前${line.oldLine}行にコメント`
      : line ? `${line.newPath}の${line.newLine ?? line.oldLine}行にコメント` : ''
    return <>
      <span className="split-number" data-kind={kind} data-side={side}>
        {number ?? ''}
        {position ? <button aria-label={label} className="diff-action line-action" onClick={() => onComment(position)} title="この行にコメント" type="button">+</button> : null}
      </span>
      <span className="split-code" data-kind={kind}>{line ? line.text : ''}</span>
    </>
  }
  return (
    <Box ref={scrollRef} sx={(theme) => ({ ...diffBaseStyles(theme),
      '& .split-row': { display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) 54px minmax(0, 1fr)', minHeight: 22 },
      '& .split-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .split-number': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.secondary, padding: '0 24px 0 4px', position: 'relative', textAlign: 'right', userSelect: 'none' },
      '& .split-number .diff-action': { right: '2px' },
      '& .split-number[data-side="new"]': { borderLeft: `1px solid ${theme.palette.divider}` },
      '& .split-code': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, overflowWrap: 'anywhere', padding: '0 10px 0 6px', whiteSpace: 'pre-wrap' },
      '& [data-kind="remove"]': { backgroundColor: theme.palette.diff?.deletedBackground, color: theme.palette.diff?.deletedText },
      '& .split-number[data-kind="remove"]': { color: theme.palette.diff?.deletedText },
      '& [data-kind="add"]': { backgroundColor: theme.palette.diff?.addedBackground, color: theme.palette.diff?.addedText },
      '& .split-number[data-kind="add"]': { color: theme.palette.diff?.addedText },
      '& [data-kind="empty"]': { backgroundColor: theme.palette.action.hover },
      '& .split-row:hover .diff-action, & .split-row:focus-within .diff-action, & .split-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .diff-gap > span': { position: 'static' },
    })}>
      {rows.length === 0 ? <Typography color="text.secondary" sx={{ fontFamily: 'typography.fontFamily', p: 2 }} variant="body2">表示できる差分がありません。</Typography> : null}
      {rows.map((row) => {
        const selected = Boolean(selectedPosition && ((row.left && matchesPosition(row.left, selectedPosition)) || (row.right && matchesPosition(row.right, selectedPosition))))
        return <Fragment key={row.key}>
          {row.gap > 0 ? <div aria-hidden className="diff-gap"><span>⋯ 変更のない{row.gap}行</span></div> : null}
          <div className="split-row" data-line-id={selected && selectedPosition ? positionLineId(selectedPosition) : undefined} data-selected={selected ? 'true' : undefined} data-testid="diff-split-row" tabIndex={selected ? -1 : undefined}>
            {cell(row.left, 'old')}
            {cell(row.right, 'new')}
          </div>
        </Fragment>
      })}
    </Box>
  )
}

/** Styles shared by the unified and side-by-side layouts. */
function diffBaseStyles(theme: Theme) {
  return {
    flex: 1,
    fontFamily: theme.typography.code?.fontFamily ?? 'monospace',
    fontSize: theme.typography.code?.fontSize ?? '0.8125rem',
    lineHeight: '22px',
    maxHeight: DIFF_VIEWPORT_HEIGHT,
    overflow: 'auto',
    py: 0.5,
    '& .diff-action': { alignItems: 'center', backgroundColor: theme.palette.primary.main, border: 0, borderRadius: '4px', color: theme.palette.primary.contrastText, cursor: 'pointer', fontFamily: theme.typography.fontFamily, fontSize: 14, fontWeight: 700, height: 18, lineHeight: '18px', opacity: 0, padding: 0, position: 'absolute', right: '3px', textAlign: 'center', top: 2, width: 20 },
    '& .diff-action:hover': { backgroundColor: theme.palette.primary.dark ?? theme.palette.primary.main },
    '& .diff-action:focus-visible': { opacity: 1, outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    '& .diff-gap': { backgroundColor: theme.palette.action.hover, color: theme.palette.text.secondary, fontFamily: theme.typography.fontFamily, fontSize: theme.typography.caption.fontSize, padding: '2px 12px' },
  }
}

/** Number of unchanged lines GitLab omitted before each displayed line. */
function skippedLines(lines: ParsedLine[], startIndex: number): number[] {
  let lastOld: number | undefined
  let lastNew: number | undefined
  return lines.map((line, index) => {
    let skipped = 0
    if (startIndex + index === 0) skipped = Math.max(0, (line.newLine ?? line.oldLine ?? 1) - 1)
    else if (line.newLine !== undefined && lastNew !== undefined) skipped = Math.max(0, line.newLine - lastNew - 1)
    else if (line.oldLine !== undefined && lastOld !== undefined) skipped = Math.max(0, line.oldLine - lastOld - 1)
    if (line.oldLine !== undefined) lastOld = line.oldLine
    if (line.newLine !== undefined) lastNew = line.newLine
    return skipped
  })
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
    <Box data-testid="file-lines" sx={{ maxHeight: DIFF_VIEWPORT_HEIGHT, overflow: 'auto', py: 0.5 }}>{visibleLines.map((line, index) => <Stack data-testid="file-line" direction="row" key={offset + index} sx={{ minHeight: 22 }}><Typography color="text.secondary" sx={{ borderRight: 1, borderColor: 'divider', flex: '0 0 52px', px: 1, textAlign: 'right', userSelect: 'none' }} variant="code">{offset + index + 1}</Typography><Typography component="span" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', px: 1, whiteSpace: 'pre' }} variant="code">{line}</Typography></Stack>)}</Box>
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

function positionLineId(position: Pick<Position, 'newPath' | 'oldPath' | 'newLine' | 'oldLine'> | ParsedLine): string {
  return JSON.stringify([position.newPath, position.oldPath, position.oldLine ?? null, position.newLine ?? null])
}

function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/')
  return index < 0 ? { directory: '', name: path } : { directory: path.slice(0, index), name: path.slice(index + 1) }
}
