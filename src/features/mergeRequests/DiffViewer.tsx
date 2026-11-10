import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import VerticalSplitOutlinedIcon from '@mui/icons-material/VerticalSplitOutlined'
import WrapTextRoundedIcon from '@mui/icons-material/WrapTextRounded'
import ViewStreamOutlinedIcon from '@mui/icons-material/ViewStreamOutlined'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined'
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined'
import TocRoundedIcon from '@mui/icons-material/TocRounded'
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded'
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded'
import type { Theme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import InputAdornment from '@mui/material/InputAdornment'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { gridLine } from '../../theme'
import type { Diff, Discussion, Draft, FileQuery, Position } from '../../types/gitlab'
import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { ColumnResizeHandle } from './ColumnResizeHandle'
import { DiffFileTree, FileThreadMark } from './DiffFileTree'
import { FILE_LIST_MODE_KEY, readFileListMode, splitPath, type FileListMode } from './diffFileOrder'
import { matchesFilePath } from './filePathSearch'
import type { GapExpansion } from './DiffGap'
import { SplitDiff, UnifiedDiff, type LineSelection, type RowSelection } from './DiffRows'
import { DiffOutlineList } from './DiffOutlineList'
import { diffGaps } from './diffGaps'
import { lineHasThreads } from './diffLineThreads'
import { foldRanges, useLineFolds } from './lineFolds'
import { diffOutline, outlineEntryAt, type DiffOutline, type OutlineEntry } from './diffOutline'
import { firstVisibleFileLine, LineCounts, matchesPosition, positionLineId, scrollNearestBy } from './diffShared'
import { FullFileView } from './FullFileView'
import { PathTooltip } from './PathTooltip'
import { useDiffTokens } from './useDiffTokens'
import { BlameProvider } from './BlamePanel'
import type { HistoryCursor } from './lineHistory'
import { LineHistoryView } from './LineHistoryView'
import { FetchedMarkdownDiffPreview, MarkdownDiffPreview } from './MarkdownDiffPreview'
import { isEditableTarget, isInsideControlGroup, isInsideMenu } from '../../lib/eventTargets'
import { isMarkdownFilePath } from '../../lib/markdownFiles'
import { markdownDiffNeedsFile } from './markdownDiff'
import { firstChangedFileLine } from './fullFileAnnotations'
import type { ThreadActions } from './DiffThreads'
import { fileRowLabel, fileRowNotes, lineKey, pendingDraftsByLine, threadCountsByFile, threadsByLine, type FileThreadCount } from './diffLineThreads'
import { languageForPath } from '../../lib/syntaxHighlight'
import { countDiffLines, ignoreWhitespace as ignoreWhitespaceChanges, parseDiff, type DiffHunk, type DiffLineCounts, type ParsedDiff, type ParsedLine } from './diffParser'
import { canReadOmittedDiff, isDiffOmitted, OmittedDiffReader, type OmittedDiffRead } from './omittedDiff'
import { positionLines } from './diffLineThreads'
import type { SuggestionActions } from './SuggestionBlock'
import { positionIndexRange, rangePosition } from './suggestions'
import { useReviewedFiles, type ReviewedFileContext } from './useReviewedFiles'
import { useT } from '../../i18n/useT'
import { useStableCallback } from '../shared/useStableCallback'
import { Row } from '../../components/Row'

/** Keep the file list and code inside the window so long diffs scroll in place. */
/** Below the MR header, which stays at the top of the detail while it scrolls. */
const BELOW_DETAIL_HEADER = 'calc(var(--detail-header-height, 0px) + 8px)'
const EMPTY_PARSED_DIFF: ParsedDiff = { lines: [], status: 'valid' }
/** Over the whole window and its own scroll, with the same elements, so open comment editors and opened lines stay as they are. */
const MAXIMIZED_SX = { '--detail-header-height': '0px', bgcolor: 'background.default', inset: 0, overflowX: 'hidden', overflowY: 'auto', p: 1, position: 'fixed', zIndex: (theme: Theme) => theme.zIndex.drawer + 1 }
const READER_MOVES = ['wheel', 'pointerdown', 'keydown'] as const

interface DiffViewerProps {
  allowComments?: boolean
  /** Whether the whole-file view can be chosen; without a readable file source it is hidden. */
  allowFileView?: boolean
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
  /** Line comments to show under their lines, as on GitLab. Only threads on `discussionHeadSha` are placed. */
  discussions?: Discussion[]
  discussionHeadSha?: string
  /** Older discussions exist that are not loaded, so some line comments may be missing. */
  discussionsIncomplete?: boolean
  onOpenDiscussion?: (discussionId: string) => void
  /** Unpublished line comments of the pending review, shown under their lines. */
  pendingDrafts?: Draft[]
  /** A comment editor shown right under the line it comments on, as on GitLab. */
  lineComposer?: { position: Position; node: React.ReactNode }
  /** Replying to and resolving the threads shown in the diff. */
  threadActions?: ThreadActions
  /**
   * Where the shown version of the files is read (MR head or the selected
   * commit), to open unchanged lines between hunks. Without it they open only
   * from `fileContent`.
   */
  fileSource?: { sessionId: string; projectId: string; sha: string; beforeSha?: string; /** The MR's; line history reads commit diffs through it. */ iid?: string; /** The project's GitLab page, for opening a commit there. */ projectUrl?: string }
  /** Applying the suggestions in the threads shown under the lines. */
  suggestionActions?: SuggestionActions
}

export function DiffViewer({ allowComments = true, allowFileView = true, diffs, discussionHeadSha, discussions, discussionsIncomplete = false, fileContent, fileLoading = false, fileSource, lineComposer, onComment, pendingDrafts, threadActions, onOpenDiscussion, onSelectFile, onViewChange, reviewContext, selectedFile, selectedPosition, suggestionActions, view }: DiffViewerProps) {
  const t = useT()
  const selectedDiffIndex = diffs.findIndex((diff) => (diff.newPath || diff.oldPath) === selectedFile)
  const displayedIndex = selectedDiffIndex >= 0 ? selectedDiffIndex : diffs.length > 0 ? 0 : -1
  const selectedDiff = displayedIndex >= 0 ? diffs[displayedIndex] : undefined
  const displayedPath = selectedDiff ? selectedDiff.newPath || selectedDiff.oldPath : null
  /** The line the whole file opens on, and where the diff showed it on screen when it was measured there. */
  const [fileAnchor, setFileAnchor] = useState<{ path: string; line: number; top?: number } | null>(null)
  /** The line to show after returning to the diff, and where it was on screen when measured. */
  const restoreDiffAnchor = useRef<{ path: string; line: number; top?: number } | null>(null)
  // A file GitLab left the diff of out is compared here from its two versions. It stays read-only: GitLab has not stored these lines.
  const omittedKey = selectedDiff && isDiffOmitted(selectedDiff) && canReadOmittedDiff(selectedDiff, fileSource) ? `${fileSource?.sessionId}\0${fileSource?.projectId}\0${fileSource?.beforeSha ?? ''}\0${fileSource?.sha}\0${selectedDiff.oldPath}\0${selectedDiff.newPath}` : null
  const [omittedRead, setOmittedRead] = useState<{ key: string; read: OmittedDiffRead } | null>(null)
  const omitted: OmittedDiffRead | null = omittedKey ? omittedRead?.key === omittedKey ? omittedRead.read : { status: 'loading' } : null
  const reportOmitted = useCallback((read: OmittedDiffRead) => { if (omittedKey) setOmittedRead({ key: omittedKey, read }) }, [omittedKey])
  const comparedDiff = omitted?.status === 'ready' ? omitted.diff : null
  const parsed = useMemo(() => selectedDiff ? parseDiff(comparedDiff ?? selectedDiff.diff, selectedDiff.oldPath, selectedDiff.newPath) : EMPTY_PARSED_DIFF, [comparedDiff, selectedDiff])
  const [blameOpen, setBlameOpen] = useState(false)
  /** The lines whose history replaces the diff, for the file it was opened from. */
  const [history, setHistory] = useState<{ path: string; start: HistoryCursor } | null>(null)
  const historyStart = history && history.path === displayedPath ? history.start : null
  /** Where the page was scrolled when the history replaced the file, put back when it closes. */
  const historyScroll = useRef<{ element: HTMLElement; top: number } | null>(null)
  const openHistory = fileSource && displayedPath ? (start: HistoryCursor) => {
    const element = scrollParentOf(fileTopRef.current)
    historyScroll.current = { element, top: element.scrollTop }
    setHistory({ path: displayedPath, start })
    // The history opens at the top of the file panel, as the diff did.
    if (fileTopRef.current && fileTopRef.current.getBoundingClientRect().top < 0) fileTopRef.current.scrollIntoView({ block: 'start' })
  } : undefined
  const closeHistory = () => setHistory(null)
  // Diff-only controls keep their place in the whole-file view, so the header does not rewrap and move the content and the view switch under the pointer.
  const diffOnlySx = view === 'diff' ? undefined : { visibility: 'hidden' } as const
  const canBlame = Boolean(fileSource && displayedPath && selectedDiff && !selectedDiff.collapsed && !selectedDiff.tooLarge && (!selectedDiff.deletedFile || fileSource?.beforeSha))
  // GitLab's diff API has no whitespace option, so whitespace-only changes are folded here.
  const [whitespaceIgnored, setWhitespaceIgnored] = useState(readIgnoreWhitespace)
  const toggleWhitespace = () => {
    setWhitespaceIgnored(!whitespaceIgnored)
    saveIgnoreWhitespace(!whitespaceIgnored)
  }
  const [wrapLines, setWrapLines] = useState(readWrapLines)
  const toggleWrapLines = () => {
    setWrapLines(!wrapLines)
    saveWrapLines(!wrapLines)
  }
  // Counted as the rows show them, so the totals agree with the file on screen; null where GitLab left the diff out.
  const fileLineCounts = useMemo(() => new Map(diffs.map((diff) => [diff.newPath || diff.oldPath, isDiffOmitted(diff) ? null : whitespaceIgnored ? linesCounted(ignoreWhitespaceChanges(parseDiff(diff.diff, diff.oldPath, diff.newPath).lines).lines) : countDiffLines(diff.diff)])), [diffs, whitespaceIgnored])
  const lineTotals = useMemo(() => {
    const totals = { added: 0, removed: 0, uncounted: 0 }
    for (const counts of fileLineCounts.values()) {
      if (!counts) totals.uncounted += 1
      else {
        totals.added += counts.added
        totals.removed += counts.removed
      }
    }
    return totals
  }, [fileLineCounts])
  const folded = useMemo(() => whitespaceIgnored ? ignoreWhitespaceChanges(parsed.lines) : null, [parsed, whitespaceIgnored])
  const displayLines = folded?.lines ?? parsed.lines
  const whitespaceOnlyFile = Boolean(folded && !folded.changed && parsed.lines.some((line) => line.kind !== 'context'))
  const diffKey = selectedDiff ? `${displayedPath}\0${comparedDiff ?? selectedDiff.diff}\0${whitespaceIgnored}` : ''
  const markdownDiff = Boolean(displayedPath && isMarkdownFilePath(displayedPath))
  const [markdownMode, setMarkdownMode] = useState<{ key: string; mode: 'preview' | 'source' } | null>(null)
  const [diffSearch, setDiffSearch] = useState('')
  const positionKey = selectedPosition ? `${selectedPosition.newPath}:${selectedPosition.oldPath}:${selectedPosition.oldLine ?? ''}:${selectedPosition.newLine ?? ''}` : ''
  const markdownModeKey = `${diffKey}\0${positionKey}`
  const commentTargetsFile = Boolean(selectedPosition && displayedPath && (selectedPosition.newPath === displayedPath || selectedPosition.oldPath === displayedPath))
  // An incoming line-comment link opens the source diff; normal Markdown files
  // open a rendered, change-only preview. Explicit mode choices take precedence.
  const renderedMarkdownDiff = markdownDiff && parsed.status === 'valid' && !diffSearch.trim()
    && (markdownMode?.key === markdownModeKey ? markdownMode.mode === 'preview' : !commentTargetsFile)
  const selectedLineIndex = useMemo(() => parsed.status === 'valid' && selectedPosition ? displayLines.findIndex((line) => matchesPosition(line, selectedPosition)) : -1, [displayLines, parsed.status, selectedPosition])
  const [fileSearch, setFileSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState<{ query: string; path: string; lineIndex: number } | null>(null)
  // Parse and lowercase the whole page only while searching, and only once per
  // page of diffs rather than on every keystroke.
  const searching = Boolean(diffSearch.trim())
  const searchableLines = useMemo(() => searching
    ? diffs.map((diff) => {
      const lines = parseDiff(diff.diff, diff.oldPath, diff.newPath).lines
      return (whitespaceIgnored ? ignoreWhitespaceChanges(lines).lines : lines).map((line) => line.text.toLocaleLowerCase())
    })
    : [], [diffs, searching, whitespaceIgnored])
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
  const diffScrollRef = useRef<HTMLDivElement | null>(null)
  const reviewState = useReviewedFiles(reviewContext, diffs)
  const fileSearchMatches = useMemo(() => {
    const query = fileSearch.trim().toLocaleLowerCase()
    return diffs.map((diff, index) => ({ diff, index, path: diff.newPath || diff.oldPath }))
      .filter(({ path }) => matchesFilePath(path, query))
  }, [diffs, fileSearch])
  const displayedFileMatchIndex = fileSearchMatches.findIndex(({ path }) => path === displayedPath)
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout)
  const [fileListMode, setFileListMode] = useState<FileListMode>(readFileListMode)
  const changeFileListMode = (next: FileListMode) => {
    setFileListMode(next)
    try { globalThis.localStorage?.setItem(FILE_LIST_MODE_KEY, next) } catch { /* The choice still applies until the viewer is reopened. */ }
  }
  const changeLayout = (next: DiffLayout) => {
    setLayout(next)
    saveDiffLayout(next)
  }
  const language = displayedPath ? languageForPath(displayedPath) : null
  const rowTokens = useDiffTokens(displayLines, language, !renderedMarkdownDiff)
  const pageSearchMatches = useMemo(() => new Set(searchMatches.filter((match) => match.path === displayedPath).map((match) => match.lineIndex)), [displayedPath, searchMatches])
  const lineCounts = useMemo(() => linesCounted(displayLines), [displayLines])
  const commentable = allowComments && !selectedDiff?.collapsed && !selectedDiff?.tooLarge && parsed.status === 'valid'
  // Folded whitespace changes move lines, so new line comments wait until whitespace is shown again.
  const commentsEnabled = commentable && !whitespaceIgnored
  const lineThreads = useMemo(() => threadsByLine(discussions, selectedDiff, discussionHeadSha), [discussionHeadSha, discussions, selectedDiff])
  const composer = useMemo(() => commentsEnabled && lineComposer ? { key: lineKey(lineComposer.position), node: lineComposer.node, position: lineComposer.position } : undefined, [commentsEnabled, lineComposer])
  const draftsByLine = useMemo(() => pendingDraftsByLine(pendingDrafts, selectedDiff, discussionHeadSha), [discussionHeadSha, pendingDrafts, selectedDiff])
  const threadSessionId = fileSource?.sessionId
  const [maximized, setMaximized] = useState(false)
  // A discussion opens in the tab under the maximized diff.
  const openDiscussion = useMemo(() => onOpenDiscussion && ((id: string) => { setMaximized(false); onOpenDiscussion(id) }), [onOpenDiscussion])
  const threadView = useMemo(() => (discussions || composer || draftsByLine.size) && parsed.status === 'valid' ? { actions: threadActions, composer, drafts: draftsByLine, onOpen: openDiscussion, sessionId: threadSessionId, suggestionActions, threads: lineThreads.byLine } : undefined, [composer, discussions, draftsByLine, lineThreads.byLine, openDiscussion, parsed.status, suggestionActions, threadActions, threadSessionId])

  // Lines chosen for a comment: the open editor's lines, or a range being chosen
  // with Shift+click, Shift+↑/↓ on the 「+」 buttons, or by dragging over the gutter.
  const hunks = parsed.hunks ?? NO_HUNKS
  const [lineChoice, setLineChoice] = useState<{ diffKey: string; anchor: number; focus: number | null } | null>(null)
  const choice = lineChoice?.diffKey === diffKey ? lineChoice : null
  const composerPosition = composer && selectedDiff && (composer.position.newPath === selectedDiff.newPath || composer.position.oldPath === selectedDiff.oldPath) ? composer.position : undefined
  const composerRange = useMemo(() => composerPosition ? positionIndexRange(displayLines, composerPosition) : null, [composerPosition, displayLines])
  const chosenRange: [number, number] | null = choice && choice.focus !== null ? [Math.min(choice.anchor, choice.focus), Math.max(choice.anchor, choice.focus)] : composerRange
  const sameHunk = (first: number, second: number) => {
    const left = displayLines[first]
    const right = displayLines[second]
    return Boolean(left?.commentable && right?.commentable && left.hunk !== undefined && left.hunk === right.hunk)
  }
  const commentOnLines = (first: number, second: number) => {
    const position = rangePosition(displayLines, hunks, Math.min(first, second), Math.max(first, second))
    if (position) onComment(position)
  }
  const dragStart = useRef<number | null>(null)
  const focusAfterRender = useRef<number | null>(null)
  const latestChoice = useRef({ choice, commentOnLines, diffKey })
  useLayoutEffect(() => { latestChoice.current = { choice, commentOnLines, diffKey } })
  useLayoutEffect(() => {
    const target = focusAfterRender.current
    if (target === null) return
    focusAfterRender.current = null
    diffScrollRef.current?.querySelector<HTMLElement>(`[data-line-action="${target}"]`)?.focus()
  })
  useEffect(() => {
    // A drag over several lines comments on them when the button is released.
    const finishDrag = () => {
      const start = dragStart.current
      dragStart.current = null
      const { choice: current, commentOnLines: comment, diffKey: key } = latestChoice.current
      if (start === null || !current || current.anchor !== start || current.focus === null || current.focus === start) return
      setLineChoice({ anchor: start, diffKey: key, focus: null })
      comment(start, current.focus)
    }
    window.addEventListener('mouseup', finishDrag)
    return () => window.removeEventListener('mouseup', finishDrag)
  }, [])
  const lineSelection: LineSelection = {
    isChosen: (index) => chosenRange !== null && index >= chosenRange[0] && index <= chosenRange[1],
    onAction: (index, event) => {
      // Enter on the last line of a range chosen with Shift+↑/↓ comments on the range.
      if (choice && choice.focus === index && choice.anchor !== index && sameHunk(choice.anchor, index)) {
        setLineChoice({ anchor: choice.anchor, diffKey, focus: null })
        commentOnLines(choice.anchor, index)
        return
      }
      const anchor = event.shiftKey ? choice?.anchor ?? composerRange?.[1] : undefined
      if (anchor !== undefined && anchor !== index && sameHunk(anchor, index)) {
        setLineChoice({ anchor, diffKey, focus: null })
        commentOnLines(anchor, index)
        return
      }
      setLineChoice({ anchor: index, diffKey, focus: null })
      commentOnLines(index, index)
    },
    onDragStart: (index, event) => {
      if (event.button !== 0 || event.shiftKey) return
      // Dragging over the gutter must not select the code text.
      event.preventDefault()
      dragStart.current = index
    },
    onDragOver: (index) => {
      const start = dragStart.current
      if (start === null || !sameHunk(start, index)) return
      if (choice?.anchor !== start || choice.focus !== index) setLineChoice({ anchor: start, diffKey, focus: index })
    },
    onKeyDown: (index, event) => {
      if (event.key === 'Escape' && choice?.focus != null) {
        event.preventDefault()
        event.stopPropagation()
        setLineChoice({ anchor: choice.anchor, diffKey, focus: null })
        return
      }
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const anchor = choice && choice.focus === index ? choice.anchor : index
      const next = index + (event.key === 'ArrowUp' ? -1 : 1)
      if (!sameHunk(anchor, next)) return
      setLineChoice({ anchor, diffKey, focus: next === anchor ? null : next })
      focusAfterRender.current = next
    },
  }
  // The rows get handlers of one identity that run the latest choice, so a piece of rows renders again only for what it shows.
  const onLineAction = useStableCallback(lineSelection.onAction)
  const onLineDragStart = useStableCallback(lineSelection.onDragStart)
  const onLineDragOver = useStableCallback(lineSelection.onDragOver)
  const onLineKeyDown = useStableCallback(lineSelection.onKeyDown)
  const rowSelection = useMemo<RowSelection>(() => ({ onAction: onLineAction, onDragOver: onLineDragOver, onDragStart: onLineDragStart, onKeyDown: onLineKeyDown }), [onLineAction, onLineDragOver, onLineDragStart, onLineKeyDown])
  const pendingRangeLabel = choice && choice.focus !== null ? rangePosition(displayLines, hunks, Math.min(choice.anchor, choice.focus), Math.max(choice.anchor, choice.focus)) : undefined
  const threadCounts = useMemo(() => threadCountsByFile(discussions, diffs), [diffs, discussions])
  // The file list renders again only when what it shows changes, not for every render of the diff.
  const threadCount = useCallback((path: string) => threadCounts.get(path), [threadCounts])
  const { reviewedPaths } = reviewState
  const isReviewed = useCallback((path: string) => reviewedPaths.has(path), [reviewedPaths])
  const selectFile = useStableCallback(onSelectFile)
  const reviewedCount = reviewState.reviewedPaths.size

  // Unchanged lines between hunks open from the shown version of the file.
  const [shownGaps, setShownGaps] = useState<{ diffKey: string; shown: ReadonlyMap<string, number> }>({ diffKey: '', shown: NO_SHOWN_GAPS })
  const sourceSessionId = fileSource?.sessionId
  const sourceProjectId = fileSource?.projectId
  const sourceSha = fileSource?.sha
  // Relative images in rendered Markdown are read from the shown version.
  const markdownRepository = useMemo(() => sourceProjectId && sourceSha && displayedPath ? { projectId: sourceProjectId, path: displayedPath, ref: sourceSha } : undefined, [displayedPath, sourceProjectId, sourceSha])
  // The same query as the whole-file view, so both share one cached read.
  const gapQuery = useMemo<FileQuery | null>(() => sourceProjectId && sourceSha && displayedPath ? { kind: 'file', path: displayedPath, projectId: sourceProjectId, sha: sourceSha } : null, [displayedPath, sourceProjectId, sourceSha])
  const gapsExpandable = Boolean(selectedDiff && !selectedDiff.deletedFile && (comparedDiff !== null || (!selectedDiff.collapsed && !selectedDiff.tooLarge)) && parsed.status === 'valid')
  const expandGap = useCallback((key: string, shown: number) => setShownGaps((current) => ({ diffKey, shown: new Map(current.diffKey === diffKey ? current.shown : []).set(key, shown) })), [diffKey])
  const gapShown = shownGaps.diffKey === diffKey ? shownGaps.shown : NO_SHOWN_GAPS
  const gapReadable = Boolean(gapQuery && sourceSessionId)
  const gapExpansion = useMemo<GapExpansion | undefined>(() => gapsExpandable && (gapReadable || typeof fileContent === 'string') ? {
    content: gapReadable ? undefined : fileContent ?? undefined,
    language,
    onExpand: expandGap,
    query: gapQuery,
    sessionId: sourceSessionId,
    shown: gapShown,
  } : undefined, [expandGap, fileContent, gapQuery, gapReadable, gapShown, gapsExpandable, language, sourceSessionId])
  // A rendered Markdown edit reads the lines before it (a table header, an open fence) from the whole new file,
  // which is read only when the diff does not show them.
  const markdownSource = useMemo(() => parsed.status === 'valid' ? { content: fileContent, diffLines: parsed.lines } : undefined, [fileContent, parsed])
  const markdownNeedsFile = useMemo(() => renderedMarkdownDiff && parsed.status === 'valid' && typeof fileContent !== 'string' && markdownDiffNeedsFile(displayLines, parsed.lines), [displayLines, fileContent, parsed, renderedMarkdownDiff])

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

  // The file tree takes its width plus the 12px gap beside it; it shows only when the diff keeps enough room beside it at the default width,
  // more for the side-by-side layout, and the reader can hide it. A wider choice gives way to the diff when the pane narrows.
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  const [treeHidden, setTreeHidden] = useState(readTreeHidden)
  const diffRoom = view === 'diff' && layout === 'split' ? 848 : 568
  const treeFits = width >= DEFAULT_TREE_WIDTH + 12 + diffRoom
  const treeShown = treeFits && !treeHidden
  const [treeWidth, setTreeWidth] = useState(readTreeWidth)
  const treeWidthLimit = Math.min(MAX_TREE_WIDTH, Math.max(DEFAULT_TREE_WIDTH, width - 12 - diffRoom))
  const shownTreeWidth = Math.min(treeWidth, treeWidthLimit)
  const treeRef = useRef<HTMLDivElement>(null)
  const commitTreeWidth = (next: number) => {
    setTreeWidth(next)
    // The drag set the style itself; this render may give the same width and so leave it alone.
    if (treeRef.current) treeRef.current.style.flexBasis = `${next}px`
    try { globalThis.localStorage?.setItem(TREE_WIDTH_KEY, String(next)) } catch { /* The choice still applies until the viewer is reopened. */ }
  }
  // Where the tree does not fit beside the diff, the same button opens it over the diff.
  const [treeButton, setTreeButton] = useState<HTMLElement | null>(null)
  const treePopoverOpen = !treeFits && treeButton !== null
  const selectFileInPopover = useStableCallback((path: string) => {
    setTreeButton(null)
    onSelectFile(path)
  })
  const toggleTree = (event: React.MouseEvent<HTMLElement>) => {
    if (!treeFits) { setTreeButton(event.currentTarget); return }
    setTreeHidden(treeShown)
    try { globalThis.localStorage?.setItem(TREE_HIDDEN_KEY, String(treeShown)) } catch { /* The choice still applies until the viewer is reopened. */ }
  }
  // Beside the tree the field only filters it, so it needs no buttons to step through matches.
  const fileSearchField = (inTree: boolean) => <TextField
              fullWidth
              onChange={(event) => setFileSearch(event.target.value)}
              placeholder={inTree ? t('review.fileTree.filter') : t('review.fileTree.search')}
              size="dense"
              value={fileSearch}
              slotProps={{ htmlInput: { 'aria-label': t('review.fileTree.search') }, input: { endAdornment: inTree ? undefined : <InputAdornment position="end"><Typography aria-live="polite" color="textSecondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{fileSearch.trim() ? `${displayedFileMatchIndex >= 0 ? displayedFileMatchIndex + 1 : 0}/${fileSearchMatches.length}` : ''}</Typography><Tooltip title={t('review.fileTree.previousMatch')}><span><IconButton aria-label={t('review.fileTree.previousMatch')} disabled={!fileSearch.trim() || fileSearchMatches.length === 0} onClick={() => navigateFileSearch(-1)} size="small"><KeyboardArrowUpRoundedIcon /></IconButton></span></Tooltip><Tooltip title={t('review.fileTree.nextMatch')}><span><IconButton aria-label={t('review.fileTree.nextMatch')} disabled={!fileSearch.trim() || fileSearchMatches.length === 0} onClick={() => navigateFileSearch(1)} size="small"><KeyboardArrowDownRoundedIcon /></IconButton></span></Tooltip></InputAdornment> } }}
            />

  // The table of contents takes 220px plus the 12px gap beside the diff, and shows beside it only when the code keeps a readable width.
  // Otherwise the same list opens from the button in the file heading.
  const [outlineHidden, setOutlineHidden] = useState(readOutlineHidden)
  const [outlineButton, setOutlineButton] = useState<HTMLElement | null>(null)
  const outlineAvailable = view === 'diff' && !historyStart && parsed.status === 'valid' && displayLines.length > 0
  const outlineFits = width - (treeShown ? shownTreeWidth + 12 : 0) - 232 >= (layout === 'split' ? 848 : 720)
  const outlineShown = outlineAvailable && outlineFits && !outlineHidden
  const outlinePopoverOpen = outlineAvailable && !outlineFits && outlineButton !== null
  const outline = useMemo(() => outlineShown || outlinePopoverOpen ? diffOutline(displayLines, hunks, markdownDiff) : NO_OUTLINE, [displayLines, hunks, markdownDiff, outlinePopoverOpen, outlineShown])
  const [outlineTarget, setOutlineTarget] = useState<{ diffKey: string; entry: OutlineEntry } | null>(null)
  const shownOutlineTarget = outlineTarget?.diffKey === diffKey ? outlineTarget.entry : null
  const selectOutlineEntry = useStableCallback((entry: OutlineEntry) => {
    setOutlineTarget({ diffKey, entry })
    setOutlineButton(null)
  })
  const toggleOutline = (event: React.MouseEvent<HTMLElement>) => {
    if (!outlineFits) { setOutlineButton(event.currentTarget); return }
    setOutlineHidden(outlineShown)
    try { globalThis.localStorage?.setItem(OUTLINE_HIDDEN_KEY, String(outlineShown)) } catch { /* The choice still applies until the viewer is reopened. */ }
  }
  useLayoutEffect(() => {
    if (!outlineTarget || outlineTarget.diffKey !== diffKey) return
    const { entry } = outlineTarget
    const root = fileTopRef.current
    const target = renderedMarkdownDiff
      ? markdownBlockFor(Array.from(root?.querySelectorAll<HTMLElement>('[data-file-anchor]') ?? []), entry.anchorLine)
      : root?.querySelector(`[data-line-index="${entry.lineIndex}"]`)?.closest('.diff-row, .split-row')
    target?.scrollIntoView?.({ behavior: 'auto', block: 'start', inline: 'nearest' })
    // Only for this choice of an entry, not for later changes of the file shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineTarget])
  /** The entry at the top of the view, read from what is on screen at that point: one lookup per frame, however long the file is. */
  const locateOutlineEntry = useStableCallback((): number | null => {
    const panel = fileTopRef.current?.getBoundingClientRect()
    const header = fileHeaderRef.current?.getBoundingClientRect()
    if (!panel || !header) return null
    // Above the first line, as at the top of the page, the search field is at the point rather than a line.
    // The piece, not its first row: a row in a piece off screen has no layout to read, and asking would force one on every frame.
    const start = fileTopRef.current?.querySelector('.diff-chunk, [data-file-anchor]')
    if (start && start.getBoundingClientRect().top > header.bottom) return 0
    // All the elements at the point, as the popover's backdrop lies over the diff while it is open.
    const shown = document.elementsFromPoint?.(panel.left + panel.width / 2, header.bottom + 1) ?? []
    const nearest = (selector: string) => shown.map((node) => node.closest<HTMLElement>(selector)).find(Boolean)
    if (renderedMarkdownDiff) {
      const line = Number(nearest('[data-file-anchor]')?.dataset.fileAnchor)
      return Number.isSafeInteger(line) ? outlineEntryAt(outline.entries, line, 'anchorLine') : null
    }
    const row = nearest('.diff-row, .split-row')
    const index = Number((row?.dataset.lineIndex ? row : row?.querySelector<HTMLElement>('[data-line-index]'))?.dataset.lineIndex)
    return Number.isSafeInteger(index) ? outlineEntryAt(outline.entries, index, 'lineIndex') : null
  })

  const fileTreeContents = (select: (path: string) => void, withFilter: boolean) => <>
          <Row spacing={1} sx={{ ...hairline('bottom'), flexShrink: 0, pl: 1.5, pr: 0.5, py: 0.5 }}>
            <Typography color="textSecondary" variant="overline">{t('review.fileTree.title')}</Typography>
            <Typography color="textSecondary" sx={{ flex: 1 }} variant="caption">{fileSearchMatches.length}/{diffs.length}</Typography>
            <ToggleButtonGroup aria-label={t('review.fileTree.mode')} exclusive onChange={(_, next: FileListMode | null) => { if (next) changeFileListMode(next) }} size="small" value={fileListMode}>
              <Tooltip title={t('review.fileTree.treeTooltip')}><ToggleButton aria-label={t('review.fileTree.tree')} sx={{ px: 1, py: 0.25 }} value="tree"><AccountTreeOutlinedIcon fontSize="small" /></ToggleButton></Tooltip>
              <Tooltip title={t('review.fileTree.listTooltip')}><ToggleButton aria-label={t('review.fileTree.list')} sx={{ px: 1, py: 0.25 }} value="list"><ViewListOutlinedIcon fontSize="small" /></ToggleButton></Tooltip>
            </ToggleButtonGroup>
          </Row>
          {reviewState.enabled ? <Typography color="textSecondary" component="div" sx={{ ...hairline('bottom'), flexShrink: 0, lineHeight: gridLine(5), px: 1.5 }} variant="caption">{t('review.fileTree.reviewedCount', { reviewed: reviewedCount, total: diffs.length })}</Typography> : null}
          {/* The file-name search filters the tree, so it sits on top of it. */}
          {withFilter ? <Box sx={{ ...hairline('bottom'), flexShrink: 0, p: 0.5 }}>{fileSearchField(true)}</Box> : null}
          {/* The rows are buttons, not list items. */}
          <List component="div" disablePadding sx={{ overflowY: 'auto', p: 0.5 }}>
            {fileListMode === 'tree' ? <DiffFileTree displayedPath={displayedPath} entries={fileSearchMatches} expandAll={Boolean(fileSearch.trim())} fileMark={fileKindMark} isReviewed={isReviewed} lineCounts={fileLineCounts} onSelect={select} threadCount={threadCount} /> : <FileList displayedPath={displayedPath} entries={fileSearchMatches} isReviewed={isReviewed} lineCounts={fileLineCounts} onSelect={select} threadCount={threadCount} />}
            {fileSearchMatches.length === 0 ? <Box sx={{ p: 2 }}><Typography color="textSecondary" variant="caption">{diffs.length === 0 ? t('review.fileTree.empty') : t('review.fileTree.noMatch')}</Typography></Box> : null}
          </List>
  </>

  const composerOpen = Boolean(lineComposer)
  useLayoutEffect(() => {
    if (!selectedPosition || view !== 'diff' || selectedLineIndex < 0) return
    const wantedLineId = positionLineId(selectedPosition)
    const target = Array.from(diffScrollRef.current?.querySelectorAll<HTMLElement>('[data-line-id]') ?? [])
      .find((line) => line.dataset.lineId === wantedLineId)
    if (!target) return
    // A line comment editor under the line takes the focus itself.
    if (!composerOpen) target.focus({ preventScroll: true })
    target.scrollIntoView?.({ behavior: 'auto', block: 'center' })
  }, [composerOpen, layout, positionKey, selectedLineIndex, selectedPosition, view])

  useLayoutEffect(() => {
    if (currentSearchMatch < 0 || view !== 'diff') return
    const target = diffScrollRef.current?.querySelector<HTMLElement>('[data-search-active="true"]')
    target?.scrollIntoView?.({ behavior: 'auto', block: 'center' })
  }, [currentSearchMatch, layout, view])

  // The page is the only vertical scroll, so a newly chosen file starts at its top.
  const fileTopRef = useRef<HTMLDivElement>(null)
  const shownPath = useRef(displayedPath)
  useLayoutEffect(() => {
    if (shownPath.current === displayedPath) return
    shownPath.current = displayedPath
    const top = fileTopRef.current
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  }, [displayedPath])

  // Line comment editors stick their toolbar below the file header, which wraps to more rows when narrow.
  const fileHeaderRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const header = fileHeaderRef.current
    const container = fileTopRef.current
    if (!header || !container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => container.style.setProperty('--diff-file-header-height', `${header.offsetHeight}px`))
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  /** The row under the file heading when the view changes size, and how far below the heading it starts. */
  const maximizeAnchor = useRef<{ node: HTMLElement; offset: number } | null>(null)
  const toggleMaximized = useStableCallback(() => {
    const panel = fileTopRef.current?.getBoundingClientRect()
    const headerBottom = fileHeaderRef.current?.getBoundingClientRect().bottom
    const shown = panel && headerBottom !== undefined ? document.elementsFromPoint?.(panel.left + panel.width / 2, headerBottom + 1) ?? [] : []
    // A thread or the row of omitted lines can be there instead of a line.
    const node = shown.map((element) => element.closest<HTMLElement>('.diff-row, .split-row, [data-file-anchor], [data-file-line]')).find(Boolean)
      ?? shown.find((element): element is HTMLElement => element instanceof HTMLElement && element !== fileTopRef.current && Boolean(fileTopRef.current?.contains(element)) && !fileHeaderRef.current?.contains(element))
    maximizeAnchor.current = node && headerBottom !== undefined ? { node, offset: node.getBoundingClientRect().top - headerBottom } : null
    setMaximized((value) => !value)
  })
  useLayoutEffect(() => {
    const anchor = maximizeAnchor.current
    const header = fileHeaderRef.current
    const panel = fileTopRef.current
    maximizeAnchor.current = null
    if (!anchor || !header || !panel) return
    const keepPlace = () => {
      if (!anchor.node.isConnected) { stop(); return }
      // Twice: the heading only sticks once the first move has taken it past its place in the page.
      for (let pass = 0; pass < 2; pass += 1) scrollNearestBy(anchor.node, anchor.node.getBoundingClientRect().top - header.getBoundingClientRect().bottom - anchor.offset)
    }
    // The new width rewraps the lines, and the pieces off screen take their new heights later, so the place is held until the reader moves.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepPlace)
    const stop = () => {
      observer?.disconnect()
      for (const type of READER_MOVES) window.removeEventListener(type, stop, true)
    }
    keepPlace()
    observer?.observe(panel)
    for (const type of READER_MOVES) window.addEventListener(type, stop, { capture: true, passive: true })
    return stop
  }, [maximized])
  // Capture runs before the app's Esc, which would return to the list. What has the focus closes first, as there.
  const choosingLines = choice?.focus != null
  useEffect(() => {
    if (!maximized) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isInsideControlGroup(event.target) || document.querySelector('.MuiModal-root:not(.MuiModal-hidden)')) return
      // A line choice being extended from its button ends first.
      if (choosingLines && event.target instanceof Element && event.target.closest('[data-line-action]')) return
      event.preventDefault()
      event.stopPropagation()
      toggleMaximized()
    }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [choosingLines, maximized, toggleMaximized])

  const selectRelative = (delta: number) => {
    const next = diffs[displayedIndex + delta]
    if (next) onSelectFile(next.newPath || next.oldPath)
  }

  // ] and [ step through the files, as the header buttons do, unless typing, in an open menu or in a dialog.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== ']' && event.key !== '[') return
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || isEditableTarget(event.target) || isInsideMenu(event.target) || document.querySelector('[role="dialog"]')) return
      const next = diffs[displayedIndex + (event.key === ']' ? 1 : -1)]
      if (!next) return
      event.preventDefault()
      onSelectFile(next.newPath || next.oldPath)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [diffs, displayedIndex, onSelectFile])

  // Marking a file reviewed opens the next file still to review, after it in the list and then from the top.
  const toggleReviewed = () => {
    if (!selectedDiff || !displayedPath) return
    const marking = !reviewState.isReviewed(displayedPath)
    reviewState.toggleReviewed(selectedDiff)
    if (!marking) return
    for (let step = 1; step < diffs.length; step += 1) {
      const candidate = diffs[(displayedIndex + step) % diffs.length]
      const path = candidate.newPath || candidate.oldPath
      if (!reviewState.isReviewed(path)) { onSelectFile(path); return }
    }
  }

  const changeFileView = (next: 'diff' | 'file') => {
    if (next === 'file' && displayedPath) {
      // The viewport can be on the third Markdown change block or on a later
      // source-diff hunk. Capture that actual section before unmounting it.
      const top = Math.max(0, fileHeaderRef.current?.getBoundingClientRect().bottom ?? 0)
      const bottom = globalThis.innerHeight || 1000
      const anchors = Array.from(fileTopRef.current?.querySelectorAll<HTMLElement>('[data-file-anchor]') ?? [])
      const visible = anchors.find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > top + 2 && rect.top < bottom - 2
      })
      const visibleLine = visible ? Number(visible.dataset.fileAnchor) : NaN
      const measured = Number.isSafeInteger(visibleLine) && visibleLine > 0
      const line = measured ? visibleLine : selectedPosition?.newLine ?? firstChangedFileLine(displayLines)
      setFileAnchor({ path: displayedPath, line, top: measured ? visible?.getBoundingClientRect().top : undefined })
    }
    if (next === 'diff' && view === 'file' && displayedPath) {
      // The whole file may have been scrolled since it opened, so the line shown at the top now is kept, not the line it opened on.
      const top = Math.max(0, fileHeaderRef.current?.getBoundingClientRect().bottom ?? 0)
      const visible = fileTopRef.current ? firstVisibleFileLine(fileTopRef.current, top) : null
      restoreDiffAnchor.current = visible ? { path: displayedPath, ...visible } : fileAnchor?.path === displayedPath ? { path: displayedPath, line: fileAnchor.line } : null
      if (restoreDiffAnchor.current) setWholePageKey(diffKey)
    }
    onViewChange(next)
  }

  useLayoutEffect(() => {
    const wanted = restoreDiffAnchor.current
    if (view !== 'diff' || !wanted || wanted.path !== displayedPath) return
    const candidates = Array.from(fileTopRef.current?.querySelectorAll<HTMLElement>('[data-file-anchor]') ?? [])
    const target = candidates.reduce<HTMLElement | null>((best, node) => {
      const distance = Math.abs(Number(node.dataset.fileAnchor) - wanted.line)
      const bestDistance = best ? Math.abs(Number(best.dataset.fileAnchor) - wanted.line) : Number.POSITIVE_INFINITY
      return distance < bestDistance ? node : best
    }, null)
    if (target && wanted.top !== undefined) scrollNearestBy(target, target.getBoundingClientRect().top - wanted.top)
    else target?.scrollIntoView?.({ behavior: 'auto', block: 'center' })
    restoreDiffAnchor.current = null
  }, [displayedPath, layout, renderedMarkdownDiff, view])

  useLayoutEffect(() => {
    if (historyStart || !historyScroll.current) return
    const { element, top } = historyScroll.current
    historyScroll.current = null
    element.scrollTop = top
  }, [historyStart])

  // Rows that must be on screen with the first render: the line shown, the search hit, the chosen lines.
  const [wholePageKey, setWholePageKey] = useState<string | null>(null)
  // The lines chosen for a comment, offered to Blame as a range to follow.
  const blameSelection = chosenRange ? chosenLineRange(displayLines.slice(chosenRange[0], chosenRange[1] + 1)) : undefined
  // Folds run within a hunk, as the lines GitLab left out between hunks could close any block.
  const lineFoldRanges = useMemo(() => {
    const gaps = diffGaps(displayLines, 0)
    return foldRanges(displayLines.map((line) => line.text), markdownDiff, (index) => displayLines[index].hunk !== displayLines[index - 1].hunk || gaps[index].count > 0)
  }, [displayLines, markdownDiff])
  const lineHoldsThreads = useCallback((index: number) => lineHasThreads(displayLines[index], threadView), [displayLines, threadView])
  const folds = useLineFolds(lineFoldRanges, diffKey, [selectedLineIndex, currentSearchMatch, chosenRange?.[0] ?? -1, chosenRange?.[1] ?? -1, shownOutlineTarget?.lineIndex ?? -1], lineHoldsThreads)
  const firstRows = wholePageKey === diffKey ? displayLines.length : Math.max(selectedLineIndex, currentSearchMatch, chosenRange?.[1] ?? -1, shownOutlineTarget?.lineIndex ?? -1) + 1
  const diffContent = renderedMarkdownDiff
    ? <MarkdownLinkProvider repository={markdownRepository} sessionId={sourceSessionId}>{markdownNeedsFile && gapQuery && sourceSessionId && !selectedDiff?.deletedFile
      ? <FetchedMarkdownDiffPreview blameEnabled={blameOpen && canBlame} layout={layout} lines={displayLines} query={gapQuery} sessionId={sourceSessionId} source={markdownSource} />
      : <MarkdownDiffPreview blameEnabled={blameOpen && canBlame} layout={layout} lines={displayLines} source={markdownSource} />}</MarkdownLinkProvider>
    : layout === 'split'
    ? <SplitDiff key={displayedPath ?? ''} activeSearchMatch={currentSearchMatch} allowComments={commentsEnabled} blameEnabled={blameOpen && canBlame} chosenRange={chosenRange} firstRows={firstRows} folds={folds} lines={displayLines} selection={rowSelection} scrollRef={diffScrollRef} searchMatchIndices={pageSearchMatches} searchTerm={diffSearch.trim()} selectedPosition={selectedPosition} startIndex={0} threadView={threadView} tokens={rowTokens} gapExpansion={gapExpansion} wrap={wrapLines} />
    : <UnifiedDiff key={displayedPath ?? ''} activeSearchMatch={currentSearchMatch} allowComments={commentsEnabled} blameEnabled={blameOpen && canBlame} chosenRange={chosenRange} firstRows={firstRows} folds={folds} lines={displayLines} selection={rowSelection} scrollRef={diffScrollRef} searchMatchIndices={pageSearchMatches} searchTerm={diffSearch.trim()} selectedPosition={selectedPosition} startIndex={0} threadView={threadView} tokens={rowTokens} gapExpansion={gapExpansion} wrap={wrapLines} />

  return (
    <Box data-diff-maximized={maximized ? 'true' : undefined} ref={rootRef} sx={maximized ? MAXIMIZED_SX : undefined}>
      {diffs.length ? <Row spacing={1} sx={{ flexWrap: 'wrap', mb: 1, px: 0.5 }} useFlexGap>
        <Typography color="textSecondary" variant="caption">{t('review.diff.summary.files', { count: diffs.length })}</Typography>
        <LineCounts added={lineTotals.added} label={t('review.diff.lineCounts', { added: lineTotals.added, removed: lineTotals.removed })} removed={lineTotals.removed} />
        {lineTotals.uncounted ? <Typography color="textSecondary" variant="caption">{t('review.diff.summary.uncounted', { count: lineTotals.uncounted })}</Typography> : null}
      </Row> : null}
      <Row align="top" spacing={1.5} useFlexGap sx={{ minHeight: 420 }}>
        <Box component="nav" aria-label={t('review.fileTree.title')} ref={treeRef} style={{ flexBasis: shownTreeWidth }} sx={{ ...panelFrame({ position: false }), borderRadius: 1, display: treeShown ? 'flex' : 'none', flexDirection: 'column', flexGrow: 0, flexShrink: 0, maxHeight: `calc(100vh - var(--detail-header-height, 0px) - 40px)`, minWidth: 0, position: 'sticky', top: 'var(--detail-header-height, 0px)' }}>
          {fileTreeContents(selectFile, treeShown)}
          {treeShown ? <ColumnResizeHandle column={treeRef} defaultWidth={DEFAULT_TREE_WIDTH} hint={t('review.fileTree.resizeHint')} label={t('review.fileTree.resize')} max={treeWidthLimit} min={MIN_TREE_WIDTH} onCommit={commitTreeWidth} width={shownTreeWidth} /> : null}
        </Box>
        <Box ref={fileTopRef} sx={{ '--composer-sticky-top': 'calc(var(--detail-header-height, 0px) + var(--diff-file-header-height, 0px))', ...panelFrame(), borderRadius: 1, display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0, overflow: 'clip', scrollMarginTop: BELOW_DETAIL_HEADER, '--diff-sticky-top': 'calc(var(--detail-header-height, 0px) + var(--diff-file-header-height, 0px))', '& .diff-row, & .split-row, & [data-file-anchor]': { scrollMarginTop: 'var(--diff-sticky-top)' } }}>
          {/* The controls wrap below the path rather than squeezing it. */}
          <Row ref={fileHeaderRef} spacing={1} useFlexGap sx={{ bgcolor: 'surface.list', ...hairline('bottom', { position: false }), flexWrap: 'wrap', minHeight: 40, position: 'sticky', px: 1, py: 0.5, rowGap: 0.5, top: 'var(--detail-header-height, 0px)', zIndex: 2 }}>
            <Tooltip title={treeShown ? t('review.fileTree.hide') : t('review.fileTree.show')}><IconButton aria-expanded={treeFits ? undefined : treePopoverOpen} aria-haspopup={treeFits ? undefined : 'dialog'} aria-label={treeShown ? t('review.fileTree.hide') : t('review.fileTree.show')} aria-pressed={treeFits ? treeShown : undefined} onClick={toggleTree}><ViewSidebarOutlinedIcon /></IconButton></Tooltip>
            <Tooltip title={t('review.diff.previousFileTooltip')}><span><IconButton aria-keyshortcuts="[" aria-label={t('review.diff.previousFile')} disabled={displayedIndex <= 0} onClick={() => selectRelative(-1)}><KeyboardArrowLeftRoundedIcon /></IconButton></span></Tooltip>
            <Tooltip title={t('review.diff.nextFileTooltip')}><span><IconButton aria-keyshortcuts="]" aria-label={t('review.diff.nextFile')} disabled={displayedIndex < 0 || displayedIndex >= diffs.length - 1} onClick={() => selectRelative(1)}><KeyboardArrowRightRoundedIcon /></IconButton></span></Tooltip>
            <PathTooltip path={displayedPath} placement="bottom-start"><Row spacing={1} sx={{ flex: '1 1 220px', minWidth: 0 }}>
              <HeadingPath path={displayedPath ?? t('review.diff.selectFile')} />
              {diffs.length > 1 ? <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="caption">{displayedIndex + 1}/{diffs.length}</Typography> : null}
              {/* Nothing to count until a diff GitLab left out has been compared here. */}
              {selectedDiff && (comparedDiff || !isDiffOmitted(selectedDiff)) ? <LineCounts {...lineCounts} label={t('review.diff.lineCounts', { added: lineCounts.added, removed: lineCounts.removed })} sx={diffOnlySx} /> : null}
            </Row></PathTooltip>
            {reviewState.enabled && selectedDiff && !selectedDiff.collapsed && !selectedDiff.tooLarge && parsed.status === 'valid' ? <Tooltip describeChild title={t('review.diff.markReviewedHint')}><Button aria-pressed={reviewState.isReviewed(displayedPath ?? '')} onClick={toggleReviewed} size="small" variant="outlined">{reviewState.isReviewed(displayedPath ?? '') ? t('review.fileTree.reviewed') : t('review.diff.markReviewed')}</Button></Tooltip> : null}
            <Tooltip describeChild title={whitespaceIgnored ? t('review.diff.whitespace.ignoredHint') : t('review.diff.whitespace.hint')}><ToggleButton onChange={toggleWhitespace} selected={whitespaceIgnored} size="small" sx={{ flexShrink: 0, py: 0.25, ...diffOnlySx }} value="ignore-whitespace">{t('review.diff.whitespace.toggle')}</ToggleButton></Tooltip>
            {/* The rendered Markdown preview has no code rows to wrap. */}
            <Tooltip describeChild title={wrapLines ? t('review.diff.wrap.onHint') : t('review.diff.wrap.offHint')}><ToggleButton aria-label={t('review.diff.wrap.toggle')} onChange={toggleWrapLines} selected={wrapLines} size="small" sx={{ flexShrink: 0, ...(renderedMarkdownDiff ? { visibility: 'hidden' } : diffOnlySx) }} value="wrap-lines"><WrapTextRoundedIcon fontSize="small" /></ToggleButton></Tooltip>
            <ToggleButtonGroup aria-label={t('review.diff.layout')} exclusive onChange={(_, next: DiffLayout | null) => { if (next) changeLayout(next) }} size="small" sx={{ flexShrink: 0, ...diffOnlySx }} value={layout}>
              <Tooltip title={t('review.diff.unifiedTooltip')}><ToggleButton aria-label={t('review.diff.unified')} value="unified"><ViewStreamOutlinedIcon fontSize="small" /></ToggleButton></Tooltip>
              <Tooltip title={t('review.diff.splitTooltip')}><ToggleButton aria-label={t('review.diff.split')} value="split"><VerticalSplitOutlinedIcon fontSize="small" /></ToggleButton></Tooltip>
            </ToggleButtonGroup>
            <Tooltip title={outlineShown ? t('review.diff.outline.hide') : t('review.diff.outline.show')}><span style={outlineAvailable ? undefined : { visibility: 'hidden' }}><IconButton aria-expanded={outlineFits ? undefined : outlinePopoverOpen} aria-haspopup={outlineFits ? undefined : 'dialog'} aria-label={outlineShown ? t('review.diff.outline.hide') : t('review.diff.outline.show')} aria-pressed={outlineFits ? outlineShown : undefined} onClick={toggleOutline}><TocRoundedIcon /></IconButton></span></Tooltip>
            {canBlame ? <Button aria-pressed={blameOpen} onClick={() => setBlameOpen((value) => !value)} size="small" variant={blameOpen ? 'contained' : 'outlined'}>{t('review.diff.blame')}</Button> : null}
            {view === 'diff' && markdownDiff && parsed.status === 'valid' && !diffSearch.trim() ? <Button aria-label={renderedMarkdownDiff ? t('review.diff.markdown.showSource') : t('review.diff.markdown.showPreview')} onClick={() => setMarkdownMode({ key: markdownModeKey, mode: renderedMarkdownDiff ? 'source' : 'preview' })} size="small" variant="outlined">{renderedMarkdownDiff ? t('review.diff.markdown.source') : t('review.diff.markdown.preview')}</Button> : null}
             {allowFileView ? <ToggleButtonGroup aria-label={t('review.diff.viewToggle')} exclusive onChange={(_, next: 'diff' | 'file' | null) => { if (next) changeFileView(next) }} size="small" sx={{ flexShrink: 0 }} value={view}>
              <ToggleButton value="diff">{t('review.diff.view.diff')}</ToggleButton>
              <ToggleButton value="file">{t('review.diff.view.file')}</ToggleButton>
            </ToggleButtonGroup> : null}
            <Tooltip title={maximized ? t('review.diff.restore') : t('review.diff.maximize')}><IconButton aria-keyshortcuts={maximized ? 'Escape' : undefined} aria-label={maximized ? t('review.diff.restore') : t('review.diff.maximize')} aria-pressed={maximized} onClick={toggleMaximized}>{maximized ? <CloseFullscreenRoundedIcon /> : <OpenInFullRoundedIcon />}</IconButton></Tooltip>
          </Row>
           {/* One dense row: the search fields take the height of a toolbar, not of a form. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ ...hairline('bottom'), px: 1, py: 0.5 }}>
            <Tooltip describeChild placement="bottom-start" title={t('review.diff.search.hint')}><TextField
              fullWidth
              onChange={(event) => { setDiffSearch(event.target.value); setActiveSearch(null) }}
              placeholder={t('review.diff.search.placeholder')}
              size="dense"
              value={diffSearch}
              slotProps={{ htmlInput: { 'aria-label': t('review.diff.search.placeholder') }, input: { endAdornment: <InputAdornment position="end"><Typography aria-live="polite" color="textSecondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{diffSearch.trim() ? `${activeSearchResultIndex >= 0 ? activeSearchResultIndex + 1 : 0}/${searchMatches.length}` : ''}</Typography><Tooltip title={t('review.diff.search.previousTooltip')}><span><IconButton aria-label={t('review.diff.search.previous')} disabled={searchMatches.length === 0} onClick={() => navigateSearch(-1)} size="small"><KeyboardArrowUpRoundedIcon /></IconButton></span></Tooltip><Tooltip title={t('review.diff.search.nextTooltip')}><span><IconButton aria-label={t('review.diff.search.next')} disabled={searchMatches.length === 0} onClick={() => navigateSearch(1)} size="small"><KeyboardArrowDownRoundedIcon /></IconButton></span></Tooltip></InputAdornment> } }}
            /></Tooltip>
            {treeShown ? null : fileSearchField(false)}
          </Stack>
          {fileSearch.trim() && fileSearchMatches.length === 0 ? <Typography color="textSecondary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.fileTree.noMatch')}</Typography> : null}
          {omittedKey && selectedDiff && fileSource ? <OmittedDiffReader key={omittedKey} diff={selectedDiff} onRead={reportOmitted} source={fileSource} /> : null}
          {omitted?.status === 'loading' ? <Typography color="textSecondary" role="status" sx={{ display: 'block', px: 1.5, pt: 1 }} variant="caption">{t('review.diff.omitted.loading')}</Typography> : null}
          {omitted?.status === 'ready' ? <Typography color="textSecondary" role="note" sx={{ display: 'block', px: 1.5, pt: 1 }} variant="caption">{t(omitted.diff ? 'review.diff.omitted.notice' : 'review.diff.omitted.noChange')}</Typography> : null}
          {selectedDiff?.tooLarge && omitted?.status !== 'ready' && omitted?.status !== 'loading' ? <Box sx={{ p: 2 }}><Row spacing={1}><ErrorOutlineRoundedIcon color="warning" fontSize="small" /><Typography variant="body2">{t('review.diff.tooLarge')}</Typography></Row></Box> : null}
          {selectedDiff?.collapsed && omitted?.status !== 'ready' && omitted?.status !== 'loading' ? <Box sx={{ p: 2 }}><Typography color="textSecondary" variant="body2">{t('review.diff.collapsed')}</Typography></Box> : null}
          {omitted?.status === 'notComparable' ? <Typography color="warning" role="status" sx={{ display: 'block', px: 2, pb: 1 }} variant="caption">{t('review.diff.omitted.notComparable')}</Typography> : null}
          {omitted?.status === 'failed' ? <Typography color="warning" role="status" sx={{ display: 'block', px: 2, pb: 1 }} variant="caption">{t('review.diff.omitted.failed', { message: omitted.message })}</Typography> : null}
          {historyStart && fileSource ? <LineHistoryView key={JSON.stringify(historyStart)} iid={fileSource.iid} onClose={closeHistory} onRestart={(start) => setHistory({ path: displayedPath ?? '', start })} projectId={fileSource.projectId} projectUrl={fileSource.projectUrl} sessionId={fileSource.sessionId} start={historyStart} /> : null}
          {/* The file stays mounted under the history, so closing it keeps its place, opened lines and editors. */}
          <Box sx={historyStart ? { display: 'none' } : { display: 'contents' }}>
          {view === 'file' ? <MarkdownLinkProvider repository={markdownRepository} sessionId={sourceSessionId}>{canBlame && fileSource && selectedDiff
            ? <BlameProvider enabled={blameOpen} onHistory={openHistory} key={`${fileSource.sha}:${displayedPath}:full`} newPath={selectedDiff.newPath} oldPath={selectedDiff.oldPath} projectId={fileSource.projectId} projectUrl={fileSource.projectUrl} sessionId={fileSource.sessionId} sha={fileSource.sha}>
                <FullFileView blameEnabled={blameOpen} content={fileContent} diffLines={parsed.status === 'valid' ? parsed.lines : undefined} language={language} loading={fileLoading} path={displayedPath} targetLine={fileAnchor?.path === displayedPath ? fileAnchor.line : undefined} targetTop={fileAnchor?.path === displayedPath ? fileAnchor.top : undefined} />
              </BlameProvider>
            : <FullFileView key={displayedPath ?? ''} content={fileContent} diffLines={parsed.status === 'valid' ? parsed.lines : undefined} language={language} loading={fileLoading} path={displayedPath} targetLine={fileAnchor?.path === displayedPath ? fileAnchor.line : undefined} targetTop={fileAnchor?.path === displayedPath ? fileAnchor.top : undefined} />}</MarkdownLinkProvider> : <>
            {parsed.status !== 'valid' ? <Typography color="warning" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.invalid')}</Typography> : null}
            {whitespaceOnlyFile ? <Typography role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.whitespaceOnly')}</Typography> : null}
            {whitespaceIgnored && commentable ? <Typography color="textSecondary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.whitespace.ignoredNotice')}</Typography> : null}
            {pendingRangeLabel ? <Typography color="primary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.rangeSelected', { lines: positionLines(pendingRangeLabel) })}</Typography> : null}
            {threadView && lineThreads.outdated > 0 ? <Typography color="textSecondary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.outdatedHidden', { count: lineThreads.outdated })}</Typography> : null}
            {threadView && discussionsIncomplete ? <Typography color="textSecondary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.discussionsIncomplete')}</Typography> : null}
            {diffSearch.trim() && searchMatches.length === 0 ? <Typography color="textSecondary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.diff.search.noMatch')}</Typography> : null}
            {/* Always wrapped while Blame can be shown, so toggling it does not remount the diff and an open comment editor in it. */}
            {canBlame && fileSource && selectedDiff
              ? <BlameProvider beforeSha={fileSource.beforeSha} enabled={blameOpen} onHistory={openHistory} key={`${fileSource.sha}:${fileSource.beforeSha ?? ''}:${displayedPath}`} newPath={selectedDiff.newPath} oldPath={selectedDiff.oldPath} projectId={fileSource.projectId} projectUrl={fileSource.projectUrl} selectedLines={blameSelection} sessionId={fileSource.sessionId} sha={fileSource.sha}>{diffContent}</BlameProvider>
              : diffContent}
          </>}
          </Box>
        </Box>
        {outlineShown ? <Box component="nav" aria-label={t('review.diff.outline.title')} sx={{ ...panelFrame({ position: false }), borderRadius: 1, display: 'flex', flex: '0 0 220px', flexDirection: 'column', maxHeight: `calc(100vh - var(--detail-header-height, 0px) - 40px)`, minWidth: 0, position: 'sticky', top: 'var(--detail-header-height, 0px)' }}>
          <Typography color="textSecondary" component="div" sx={{ ...hairline('bottom'), flexShrink: 0, px: 1.5, py: 0.5 }} variant="overline">{t('review.diff.outline.title')}</Typography>
          <DiffOutlineList locate={locateOutlineEntry} onSelect={selectOutlineEntry} outline={outline} />
        </Box> : null}
      </Row>
      <Popover anchorEl={treeButton} anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }} onClose={() => setTreeButton(null)} open={treePopoverOpen} slotProps={{ paper: { 'aria-label': t('review.fileTree.title'), component: 'nav', sx: { display: 'flex', flexDirection: 'column', maxHeight: '70vh', width: 360 } } as object }}>
        {treePopoverOpen ? fileTreeContents(selectFileInPopover, true) : null}
      </Popover>
      <Popover anchorEl={outlineButton} anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }} onClose={() => setOutlineButton(null)} open={outlinePopoverOpen} slotProps={{ paper: { 'aria-label': t('review.diff.outline.title'), component: 'nav', sx: { display: 'flex', flexDirection: 'column', maxHeight: '60vh', width: 320 } } as object }} transformOrigin={{ horizontal: 'right', vertical: 'top' }}>
        <DiffOutlineList locate={locateOutlineEntry} onSelect={selectOutlineEntry} outline={outline} />
      </Popover>
    </Box>
  )
}

const NO_SHOWN_GAPS: ReadonlyMap<string, number> = new Map()
const NO_HUNKS: DiffHunk[] = []
const NO_OUTLINE: DiffOutline = { entries: [], omitted: 0 }

/**
 * A path on one line. Its folders give way first and its file name last, so a long path keeps the name in view.
 * Two parts rather than a right-to-left line: such a line's text stays where it was when the width changes.
 */
function HeadingPath({ path }: { path: string }) {
  const { directory, name } = splitPath(path)
  return <Box component="bdi" dir="ltr" sx={{ alignItems: 'center', display: 'flex', minWidth: 0 }}>
    {directory ? <Typography color="textSecondary" component="span" noWrap sx={{ flexShrink: 100000, fontFamily: 'code.fontFamily', minWidth: 0 }} variant="body2">{directory}/</Typography> : null}
    <Typography component="span" noWrap sx={{ flexShrink: 1, fontFamily: 'code.fontFamily', fontWeight: 600, minWidth: 0 }} variant="body2">{name}</Typography>
  </Box>
}

/** The rendered change block nearest a line; with no new-side line left, the last, as what it removed ends the file. */
function markdownBlockFor(blocks: HTMLElement[], line: number | null): HTMLElement | null {
  if (line === null) return blocks.at(-1) ?? null
  return blocks.reduce<HTMLElement | null>((best, node) => !best || Math.abs(Number(node.dataset.fileAnchor) - line) < Math.abs(Number(best.dataset.fileAnchor) - line) ? node : best, null)
}

/** The changed files as a flat list, each with its folder; renders again only when what it shows changes. */
const FileList = memo(function FileList({ displayedPath, entries, isReviewed, lineCounts, onSelect, threadCount }: { displayedPath: string | null; entries: Array<{ diff: Diff; path: string }>; isReviewed: (path: string) => boolean; lineCounts: ReadonlyMap<string, DiffLineCounts | null>; onSelect: (path: string) => void; threadCount: (path: string) => FileThreadCount | undefined }) {
  const t = useT()
  return <>{entries.map(({ diff, path }) => {
              const { directory, name } = splitPath(path)
              const kind = diff.tooLarge ? t('review.fileTree.kind.tooLarge') : diff.untracked ? t('review.fileTree.kind.untracked') : diff.newFile ? t('review.fileTree.kind.new') : diff.deletedFile ? t('review.fileTree.kind.deleted') : diff.renamedFile ? t('review.fileTree.kind.renamed', { path: diff.oldPath }) : null
              const lines = lineCounts.get(path)
              return <PathTooltip key={`${diff.oldPath}\0${path}`} notes={fileRowNotes(threadCount(path), isReviewed(path))} oldPath={diff.renamedFile ? diff.oldPath : undefined} path={path}><ListItemButton aria-label={fileRowLabel(path, threadCount(path), isReviewed(path), lines)} onClick={() => onSelect(path)} selected={path === displayedPath} sx={{ px: 1, py: 0.5 }}><ListItemText primary={<Row spacing={1} sx={{ minWidth: 0 }}><FileKindMark diff={diff} /><Typography noWrap sx={{ flex: 1, fontWeight: path === displayedPath ? 600 : 400 }} variant="body2">{name}</Typography>{lines ? <LineCounts {...lines} /> : null}<FileThreadMark count={threadCount(path)} />{isReviewed(path) ? <DoneRoundedIcon aria-label={t('review.fileTree.reviewed')} color="success" fontSize="small" /> : null}</Row>} secondary={<Typography color="textSecondary" component="span" noWrap sx={{ display: 'block', pl: 2 }} variant="caption">{[kind, directory].filter(Boolean).join(' · ') || '/'}</Typography>} sx={{ m: 0 }} /></ListItemButton></PathTooltip>
  })}</>
})

const fileKindMark = (diff: Diff) => <FileKindMark diff={diff} />

function FileKindMark({ diff }: { diff: Diff }) {
  const [label, color] = diff.untracked ? ['U', 'success.main'] : diff.newFile ? ['A', 'success.main'] : diff.deletedFile ? ['D', 'error.main'] : diff.renamedFile ? ['R', 'info.main'] : ['M', 'warning.main']
  // Drawn from `data-kind`, so the letter is not read as part of the file row's name, which already says the path.
  return <Box aria-hidden component="span" data-kind={label} sx={{ color, flexShrink: 0, fontFamily: 'code.fontFamily', fontSize: 'overline.fontSize', fontWeight: 700, width: 10, '&::before': { content: 'attr(data-kind)' } }} />
}

type DiffLayout = 'unified' | 'split'
const TREE_HIDDEN_KEY = 'gitlab-desktop:diff-file-tree-hidden'

function readTreeHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(TREE_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

const TREE_WIDTH_KEY = 'gitlab-desktop:diff-file-tree-width'
const DEFAULT_TREE_WIDTH = 240
const MIN_TREE_WIDTH = 160
const MAX_TREE_WIDTH = 600

function readTreeWidth(): number {
  try {
    const saved = Number(globalThis.localStorage?.getItem(TREE_WIDTH_KEY))
    return saved >= MIN_TREE_WIDTH && saved <= MAX_TREE_WIDTH ? saved : DEFAULT_TREE_WIDTH
  } catch {
    return DEFAULT_TREE_WIDTH
  }
}

const OUTLINE_HIDDEN_KEY = 'gitlab-desktop:diff-outline-hidden'

function readOutlineHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(OUTLINE_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

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

const IGNORE_WHITESPACE_KEY = 'gitlab-desktop:diff-ignore-whitespace'

function readIgnoreWhitespace(): boolean {
  try {
    return globalThis.localStorage?.getItem(IGNORE_WHITESPACE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveIgnoreWhitespace(ignore: boolean): void {
  try {
    globalThis.localStorage?.setItem(IGNORE_WHITESPACE_KEY, String(ignore))
  } catch {
    // The choice still applies until the viewer is reopened.
  }
}

const WRAP_LINES_KEY = 'gitlab-desktop:diff-wrap-lines'

function readWrapLines(): boolean {
  try {
    return globalThis.localStorage?.getItem(WRAP_LINES_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveWrapLines(wrap: boolean): void {
  try {
    globalThis.localStorage?.setItem(WRAP_LINES_KEY, String(wrap))
  } catch {
    // The choice still applies until the viewer is reopened.
  }
}

function linesCounted(lines: ParsedLine[]): DiffLineCounts {
  const counts = { added: 0, removed: 0 }
  for (const line of lines) {
    if (line.kind === 'add') counts.added += 1
    else if (line.kind === 'remove') counts.removed += 1
  }
  return counts
}

/** Scrolls the nearest scrolling ancestor of `node`, or the page, by `delta` pixels. */
/** The new-side lines among `lines`, or the removed ones when none are new. */
function chosenLineRange(lines: ParsedLine[]): { side: 'old' | 'new'; range: { start: number; end: number } } | undefined {
  for (const side of ['new', 'old'] as const) {
    const numbers = lines.flatMap((line) => (side === 'new' ? line.newLine : line.kind === 'remove' ? line.oldLine : undefined) ?? [])
    if (numbers.length) return { range: { end: Math.max(...numbers), start: Math.min(...numbers) }, side }
  }
  return undefined
}

/** The element that scrolls `node`: its nearest scrolling ancestor, or the page. */
function scrollParentOf(node: HTMLElement | null): HTMLElement {
  for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

