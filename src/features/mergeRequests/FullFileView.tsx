import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { type Theme } from '@mui/material/styles'
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { hairline } from '../../components/hairline'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { Row } from '../../components/Row'
import { useT } from '../../i18n/useT'
import { isMarkdownFilePath } from '../../lib/markdownFiles'
import { highlightLines } from '../../lib/syntaxHighlight'
import { BlameCell } from './BlamePanel'
import { blameCellStyles } from './blameLines'
import { ChangeMarker } from './ChangeMarker'
import { changeMarkerStyles } from './changeMarkerStyles'
import { PageControls } from './DiffPageControls'
import { splitFileLines, type ParsedLine } from './diffParser'
import { FILE_PAGE_SIZE, firstVisibleFileLine, renderCode, scrollNearestBy, syntaxStyles } from './diffShared'
import { foldStyles, foldSummary, foldToggle } from './LineFold'
import { foldRanges, useLineFolds } from './lineFolds'
import { annotateFullFile, filePageStart, type FullFileDiffAnnotations, type RemovedFileLines } from './fullFileAnnotations'

// Rendered Markdown without diff marks still labels its blocks with their source lines, so switching views keeps the place.
const NO_FILE_ANNOTATIONS: FullFileDiffAnnotations = { addedLines: new Set(), consistent: true, removedByAnchor: new Map() }

function RemovedFullFileLines({ blameEnabled = false, item }: { blameEnabled?: boolean; item: RemovedFileLines }) {
  const t = useT()
  const label = item.oldStart === item.oldEnd ? String(item.oldStart) : t('review.lineRange', { start: String(item.oldStart), end: String(item.oldEnd) })
  const deletion = <Box aria-label={t('review.fullFile.removedLines', { lines: label })} data-file-anchor={item.anchorLine} data-testid="file-deletion" sx={(theme) => ({
    bgcolor: theme.palette.diff?.deletedBackground, ...hairline('left', { color: 'error.main', width: 3 }), flex: 1, minWidth: 0, my: 0.5, px: 1.5, py: 0.5,
  })}>
    <ChangeMarker firstLine={item.oldStart} kind="remove" lastLine={item.oldEnd} title={t('review.fullFile.removedTitle', { lines: label })} />
    <Typography component="pre" sx={{ fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', m: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.text}</Typography>
  </Box>
  // Keep the blame and line-number gutters continuous so removed code lines up with the file's code column.
  return blameEnabled
    ? <Row align="stretch"><span className="blame-cell" /><Box sx={{ ...hairline('right'), flex: `0 0 ${LINE_NUMBER_WIDTH}px` }} />{deletion}</Row>
    : deletion
}

/** The line number, then the fold toggle. */
const LINE_NUMBER_WIDTH = 68

export function FullFileView({ blameEnabled = false, content, diffLines, language, loading, path, targetLine, targetTop }: { blameEnabled?: boolean; content?: string | null; diffLines?: ParsedLine[]; language: string | null; loading: boolean; path?: string | null; targetLine?: number; /** Where on screen `targetLine` is put, as it was in the view switched from; centred without it. */ targetTop?: number }) {
  const t = useT()
  const lines = useMemo(() => content === null || content === undefined ? [] : splitFileLines(content), [content])
  const contentKey = content ?? '__missing__'
  const focus = targetLine ?? 0
  const markdown = isMarkdownFilePath(path)
  const annotations = useMemo(() => content !== null && content !== undefined && diffLines && diffLines.length ? annotateFullFile(diffLines, content) : null, [content, diffLines])
  const changeMarkers = annotations?.consistent ? annotations : null
  const firstOffset = targetLine ? filePageStart(targetLine, lines.length, FILE_PAGE_SIZE) : 0
  const [filePaging, setFilePaging] = useState({ contentKey: '', focus: 0, offset: 0 })
  const [showSource, setShowSource] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastPositioned = useRef<{ content: string | null | undefined; line: number; source: boolean } | null>(null)
  // The line shown at the top when the Markdown source/render toggle was used, kept at that place after the switch.
  const keepVisible = useRef<{ line: number; top: number } | null>(null)
  const offset = filePaging.contentKey === contentKey && filePaging.focus === focus ? filePaging.offset : firstOffset
  const updateOffset = (update: (current: number) => number): void => {
    setFilePaging((current) => {
      const currentOffset = current.contentKey === contentKey && current.focus === focus ? current.offset : firstOffset
      return { contentKey, focus, offset: update(currentOffset) }
    })
  }
  const nextPage = () => updateOffset((current) => Math.min(current + FILE_PAGE_SIZE, Math.max(0, lines.length - 1)))
  const previousPage = () => updateOffset((current) => Math.max(0, current - FILE_PAGE_SIZE))
  // Turning the page from below its last line starts reading the new page at its top.
  const turnPageFromBottom = (turn: () => void) => {
    turn()
    rootRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  }
  const visibleLines = useMemo(() => lines.slice(offset, offset + FILE_PAGE_SIZE), [lines, offset])
  const lineFoldRanges = useMemo(() => foldRanges(lines, markdown), [lines, markdown])
  const folds = useLineFolds(lineFoldRanges, `${path ?? ''}\0${contentKey}`, useMemo(() => targetLine ? [targetLine - 1] : [], [targetLine]))
  const visibleTokens = useMemo(() => markdown && !showSource ? [] : highlightLines(visibleLines, language), [language, markdown, showSource, visibleLines])

  useLayoutEffect(() => {
    const kept = keepVisible.current
    if (!kept || !rootRef.current) return
    keepVisible.current = null
    // Takes the place of the move to `targetLine` below, which would undo it.
    if (targetLine) lastPositioned.current = { content, line: targetLine, source: showSource }
    const target = nearestFileLine(rootRef.current, kept.line)
    if (target) scrollNearestBy(target, target.getBoundingClientRect().top - kept.top)
  }, [content, offset, showSource, targetLine])

  useLayoutEffect(() => {
    if (!content || !targetLine || !rootRef.current) return
    const previous = lastPositioned.current
    if (previous?.content === content && previous.line === targetLine && previous.source === showSource) return
    const candidates = Array.from(rootRef.current.querySelectorAll<HTMLElement>('[data-file-line], [data-file-anchor], [data-source-start]'))
    const rank = (element: HTMLElement): number => {
      const exactLine = Number(element.dataset.fileLine)
      const removalAnchor = Number(element.dataset.fileAnchor)
      if (exactLine === targetLine || removalAnchor === targetLine) return 0
      const start = Number(element.dataset.sourceStart)
      const end = Number(element.dataset.sourceEnd)
      if (start > 0 && end >= start && start <= targetLine && targetLine <= end) return (end - start + 1) / 1000
      const nearest = exactLine || removalAnchor || start
      return nearest > 0 ? 1 + Math.abs(nearest - targetLine) : Number.POSITIVE_INFINITY
    }
    const target = candidates.reduce<HTMLElement | null>((best, element) => !best || rank(element) < rank(best) ? element : best, null)
    if (target) {
      lastPositioned.current = { content, line: targetLine, source: showSource }
      if (targetTop !== undefined) scrollNearestBy(target, target.getBoundingClientRect().top - targetTop)
      else target.scrollIntoView?.({ behavior: 'auto', block: 'center' })
    }
  }, [content, markdown, offset, showSource, targetLine, targetTop])

  const toggleSource = () => {
    const root = rootRef.current
    const visible = root ? firstVisibleFileLine(root, Math.max(0, root.getBoundingClientRect().top)) : null
    keepVisible.current = visible
    // A rendered line past the shown page of source lines opens that page.
    if (visible && !showSource && (visible.line <= offset || visible.line > offset + FILE_PAGE_SIZE)) updateOffset(() => filePageStart(visible.line, lines.length, FILE_PAGE_SIZE))
    setShowSource(!showSource)
  }

  if (loading) return <Typography color="textSecondary" sx={{ p: 2 }} variant="body2">{t('review.fullFile.loading')}</Typography>
  if (content === null || content === undefined) return <Typography color="textSecondary" sx={{ p: 2 }} variant="body2">{t('review.fullFile.notLoaded')}</Typography>

  return <Box ref={rootRef} sx={blameEnabled ? (theme: Theme) => blameCellStyles(theme) : undefined}>
    {markdown ? <Box sx={{ ...hairline('bottom'), px: 1, py: 0.5 }}>
      <Button aria-label={showSource ? t('review.fullFile.renderMarkdown') : t('review.fullFile.showMarkdownSource')} onClick={toggleSource} size="small" variant="outlined">{showSource ? t('review.fullFile.markdown') : t('review.fullFile.source')}</Button>
    </Box> : null}
    {annotations && !annotations.consistent ? <Typography color="warning.main" role="status" sx={{ px: 1.5, py: 1 }} variant="caption">{t('review.fullFile.inconsistent')}</Typography> : null}
    {!content ? <Typography color="textSecondary" sx={{ p: 2 }} variant="body2">{t('review.fullFile.empty')}</Typography>
      : markdown && !showSource ? <Box aria-label={t('review.fullFile.markdownPreview')} sx={(theme) => ({
          minWidth: 0, pl: 4, pr: 2, py: 1.5,
          '& [data-review-change="add"]': { backgroundColor: theme.palette.diff?.addedBackground, boxShadow: `inset 3px 0 0 ${theme.palette.success.main}`, borderRadius: 1, px: 0.5 },
          '& [data-review-deleted="true"]': { backgroundColor: theme.palette.diff?.deletedBackground, ...hairline('left', { color: 'error.main', width: 3 }), my: 1, px: 1.5, py: 1 },
          '& [data-review-marker="remove"]': changeMarkerStyles(theme, 'remove'),
          '& [data-review-deleted="true"] pre': { fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', mb: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
        })}><MockMarkdown body={content} renderBlame={blameEnabled ? (line) => <BlameCell line={line} side="new" /> : undefined} review={changeMarkers ?? NO_FILE_ANNOTATIONS} size="body1" /></Box>
        : <>
          <PageControls offset={offset} pageSize={FILE_PAGE_SIZE} total={lines.length} onNext={nextPage} onPrevious={previousPage} />
          <Box data-testid="file-lines" sx={(theme) => ({ ...syntaxStyles(theme), ...foldStyles(theme, '2px'), py: 0.5 })}>{visibleLines.map((line, index) => {
            const fileLine = offset + index + 1
            if (folds.hidden.has(fileLine - 1)) return null
            const additions = changeMarkers?.addedLines.has(fileLine)
            return <Fragment key={fileLine}>
              {(changeMarkers?.removedByAnchor.get(fileLine) ?? []).map((item, removedIndex) => <RemovedFullFileLines blameEnabled={blameEnabled} item={item} key={`${item.oldStart}:${removedIndex}`} />)}
              <Row data-change={additions ? 'add' : undefined} data-file-line={fileLine} data-testid="file-line" align="stretch" sx={(theme) => ({
                backgroundColor: additions ? theme.palette.diff?.addedBackground : undefined,
                boxShadow: additions ? `inset 3px 0 0 ${theme.palette.success.main}` : undefined, minHeight: 20,
              })}>{blameEnabled ? <BlameCell line={fileLine} side="new" /> : null}<Typography color="textSecondary" sx={{ ...hairline('right'), flex: `0 0 ${LINE_NUMBER_WIDTH}px`, pl: 1, position: 'relative', pr: '20px', textAlign: 'right', userSelect: 'none' }} variant="code">{fileLine}{foldToggle(fileLine - 1, folds)}</Typography><Typography component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', px: 1, whiteSpace: 'pre-wrap' }} variant="code">{renderCode(visibleTokens[index] ?? [{ text: line }], '')}{foldSummary(fileLine - 1, folds)}</Typography></Row>
            </Fragment>
          })}
          {offset + visibleLines.length >= lines.length ? (changeMarkers?.removedByAnchor.get(lines.length + 1) ?? []).map((item, index) => <RemovedFullFileLines blameEnabled={blameEnabled} item={item} key={`last:${item.oldStart}:${index}`} />) : null}
          </Box>
          <PageControls offset={offset} pageSize={FILE_PAGE_SIZE} total={lines.length} onNext={() => turnPageFromBottom(nextPage)} onPrevious={() => turnPageFromBottom(previousPage)} />
        </>}
  </Box>
}

/** The whole-file line, or the rendered block holding it, closest to `line`. */
function nearestFileLine(root: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestSpan = Number.POSITIVE_INFINITY
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-file-line], [data-source-start]'))) {
    const start = Number(node.dataset.fileLine ?? node.dataset.sourceStart)
    const end = Number(node.dataset.fileLine ?? node.dataset.sourceEnd) || start
    const distance = line < start ? start - line : line > end ? line - end : 0
    // The innermost rendered block holding the line, not the list or quote around it.
    if (distance < bestDistance || (distance === bestDistance && end - start < bestSpan)) { best = node; bestDistance = distance; bestSpan = end - start }
  }
  return best
}
