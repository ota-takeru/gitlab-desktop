import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import VerticalSplitOutlinedIcon from '@mui/icons-material/VerticalSplitOutlined'
import ViewStreamOutlinedIcon from '@mui/icons-material/ViewStreamOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import InputAdornment from '@mui/material/InputAdornment'
import { alpha, type Theme } from '@mui/material/styles'
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Diff, Position } from '../../types/gitlab'
import { highlightLines, languageForPath, type SyntaxToken } from '../../lib/syntaxHighlight'
import { parseDiff, splitFileLines, type ParsedLine } from './diffParser'
import { useReviewedFiles, type ReviewedFileContext } from './useReviewedFiles'

export const DIFF_PAGE_SIZE = 600
export const FILE_PAGE_SIZE = 1000
/** Keep the file list and code inside the window so long diffs scroll in place. */
const DIFF_VIEWPORT_HEIGHT = 'max(360px, calc(100vh - 290px))'
const EMPTY_PARSED_DIFF = { lines: [], status: 'valid' as const }

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
  reviewContext?: ReviewedFileContext
}

export function DiffViewer({ allowComments = true, diffs, fileContent, fileLoading = false, onComment, onSelectFile, onViewChange, reviewContext, selectedFile, selectedPosition, view }: DiffViewerProps) {
  const selectedDiffIndex = diffs.findIndex((diff) => (diff.newPath || diff.oldPath) === selectedFile)
  const displayedIndex = selectedDiffIndex >= 0 ? selectedDiffIndex : diffs.length > 0 ? 0 : -1
  const selectedDiff = displayedIndex >= 0 ? diffs[displayedIndex] : undefined
  const displayedPath = selectedDiff ? selectedDiff.newPath || selectedDiff.oldPath : null
  const parsed = useMemo(() => selectedDiff ? parseDiff(selectedDiff.diff, selectedDiff.oldPath, selectedDiff.newPath) : EMPTY_PARSED_DIFF, [selectedDiff])
  const diffKey = selectedDiff ? `${displayedPath}\0${selectedDiff.diff}` : ''
  const positionKey = selectedPosition ? `${selectedPosition.newPath}:${selectedPosition.oldPath}:${selectedPosition.oldLine ?? ''}:${selectedPosition.newLine ?? ''}` : ''
  const selectedLineIndex = useMemo(() => parsed.status === 'valid' && selectedPosition ? parsed.lines.findIndex((line) => matchesPosition(line, selectedPosition)) : -1, [parsed, selectedPosition])
  const [diffSearch, setDiffSearch] = useState('')
  const [fileSearch, setFileSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState<{ query: string; path: string; lineIndex: number } | null>(null)
  // Parse and lowercase the whole page only while searching, and only once per
  // page of diffs rather than on every keystroke.
  const searching = Boolean(diffSearch.trim())
  const searchableLines = useMemo(() => searching
    ? diffs.map((diff) => parseDiff(diff.diff, diff.oldPath, diff.newPath).lines.map((line) => line.text.toLocaleLowerCase()))
    : [], [diffs, searching])
  const searchMatches = useMemo(() => {
    const query = diffSearch.trim().toLocaleLowerCase()
    if (!query) return [] as Array<{ path: string; lineIndex: number }>
    const matches: Array<{ path: string; lineIndex: number }> = []
    searchableLines.forEach((lines, fileIndex) => {
      const path = diffs[fileIndex].newPath || diffs[fileIndex].oldPath
      lines.forEach((text, lineIndex) => {
        if (text.includes(query)) matches.push({ lineIndex, path })
      })
    })
    return matches
  }, [diffSearch, diffs, searchableLines])
  const activeSearchResultIndex = activeSearch?.query === diffSearch
    ? searchMatches.findIndex((match) => match.path === activeSearch.path && match.lineIndex === activeSearch.lineIndex)
    : -1
  const currentSearchMatch = activeSearch?.query === diffSearch && activeSearch.path === displayedPath
    ? activeSearch.lineIndex
    : -1
  const pagingPositionKey = currentSearchMatch >= 0 ? `search:${diffSearch}:${currentSearchMatch}` : positionKey
  const requestedOffset = currentSearchMatch >= 0
    ? Math.floor(currentSearchMatch / DIFF_PAGE_SIZE) * DIFF_PAGE_SIZE
    : selectedLineIndex >= 0 ? Math.floor(selectedLineIndex / DIFF_PAGE_SIZE) * DIFF_PAGE_SIZE : 0
  const [diffPaging, setDiffPaging] = useState({ diffKey: '', positionKey: '', offset: 0 })
  const diffOffset = diffPaging.diffKey === diffKey && diffPaging.positionKey === pagingPositionKey ? diffPaging.offset : requestedOffset
  const diffScrollRef = useRef<HTMLDivElement | null>(null)
  const reviewState = useReviewedFiles(reviewContext, diffs)
  const fileSearchMatches = useMemo(() => {
    const query = fileSearch.trim().toLocaleLowerCase()
    return diffs.map((diff, index) => ({ diff, index, path: diff.newPath || diff.oldPath }))
      .filter(({ path }) => !query || path.toLocaleLowerCase().includes(query))
  }, [diffs, fileSearch])
  const displayedFileMatchIndex = fileSearchMatches.findIndex(({ path }) => path === displayedPath)
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout)
  const changeLayout = (next: DiffLayout) => {
    setLayout(next)
    saveDiffLayout(next)
  }
  const updateDiffOffset = (update: (current: number) => number): void => {
    setDiffPaging((current) => {
      const currentOffset = current.diffKey === diffKey && current.positionKey === pagingPositionKey ? current.offset : requestedOffset
      return { diffKey, positionKey: pagingPositionKey, offset: update(currentOffset) }
    })
  }

  const rows = parsed.lines.slice(diffOffset, diffOffset + DIFF_PAGE_SIZE)
  const language = displayedPath ? languageForPath(displayedPath) : null
  const rowTokens = useMemo(() => highlightDiffLines(parsed.lines.slice(diffOffset, diffOffset + DIFF_PAGE_SIZE), language), [diffOffset, language, parsed])
  const pageSearchMatches = new Set(searchMatches.filter((match) => match.path === displayedPath).map((match) => match.lineIndex))
  const lineCounts = useMemo(() => ({ added: parsed.lines.filter((line) => line.kind === 'add').length, removed: parsed.lines.filter((line) => line.kind === 'remove').length }), [parsed])
  const commentsEnabled = allowComments && !selectedDiff?.collapsed && !selectedDiff?.tooLarge && parsed.status === 'valid'

  const navigateSearch = (direction: -1 | 1) => {
    if (searchMatches.length === 0) return
    let nextIndex: number
    if (activeSearchResultIndex < 0) nextIndex = direction > 0 ? 0 : searchMatches.length - 1
    else nextIndex = (activeSearchResultIndex + direction + searchMatches.length) % searchMatches.length
    const match = searchMatches[nextIndex]
    setActiveSearch({ query: diffSearch, path: match.path, lineIndex: match.lineIndex })
    onViewChange('diff')
    if (match.path !== displayedPath) onSelectFile(match.path)
  }

  const navigateFileSearch = (direction: -1 | 1) => {
    if (!fileSearch.trim() || fileSearchMatches.length === 0) return
    let nextIndex: number
    if (displayedFileMatchIndex < 0) nextIndex = direction > 0 ? 0 : fileSearchMatches.length - 1
    else nextIndex = (displayedFileMatchIndex + direction + fileSearchMatches.length) % fileSearchMatches.length
    onSelectFile(fileSearchMatches[nextIndex].path)
  }

  useLayoutEffect(() => {
    if (!selectedPosition || view !== 'diff' || selectedLineIndex < 0) return
    const wantedLineId = positionLineId(selectedPosition)
    const target = Array.from(diffScrollRef.current?.querySelectorAll<HTMLElement>('[data-line-id]') ?? [])
      .find((line) => line.dataset.lineId === wantedLineId)
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({ behavior: 'auto', block: 'center' })
  }, [diffOffset, layout, positionKey, selectedLineIndex, selectedPosition, view])

  useLayoutEffect(() => {
    if (currentSearchMatch < 0 || view !== 'diff') return
    const target = diffScrollRef.current?.querySelector<HTMLElement>('[data-search-active="true"]')
    target?.scrollIntoView?.({ behavior: 'auto', block: 'center' })
  }, [currentSearchMatch, diffOffset, layout, view])

  const selectRelative = (delta: number) => {
    const next = diffs[displayedIndex + delta]
    if (next) onSelectFile(next.newPath || next.oldPath)
  }

  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', minHeight: 420 }}>
        <Box component="nav" aria-label="変更ファイル" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, display: 'none', flex: '0 0 240px', flexDirection: 'column', maxHeight: DIFF_VIEWPORT_HEIGHT, minWidth: 0, position: 'sticky', top: 0, '@container (min-width: 820px)': { display: 'flex' } }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.25, py: 0.75 }}><Typography color="text.secondary" variant="overline">変更ファイル</Typography><Typography color="text.secondary" variant="caption">{fileSearchMatches.length}/{diffs.length}</Typography></Stack>
          <List disablePadding sx={{ overflowY: 'auto', p: 0.5 }}>
            {fileSearchMatches.map(({ diff, path }) => {
              const { directory, name } = splitPath(path)
              const kind = diff.tooLarge ? '取得制限' : diff.newFile ? '新規' : diff.deletedFile ? '削除' : diff.renamedFile ? `名前変更: ${diff.oldPath}` : null
              return <ListItemButton aria-label={path} key={`${diff.oldPath}\0${path}`} onClick={() => onSelectFile(path)} selected={path === displayedPath} sx={{ px: 1, py: 0.5 }} title={path}><ListItemText primary={<Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}><FileKindMark diff={diff} /><Typography noWrap sx={{ flex: 1, fontWeight: path === displayedPath ? 600 : 400 }} variant="body2">{name}</Typography>{reviewState.isReviewed(path) ? <Tooltip title="確認済み"><DoneRoundedIcon aria-label="確認済み" color="success" fontSize="small" /></Tooltip> : null}</Stack>} secondary={<Typography color="text.secondary" component="span" noWrap sx={{ display: 'block', pl: 2 }} variant="caption">{[kind, directory].filter(Boolean).join(' · ') || '/'}</Typography>} sx={{ m: 0 }} /></ListItemButton>
            })}
            {fileSearchMatches.length === 0 ? <Box sx={{ p: 2 }}><Typography color="text.secondary" variant="caption">{diffs.length === 0 ? '変更ファイルはありません。' : '一致するファイルはありません。'}</Typography></Box> : null}
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
            {reviewState.enabled && selectedDiff && !selectedDiff.collapsed && !selectedDiff.tooLarge && parsed.status === 'valid' ? <Tooltip describeChild title="head SHAまたはファイル差分が変わると未確認に戻ります。"><Button aria-pressed={reviewState.isReviewed(displayedPath ?? '')} onClick={() => reviewState.toggleReviewed(selectedDiff)} size="small" variant="outlined">{reviewState.isReviewed(displayedPath ?? '') ? '確認済み' : '確認済みにする'}</Button></Tooltip> : null}
            {view === 'diff' ? <ToggleButtonGroup aria-label="差分の表示形式" exclusive onChange={(_, next: DiffLayout | null) => { if (next) changeLayout(next) }} size="small" sx={{ flexShrink: 0 }} value={layout}>
              <Tooltip title="統合表示（変更前後を1列に）"><ToggleButton aria-label="統合表示" value="unified"><ViewStreamOutlinedIcon sx={{ fontSize: 16 }} /></ToggleButton></Tooltip>
              <Tooltip title="左右に並べて比較（左: 変更前 / 右: 変更後）"><ToggleButton aria-label="左右に並べて比較" value="split"><VerticalSplitOutlinedIcon sx={{ fontSize: 16 }} /></ToggleButton></Tooltip>
            </ToggleButtonGroup> : null}
            <ToggleButtonGroup exclusive onChange={(_, next: 'diff' | 'file' | null) => { if (next) onViewChange(next) }} size="small" sx={{ flexShrink: 0 }} value={view}>
              <ToggleButton value="diff">差分</ToggleButton>
              <ToggleButton value="file">ファイル全体</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {/* One dense row: the search fields take the height of a toolbar, not of a form. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ borderBottom: 1, borderColor: 'divider', px: 1, py: 0.5 }}>
            <TextField
              fullWidth
              onChange={(event) => { setDiffSearch(event.target.value); setActiveSearch(null) }}
              placeholder="差分内を検索"
              size="small"
              sx={denseFieldSx}
              title="表示中の差分ページを検索します。他のページは対象外です。"
              value={diffSearch}
              slotProps={{ htmlInput: { 'aria-label': '差分内を検索' }, input: { endAdornment: <InputAdornment position="end"><Typography aria-live="polite" color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{diffSearch.trim() ? `${activeSearchResultIndex >= 0 ? activeSearchResultIndex + 1 : 0}/${searchMatches.length}` : ''}</Typography><IconButton aria-label="前の差分内検索結果" disabled={searchMatches.length === 0} onClick={() => navigateSearch(-1)} size="small"><KeyboardArrowUpRoundedIcon /></IconButton><IconButton aria-label="次の差分内検索結果" disabled={searchMatches.length === 0} onClick={() => navigateSearch(1)} size="small"><KeyboardArrowDownRoundedIcon /></IconButton></InputAdornment> } }}
            />
            <TextField
              fullWidth
              onChange={(event) => setFileSearch(event.target.value)}
              placeholder="ファイル名を検索"
              size="small"
              sx={denseFieldSx}
              value={fileSearch}
              slotProps={{ htmlInput: { 'aria-label': 'ファイル名を検索' }, input: { endAdornment: <InputAdornment position="end"><Typography aria-live="polite" color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{fileSearch.trim() ? `${displayedFileMatchIndex >= 0 ? displayedFileMatchIndex + 1 : 0}/${fileSearchMatches.length}` : ''}</Typography><IconButton aria-label="前の一致ファイル" disabled={!fileSearch.trim() || fileSearchMatches.length === 0} onClick={() => navigateFileSearch(-1)} size="small"><KeyboardArrowUpRoundedIcon /></IconButton><IconButton aria-label="次の一致ファイル" disabled={!fileSearch.trim() || fileSearchMatches.length === 0} onClick={() => navigateFileSearch(1)} size="small"><KeyboardArrowDownRoundedIcon /></IconButton></InputAdornment> } }}
            />
          </Stack>
          {fileSearch.trim() && fileSearchMatches.length === 0 ? <Typography color="text.secondary" role="status" sx={{ px: 1.25, pt: 1 }} variant="caption">一致するファイルはありません。</Typography> : null}
          {selectedDiff?.tooLarge ? <Box sx={{ p: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><ErrorOutlineRoundedIcon color="warning" fontSize="small" /><Typography variant="body2">この差分は大きすぎるため省略されています。</Typography></Stack></Box> : null}
          {selectedDiff?.collapsed ? <Box sx={{ p: 2 }}><Typography color="text.secondary" variant="body2">GitLabが省略した差分です。全体を正常な空ファイルとして扱っていません。</Typography></Box> : null}
          {view === 'file' ? <FullFileView key={displayedPath ?? ''} content={fileContent} language={language} loading={fileLoading} /> : <>
            {parsed.status !== 'valid' ? <Typography color="warning.main" role="status" sx={{ px: 1.25, pt: 1 }} variant="caption">差分の一部を検証できないため、コメント位置を無効化しています。</Typography> : null}
            {diffSearch.trim() && searchMatches.length === 0 ? <Typography color="text.secondary" role="status" sx={{ px: 1.25, pt: 1 }} variant="caption">取得済みの差分に一致する行はありません。</Typography> : null}
            <PageControls offset={diffOffset} pageSize={DIFF_PAGE_SIZE} total={parsed.lines.length} onNext={() => updateDiffOffset((current) => Math.min(current + DIFF_PAGE_SIZE, Math.max(0, parsed.lines.length - 1)))} onPrevious={() => updateDiffOffset((current) => Math.max(0, current - DIFF_PAGE_SIZE))} />
            {layout === 'split'
              ? <SplitDiff key={displayedPath ?? ''} activeSearchMatch={currentSearchMatch} allowComments={commentsEnabled} lines={rows} onComment={onComment} scrollRef={diffScrollRef} searchMatchIndices={pageSearchMatches} searchTerm={diffSearch.trim()} selectedPosition={selectedPosition} startIndex={diffOffset} tokens={rowTokens} />
              : <UnifiedDiff key={displayedPath ?? ''} activeSearchMatch={currentSearchMatch} allowComments={commentsEnabled} lines={rows} onComment={onComment} scrollRef={diffScrollRef} searchMatchIndices={pageSearchMatches} searchTerm={diffSearch.trim()} selectedPosition={selectedPosition} startIndex={diffOffset} tokens={rowTokens} />}
          </>}
        </Box>
      </Stack>
    </Box>
  )
}

const SNIPPET_LINES_BEFORE = 3
const NO_SEARCH_MATCHES = new Set<number>()

/** The commented diff line with the lines just above it, as shown while writing a line comment. */
export function DiffSnippet({ diff, position }: { diff: Diff; position: Position }) {
  const parsed = useMemo(() => parseDiff(diff.diff, diff.oldPath, diff.newPath), [diff])
  const target = parsed.lines.findIndex((line) => matchesPosition(line, position))
  const start = Math.max(0, target - SNIPPET_LINES_BEFORE)
  const lines = useMemo(() => target < 0 ? [] : parsed.lines.slice(start, target + 1), [parsed, start, target])
  const language = languageForPath(diff.newPath || diff.oldPath)
  const tokens = useMemo(() => highlightDiffLines(lines, language), [language, lines])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  if (lines.length === 0) return null
  return (
    <Box aria-label="コメント対象のコード" component="figure" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, m: 0, overflow: 'hidden' }}>
      <UnifiedDiff activeSearchMatch={-1} allowComments={false} lines={lines} onComment={() => undefined} scrollRef={scrollRef} searchMatchIndices={NO_SEARCH_MATCHES} searchTerm="" selectedPosition={position} startIndex={start} tokens={tokens} />
    </Box>
  )
}

const denseFieldSx = { '& .MuiInputBase-input': { py: 0.5 } }

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

function UnifiedDiff({ activeSearchMatch, allowComments, lines, onComment, scrollRef, searchMatchIndices, searchTerm, selectedPosition, startIndex, tokens }: { activeSearchMatch: number; allowComments: boolean; lines: ParsedLine[]; onComment: (position: Position) => void; scrollRef: React.RefObject<HTMLDivElement | null>; searchMatchIndices: Set<number>; searchTerm: string; selectedPosition?: Position; startIndex: number; tokens: SyntaxToken[][] }) {
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
      '& .diff-row[data-search-active="true"]': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: -2 },
      '& mark': { backgroundColor: theme.palette.warning.light, color: theme.palette.warning.contrastText },
      '& .diff-gutter': { backgroundColor: 'var(--row-bg)', display: 'flex', flexShrink: 0, left: 0, paddingRight: '26px', position: 'sticky', zIndex: 1 },
      '& .diff-number': { color: theme.palette.text.secondary, opacity: 0.8, padding: '0 6px', textAlign: 'right', userSelect: 'none', width: 44 },
      '& .diff-row:hover .diff-action, & .diff-row:focus-within .diff-action, & .diff-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .diff-code': { color: theme.palette.text.primary, flex: 1, paddingRight: '24px', whiteSpace: 'pre' },
      '& .diff-row[data-kind="add"] .diff-prefix': { color: theme.palette.diff?.addedText },
      '& .diff-row[data-kind="remove"] .diff-prefix': { color: theme.palette.diff?.deletedText },
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
            <div className="diff-row" data-kind={line.kind} data-line-id={isSelectedPosition && selectedPosition ? positionLineId(selectedPosition) : undefined} data-search-match={searchMatchIndices.has(startIndex + index) ? 'true' : undefined} data-search-active={activeSearchMatch === startIndex + index ? 'true' : undefined} data-selected={isSelectedPosition ? 'true' : undefined} data-testid="diff-line" tabIndex={isSelectedPosition ? -1 : undefined}>
              <span className="diff-gutter">
                <span className="diff-number">{line.oldLine ?? ''}</span>
                <span className="diff-number">{line.newLine ?? ''}</span>
                {position && allowComments ? <button aria-label={`${line.newPath}の${line.newLine ?? line.oldLine}行にコメント`} className="diff-action line-action" onClick={() => onComment(position)} title="この行にコメント" type="button">+</button> : null}
              </span>
              <span className="diff-code"><span className="diff-prefix">{line.prefix}</span> {renderCode(tokens[index] ?? [{ text: line.text }], searchTerm)}</span>
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
  leftIndex?: number
  rightIndex?: number
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
      rows.push({ gap: skipped[index], key: `${startIndex + index}`, left: line, leftIndex: startIndex + index, right: line, rightIndex: startIndex + index })
      index += 1
      continue
    }
    const start = index
    const removed: Array<{ line: ParsedLine; index: number }> = []
    const added: Array<{ line: ParsedLine; index: number }> = []
    while (index < lines.length && lines[index].kind !== 'context') {
      if (lines[index].kind === 'remove') removed.push({ line: lines[index], index: startIndex + index })
      else added.push({ line: lines[index], index: startIndex + index })
      index += 1
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      rows.push({ gap: pair === 0 ? skipped[start] : 0, key: `${startIndex + start}-${pair}`, left: removed[pair]?.line, leftIndex: removed[pair]?.index, right: added[pair]?.line, rightIndex: added[pair]?.index })
    }
  }
  return rows
}

function SplitDiff({ activeSearchMatch, allowComments, lines, onComment, scrollRef, searchMatchIndices, searchTerm, selectedPosition, startIndex, tokens }: { activeSearchMatch: number; allowComments: boolean; lines: ParsedLine[]; onComment: (position: Position) => void; scrollRef: React.RefObject<HTMLDivElement | null>; searchMatchIndices: Set<number>; searchTerm: string; selectedPosition?: Position; startIndex: number; tokens: SyntaxToken[][] }) {
  const rows = useMemo(() => buildSplitRows(lines, startIndex), [lines, startIndex])
  const cell = (line: ParsedLine | undefined, side: 'old' | 'new', lineIndex: number | undefined) => {
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
      <span className="split-code" data-kind={kind} data-search-match={lineIndex !== undefined && searchMatchIndices.has(lineIndex) ? 'true' : undefined}>{line && lineIndex !== undefined ? renderCode(tokens[lineIndex - startIndex] ?? [{ text: line.text }], searchTerm) : ''}</span>
    </>
  }
  return (
    <Box ref={scrollRef} sx={(theme) => ({ ...diffBaseStyles(theme),
      '& .split-row': { display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) 54px minmax(0, 1fr)', minHeight: 22 },
      '& .split-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .split-row[data-search-active="true"]': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: -2 },
      '& mark': { backgroundColor: theme.palette.warning.light, color: theme.palette.warning.contrastText },
      '& .split-number': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.secondary, padding: '0 24px 0 4px', position: 'relative', textAlign: 'right', userSelect: 'none' },
      '& .split-number .diff-action': { right: '2px' },
      '& .split-number[data-side="new"]': { borderLeft: `1px solid ${theme.palette.divider}` },
      '& .split-code': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, overflowWrap: 'anywhere', padding: '0 10px 0 6px', whiteSpace: 'pre-wrap' },
      '& [data-kind="remove"]': { backgroundColor: theme.palette.diff?.deletedBackground },
      '& .split-number[data-kind="remove"]': { color: theme.palette.diff?.deletedText },
      '& [data-kind="add"]': { backgroundColor: theme.palette.diff?.addedBackground },
      '& .split-number[data-kind="add"]': { color: theme.palette.diff?.addedText },
      '& [data-kind="empty"]': { backgroundColor: theme.palette.action.hover },
      '& .split-row:hover .diff-action, & .split-row:focus-within .diff-action, & .split-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .diff-gap > span': { position: 'static' },
    })}>
      {rows.length === 0 ? <Typography color="text.secondary" sx={{ fontFamily: 'typography.fontFamily', p: 2 }} variant="body2">表示できる差分がありません。</Typography> : null}
      {rows.map((row) => {
        const selected = Boolean(selectedPosition && ((row.left && matchesPosition(row.left, selectedPosition)) || (row.right && matchesPosition(row.right, selectedPosition))))
        const activeSearch = row.leftIndex === activeSearchMatch || row.rightIndex === activeSearchMatch
        const hasSearchMatch = (row.leftIndex !== undefined && searchMatchIndices.has(row.leftIndex)) || (row.rightIndex !== undefined && searchMatchIndices.has(row.rightIndex))
        return <Fragment key={row.key}>
          {row.gap > 0 ? <div aria-hidden className="diff-gap"><span>⋯ 変更のない{row.gap}行</span></div> : null}
          <div className="split-row" data-line-id={selected && selectedPosition ? positionLineId(selectedPosition) : undefined} data-search-active={activeSearch ? 'true' : undefined} data-search-match={hasSearchMatch ? 'true' : undefined} data-selected={selected ? 'true' : undefined} data-testid="diff-split-row" tabIndex={selected ? -1 : undefined}>
            {cell(row.left, 'old', row.leftIndex)}
            {cell(row.right, 'new', row.rightIndex)}
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
    '& .diff-action': { alignItems: 'center', backgroundColor: theme.palette.primary.dark, border: 0, borderRadius: '4px', color: theme.palette.primary.contrastText, cursor: 'pointer', fontFamily: theme.typography.fontFamily, fontSize: 14, fontWeight: 700, height: 18, lineHeight: '18px', opacity: 0, padding: 0, position: 'absolute', right: '3px', textAlign: 'center', top: 2, width: 20 },
    '& .diff-action:hover': { backgroundColor: alpha(theme.palette.primary.dark, 0.85) },
    '& .diff-action:focus-visible': { opacity: 1, outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    ...syntaxStyles(theme),
    '& .diff-gap': { backgroundColor: theme.palette.action.hover, color: theme.palette.text.secondary, fontFamily: theme.typography.fontFamily, fontSize: theme.typography.caption.fontSize, padding: '2px 12px' },
  }
}

/** Colours for highlight.js token classes. */
function syntaxStyles(theme: Theme) {
  const syntax = theme.palette.syntax
  if (!syntax) return {}
  return {
    '& .hljs-keyword, & .hljs-doctag, & .hljs-template-tag, & .hljs-selector-tag': { color: syntax.keyword },
    '& .hljs-string, & .hljs-regexp, & .hljs-char': { color: syntax.string },
    '& .hljs-comment, & .hljs-quote': { color: syntax.comment, fontStyle: 'italic' },
    '& .hljs-number, & .hljs-literal, & .hljs-symbol, & .hljs-bullet, & .hljs-meta, & .hljs-link': { color: syntax.number },
    '& .hljs-title, & .hljs-section': { color: syntax.title },
    '& .hljs-type, & .hljs-built_in': { color: syntax.type },
    '& .hljs-attr, & .hljs-attribute, & .hljs-property, & .hljs-selector-attr, & .hljs-selector-class, & .hljs-selector-id': { color: syntax.attribute },
    '& .hljs-name, & .hljs-tag, & .hljs-selector-pseudo': { color: syntax.tag },
    '& .hljs-variable, & .hljs-template-variable': { color: syntax.variable },
  }
}

/**
 * Highlights a page of diff lines. Each side is highlighted as one text so
 * multi-line strings and comments keep their colour; context lines use the new side.
 */
function highlightDiffLines(lines: ParsedLine[], language: string | null): SyntaxToken[][] {
  const oldSide: number[] = []
  const newSide: number[] = []
  lines.forEach((line, index) => {
    if (line.kind !== 'add') oldSide.push(index)
    if (line.kind !== 'remove') newSide.push(index)
  })
  const result: SyntaxToken[][] = []
  const oldTokens = highlightLines(oldSide.map((index) => lines[index].text), language)
  oldSide.forEach((lineIndex, index) => { result[lineIndex] = oldTokens[index] })
  const newTokens = highlightLines(newSide.map((index) => lines[index].text), language)
  newSide.forEach((lineIndex, index) => { result[lineIndex] = newTokens[index] })
  return result
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

function FullFileView({ content, language, loading }: { content?: string | null; language: string | null; loading: boolean }) {
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

  const visibleLines = useMemo(() => lines.slice(offset, offset + FILE_PAGE_SIZE), [lines, offset])
  const visibleTokens = useMemo(() => highlightLines(visibleLines, language), [language, visibleLines])

  if (loading) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">ファイル全体を読み込み中…</Typography>
  if (content === null || content === undefined) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">ファイル全体は未取得です。ファイルを選び直して取得してください。</Typography>
  if (!content) return <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">空ファイルです。</Typography>
  return <>
    <PageControls offset={offset} pageSize={FILE_PAGE_SIZE} total={lines.length} onNext={() => updateOffset((current) => Math.min(current + FILE_PAGE_SIZE, Math.max(0, lines.length - 1)))} onPrevious={() => updateOffset((current) => Math.max(0, current - FILE_PAGE_SIZE))} />
    <Box data-testid="file-lines" sx={(theme) => ({ ...syntaxStyles(theme), maxHeight: DIFF_VIEWPORT_HEIGHT, overflow: 'auto', py: 0.5 })}>{visibleLines.map((line, index) => <Stack data-testid="file-line" direction="row" key={offset + index} sx={{ minHeight: 22 }}><Typography color="text.secondary" sx={{ borderRight: 1, borderColor: 'divider', flex: '0 0 52px', px: 1, textAlign: 'right', userSelect: 'none' }} variant="code">{offset + index + 1}</Typography><Typography component="span" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', px: 1, whiteSpace: 'pre' }} variant="code">{renderCode(visibleTokens[index] ?? [{ text: line }], '')}</Typography></Stack>)}</Box>
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

/** Renders highlighted tokens, marking case-insensitive matches of `query` across token boundaries. */
function renderCode(tokens: SyntaxToken[], query: string): React.ReactNode {
  const text = tokens.map((token) => token.text).join('')
  const matches: Array<[number, number]> = []
  if (query) {
    const normalizedText = text.toLocaleLowerCase()
    const normalizedQuery = query.toLocaleLowerCase()
    let match = normalizedText.indexOf(normalizedQuery)
    while (match >= 0) {
      matches.push([match, match + query.length])
      match = normalizedText.indexOf(normalizedQuery, match + query.length)
    }
  }
  if (matches.length === 0 && tokens.every((token) => !token.className)) return text
  let offset = 0
  return tokens.map((token, tokenIndex) => {
    const end = offset + token.text.length
    const parts: React.ReactNode[] = []
    let cursor = offset
    for (const [matchStart, matchEnd] of matches) {
      if (matchEnd <= cursor || matchStart >= end) continue
      if (matchStart > cursor) parts.push(text.slice(cursor, matchStart))
      const markEnd = Math.min(matchEnd, end)
      parts.push(<mark key={cursor}>{text.slice(Math.max(matchStart, cursor), markEnd)}</mark>)
      cursor = markEnd
    }
    if (cursor < end) parts.push(text.slice(cursor, end))
    offset = end
    return token.className ? <span className={token.className} key={tokenIndex}>{parts}</span> : <Fragment key={tokenIndex}>{parts}</Fragment>
  })
}

function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/')
  return index < 0 ? { directory: '', name: path } : { directory: path.slice(0, index), name: path.slice(index + 1) }
}
