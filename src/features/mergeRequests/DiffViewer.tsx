import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import VerticalSplitOutlinedIcon from '@mui/icons-material/VerticalSplitOutlined'
import ViewStreamOutlinedIcon from '@mui/icons-material/ViewStreamOutlined'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined'
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined'
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
import { type Theme } from '@mui/material/styles'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { gridLine } from '../../theme'
import type { Diff, Discussion, Draft, FileQuery, Position } from '../../types/gitlab'
import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { DiffFileTree, FileThreadMark } from './DiffFileTree'
import { FILE_LIST_MODE_KEY, readFileListMode, type FileListMode } from './diffFileOrder'
import { DiffGap, type GapExpansion } from './DiffGap'
import { BlameCell, BlameProvider } from './BlamePanel'
import type { HistoryCursor } from './lineHistory'
import { LineHistoryView } from './LineHistoryView'
import { ChangeMarker } from './ChangeMarker'
import { changeMarkerStyles } from './changeMarkerStyles'
import { MarkdownDiffPreview } from './MarkdownDiffPreview'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { isMarkdownFilePath } from '../../lib/markdownFiles'
import { annotateFullFile, filePageStart, firstChangedFileLine, type FullFileDiffAnnotations, type RemovedFileLines } from './fullFileAnnotations'
import { diffGaps, type DiffGapInfo } from './diffGaps'
import { LineThreads, type ThreadActions, type ThreadView } from './DiffThreads'
import { fileRowLabel, lineKey, pendingDraftsByLine, threadCountsByFile, threadsByLine } from './diffLineThreads'
import { highlightLines, languageForPath, type SyntaxToken } from '../../lib/syntaxHighlight'
import { ignoreWhitespace as ignoreWhitespaceChanges, parseDiff, splitFileLines, type DiffHunk, type ParsedDiff, type ParsedLine } from './diffParser'
import { positionLines } from './diffLineThreads'
import type { SuggestionActions } from './SuggestionBlock'
import { positionIndexRange, rangePosition } from './suggestions'
import { useReviewedFiles, type ReviewedFileContext } from './useReviewedFiles'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

export const DIFF_PAGE_SIZE = 600
export const FILE_PAGE_SIZE = 1000
/** Keep the file list and code inside the window so long diffs scroll in place. */
/** Below the MR header, which stays at the top of the detail while it scrolls. */
const BELOW_DETAIL_HEADER = 'calc(var(--detail-header-height, 0px) + 8px)'
const EMPTY_PARSED_DIFF: ParsedDiff = { lines: [], status: 'valid' }

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
  fileSource?: { sessionId: string; projectId: string; sha: string; beforeSha?: string; /** The MR's; line history reads commit diffs through it. */ iid?: string }
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
  const parsed = useMemo(() => selectedDiff ? parseDiff(selectedDiff.diff, selectedDiff.oldPath, selectedDiff.newPath) : EMPTY_PARSED_DIFF, [selectedDiff])
  const [blameOpen, setBlameOpen] = useState(false)
  /** The lines whose history replaces the diff, for the file it was opened from. */
  const [history, setHistory] = useState<{ path: string; start: HistoryCursor } | null>(null)
  const historyStart = history && history.path === displayedPath ? history.start : null
  const openHistory = fileSource?.iid && displayedPath ? (start: HistoryCursor) => setHistory({ path: displayedPath, start }) : undefined
  // Diff-only controls keep their place in the whole-file view, so the header does not rewrap and move the content and the view switch under the pointer.
  const diffOnlySx = view === 'diff' ? undefined : { visibility: 'hidden' } as const
  const canBlame = Boolean(fileSource && displayedPath && selectedDiff && !selectedDiff.collapsed && !selectedDiff.tooLarge && (!selectedDiff.deletedFile || fileSource?.beforeSha))
  // GitLab's diff API has no whitespace option, so whitespace-only changes are folded here.
  const [whitespaceIgnored, setWhitespaceIgnored] = useState(readIgnoreWhitespace)
  const toggleWhitespace = () => {
    setWhitespaceIgnored(!whitespaceIgnored)
    saveIgnoreWhitespace(!whitespaceIgnored)
  }
  const folded = useMemo(() => whitespaceIgnored ? ignoreWhitespaceChanges(parsed.lines) : null, [parsed, whitespaceIgnored])
  const displayLines = folded?.lines ?? parsed.lines
  const whitespaceOnlyFile = Boolean(folded && !folded.changed && parsed.lines.some((line) => line.kind !== 'context'))
  const diffKey = selectedDiff ? `${displayedPath}\0${selectedDiff.diff}\0${whitespaceIgnored}` : ''
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
  const [fileListMode, setFileListMode] = useState<FileListMode>(readFileListMode)
  const changeFileListMode = (next: FileListMode) => {
    setFileListMode(next)
    try { globalThis.localStorage?.setItem(FILE_LIST_MODE_KEY, next) } catch { /* The choice still applies until the viewer is reopened. */ }
  }
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

  // One array per page, so the split view's row pairing is not rebuilt on every render.
  const rows = useMemo(() => displayLines.slice(diffOffset, diffOffset + DIFF_PAGE_SIZE), [diffOffset, displayLines])
  const language = displayedPath ? languageForPath(displayedPath) : null
  const rowTokens = useMemo(() => renderedMarkdownDiff ? [] : highlightDiffLines(rows, language), [language, renderedMarkdownDiff, rows])
  const pageSearchMatches = new Set(searchMatches.filter((match) => match.path === displayedPath).map((match) => match.lineIndex))
  const lineCounts = useMemo(() => ({ added: displayLines.filter((line) => line.kind === 'add').length, removed: displayLines.filter((line) => line.kind === 'remove').length }), [displayLines])
  const commentable = allowComments && !selectedDiff?.collapsed && !selectedDiff?.tooLarge && parsed.status === 'valid'
  // Folded whitespace changes move lines, so new line comments wait until whitespace is shown again.
  const commentsEnabled = commentable && !whitespaceIgnored
  const lineThreads = useMemo(() => threadsByLine(discussions, selectedDiff, discussionHeadSha), [discussionHeadSha, discussions, selectedDiff])
  const composer = commentsEnabled && lineComposer ? { key: lineKey(lineComposer.position), node: lineComposer.node, position: lineComposer.position } : undefined
  const draftsByLine = useMemo(() => pendingDraftsByLine(pendingDrafts, selectedDiff, discussionHeadSha), [discussionHeadSha, pendingDrafts, selectedDiff])
  const threadView = (discussions || composer || draftsByLine.size) && parsed.status === 'valid' ? { actions: threadActions, composer, drafts: draftsByLine, onOpen: onOpenDiscussion, sessionId: fileSource?.sessionId, suggestionActions, threads: lineThreads.byLine } : undefined

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
      if (next < diffOffset || next >= diffOffset + DIFF_PAGE_SIZE || !sameHunk(anchor, next)) return
      setLineChoice({ anchor, diffKey, focus: next === anchor ? null : next })
      focusAfterRender.current = next
    },
  }
  const pendingRangeLabel = choice && choice.focus !== null ? rangePosition(displayLines, hunks, Math.min(choice.anchor, choice.focus), Math.max(choice.anchor, choice.focus)) : undefined
  const threadCounts = useMemo(() => threadCountsByFile(discussions, diffs), [diffs, discussions])
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
  const gapsExpandable = Boolean(selectedDiff && !selectedDiff.deletedFile && !selectedDiff.collapsed && !selectedDiff.tooLarge && parsed.status === 'valid')
  const gapExpansion: GapExpansion | undefined = gapsExpandable && ((gapQuery && sourceSessionId) || typeof fileContent === 'string') ? {
    content: gapQuery && sourceSessionId ? undefined : fileContent ?? undefined,
    language,
    onExpand: (key, shown) => setShownGaps((current) => ({ diffKey, shown: new Map(current.diffKey === diffKey ? current.shown : []).set(key, shown) })),
    query: gapQuery,
    sessionId: sourceSessionId,
    shown: shownGaps.diffKey === diffKey ? shownGaps.shown : NO_SHOWN_GAPS,
  } : undefined

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

  // The file tree takes 240px plus the 12px gap beside it; it shows only when the diff keeps enough room beside it,
  // more for the side-by-side layout, and the reader can hide it.
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
  const treeFits = width >= (view === 'diff' && layout === 'split' ? 1100 : 820)
  const treeShown = treeFits && !treeHidden
  const toggleTree = () => {
    setTreeHidden(treeShown)
    try { globalThis.localStorage?.setItem(TREE_HIDDEN_KEY, String(treeShown)) } catch { /* The choice still applies until the viewer is reopened. */ }
  }
  // Beside the tree the field only filters it, so it needs no buttons to step through matches.
  const fileSearchField = (inTree: boolean) => <TextField
              fullWidth
              onChange={(event) => setFileSearch(event.target.value)}
              placeholder={inTree ? t('review.fileTree.filter') : t('review.fileTree.search')}
              size="small"
              sx={denseFieldSx}
              value={fileSearch}
              slotProps={{ htmlInput: { 'aria-label': t('review.fileTree.search') }, input: { endAdornment: inTree ? undefined : <InputAdornment position="end"><Typography aria-live="polite" color="textSecondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{fileSearch.trim() ? `${displayedFileMatchIndex >= 0 ? displayedFileMatchIndex + 1 : 0}/${fileSearchMatches.length}` : ''}</Typography><Tooltip title={t('review.fileTree.previousMatch')}><span><IconButton aria-label={t('review.fileTree.previousMatch')} disabled={!fileSearch.trim() || fileSearchMatches.length === 0} onClick={() => navigateFileSearch(-1)} size="small"><KeyboardArrowUpRoundedIcon /></IconButton></span></Tooltip><Tooltip title={t('review.fileTree.nextMatch')}><span><IconButton aria-label={t('review.fileTree.nextMatch')} disabled={!fileSearch.trim() || fileSearchMatches.length === 0} onClick={() => navigateFileSearch(1)} size="small"><KeyboardArrowDownRoundedIcon /></IconButton></span></Tooltip></InputAdornment> } }}
            />

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
  }, [composerOpen, diffOffset, layout, positionKey, selectedLineIndex, selectedPosition, view])

  useLayoutEffect(() => {
    if (currentSearchMatch < 0 || view !== 'diff') return
    const target = diffScrollRef.current?.querySelector<HTMLElement>('[data-search-active="true"]')
    target?.scrollIntoView?.({ behavior: 'auto', block: 'center' })
  }, [currentSearchMatch, diffOffset, layout, view])

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
      const line = measured ? visibleLine : selectedPosition?.newLine ?? firstChangedFileLine(rows.length ? rows : displayLines)
      setFileAnchor({ path: displayedPath, line, top: measured ? visible?.getBoundingClientRect().top : undefined })
    }
    if (next === 'diff' && view === 'file' && displayedPath) {
      // The whole file may have been scrolled since it opened, so the line shown at the top now is kept, not the line it opened on.
      const top = Math.max(0, fileHeaderRef.current?.getBoundingClientRect().bottom ?? 0)
      const visible = fileTopRef.current ? firstVisibleFileLine(fileTopRef.current, top) : null
      restoreDiffAnchor.current = visible ? { path: displayedPath, ...visible } : fileAnchor?.path === displayedPath ? { path: displayedPath, line: fileAnchor.line } : null
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
  }, [diffOffset, displayedPath, layout, renderedMarkdownDiff, view])

  const diffContent = renderedMarkdownDiff
    ? <MarkdownLinkProvider repository={markdownRepository} sessionId={sourceSessionId}><MarkdownDiffPreview blameEnabled={blameOpen && canBlame} layout={layout} lines={rows} /></MarkdownLinkProvider>
    : layout === 'split'
    ? <SplitDiff key={displayedPath ?? ''} activeSearchMatch={currentSearchMatch} allowComments={commentsEnabled} blameEnabled={blameOpen && canBlame} lines={rows} lineSelection={lineSelection} scrollRef={diffScrollRef} searchMatchIndices={pageSearchMatches} searchTerm={diffSearch.trim()} selectedPosition={selectedPosition} startIndex={diffOffset} threadView={threadView} tokens={rowTokens} gapExpansion={gapExpansion} />
    : <UnifiedDiff key={displayedPath ?? ''} activeSearchMatch={currentSearchMatch} allowComments={commentsEnabled} blameEnabled={blameOpen && canBlame} lines={rows} lineSelection={lineSelection} scrollRef={diffScrollRef} searchMatchIndices={pageSearchMatches} searchTerm={diffSearch.trim()} selectedPosition={selectedPosition} startIndex={diffOffset} threadView={threadView} tokens={rowTokens} gapExpansion={gapExpansion} />

  return (
    <Box ref={rootRef}>
      <Row align="top" spacing={1.5} useFlexGap sx={{ minHeight: 420 }}>
        <Box component="nav" aria-label={t('review.fileTree.title')} sx={{ ...panelFrame({ position: false }), borderRadius: 1, display: treeShown ? 'flex' : 'none', flex: '0 0 240px', flexDirection: 'column', maxHeight: `calc(100vh - var(--detail-header-height, 0px) - 40px)`, minWidth: 0, position: 'sticky', top: 'var(--detail-header-height, 0px)' }}>
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
          {treeShown ? <Box sx={{ ...hairline('bottom'), flexShrink: 0, p: 0.5 }}>{fileSearchField(true)}</Box> : null}
          {/* The rows are buttons, not list items. */}
          <List component="div" disablePadding sx={{ overflowY: 'auto', p: 0.5 }}>
            {fileListMode === 'tree' ? <DiffFileTree displayedPath={displayedPath} entries={fileSearchMatches} expandAll={Boolean(fileSearch.trim())} fileMark={(diff) => <FileKindMark diff={diff} />} isReviewed={reviewState.isReviewed} onSelect={onSelectFile} threadCount={(path) => threadCounts.get(path)} /> : fileSearchMatches.map(({ diff, path }) => {
              const { directory, name } = splitPath(path)
              const kind = diff.tooLarge ? t('review.fileTree.kind.tooLarge') : diff.untracked ? t('review.fileTree.kind.untracked') : diff.newFile ? t('review.fileTree.kind.new') : diff.deletedFile ? t('review.fileTree.kind.deleted') : diff.renamedFile ? t('review.fileTree.kind.renamed', { path: diff.oldPath }) : null
              return <ListItemButton aria-label={fileRowLabel(path, threadCounts.get(path), reviewState.isReviewed(path))} key={`${diff.oldPath}\0${path}`} onClick={() => onSelectFile(path)} selected={path === displayedPath} sx={{ px: 1, py: 0.5 }} title={path}><ListItemText primary={<Row spacing={1} sx={{ minWidth: 0 }}><FileKindMark diff={diff} /><Typography noWrap sx={{ flex: 1, fontWeight: path === displayedPath ? 600 : 400 }} variant="body2">{name}</Typography><FileThreadMark count={threadCounts.get(path)} />{reviewState.isReviewed(path) ? <Tooltip title={t('review.fileTree.reviewed')}><DoneRoundedIcon aria-label={t('review.fileTree.reviewed')} color="success" fontSize="small" /></Tooltip> : null}</Row>} secondary={<Typography color="textSecondary" component="span" noWrap sx={{ display: 'block', pl: 2 }} variant="caption">{[kind, directory].filter(Boolean).join(' · ') || '/'}</Typography>} sx={{ m: 0 }} /></ListItemButton>
            })}
            {fileSearchMatches.length === 0 ? <Box sx={{ p: 2 }}><Typography color="textSecondary" variant="caption">{diffs.length === 0 ? t('review.fileTree.empty') : t('review.fileTree.noMatch')}</Typography></Box> : null}
          </List>
        </Box>
        <Box ref={fileTopRef} sx={{ '--composer-sticky-top': 'calc(var(--detail-header-height, 0px) + var(--diff-file-header-height, 0px))', ...panelFrame(), borderRadius: 1, display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0, overflow: 'clip', scrollMarginTop: BELOW_DETAIL_HEADER }}>
          {/* The controls wrap below the path rather than squeezing it. */}
          <Row ref={fileHeaderRef} spacing={1} useFlexGap sx={{ bgcolor: 'surface.list', ...hairline('bottom', { position: false }), flexWrap: 'wrap', minHeight: 40, position: 'sticky', px: 1, py: 0.5, rowGap: 0.5, top: 'var(--detail-header-height, 0px)', zIndex: 2 }}>
            {treeFits ? <Tooltip title={treeShown ? t('review.fileTree.hide') : t('review.fileTree.show')}><IconButton aria-label={treeShown ? t('review.fileTree.hide') : t('review.fileTree.show')} aria-pressed={treeShown} onClick={toggleTree}><ViewSidebarOutlinedIcon /></IconButton></Tooltip> : null}
            <Tooltip title={t('review.diff.previousFileTooltip')}><span><IconButton aria-keyshortcuts="[" aria-label={t('review.diff.previousFile')} disabled={displayedIndex <= 0} onClick={() => selectRelative(-1)}><KeyboardArrowLeftRoundedIcon /></IconButton></span></Tooltip>
            <Tooltip title={t('review.diff.nextFileTooltip')}><span><IconButton aria-keyshortcuts="]" aria-label={t('review.diff.nextFile')} disabled={displayedIndex < 0 || displayedIndex >= diffs.length - 1} onClick={() => selectRelative(1)}><KeyboardArrowRightRoundedIcon /></IconButton></span></Tooltip>
            <Row spacing={1} sx={{ flex: '1 1 280px', minWidth: 0 }}>
              {/* Long paths lose their start, not their name; the isolate keeps a leading '.' in place. */}
              <Tooltip title={displayedPath ?? ''}><Typography noWrap sx={{ direction: 'rtl', fontFamily: 'code.fontFamily', fontWeight: 600, minWidth: 0, textAlign: 'left' }} variant="body2"><bdi dir="ltr">{displayedPath ?? t('review.diff.selectFile')}</bdi></Typography></Tooltip>
              {diffs.length > 1 ? <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="caption">{displayedIndex + 1}/{diffs.length}</Typography> : null}
              {selectedDiff ? <Typography aria-label={t('review.diff.lineCounts', { added: lineCounts.added, removed: lineCounts.removed })} component="span" sx={{ flexShrink: 0, fontFamily: 'code.fontFamily', whiteSpace: 'nowrap', ...diffOnlySx }} variant="caption"><Box component="span" sx={{ color: 'success.main' }}>+{lineCounts.added}</Box> <Box component="span" sx={{ color: 'error.main' }}>−{lineCounts.removed}</Box></Typography> : null}
            </Row>
            {reviewState.enabled && selectedDiff && !selectedDiff.collapsed && !selectedDiff.tooLarge && parsed.status === 'valid' ? <Tooltip describeChild title={t('review.diff.markReviewedHint')}><Button aria-pressed={reviewState.isReviewed(displayedPath ?? '')} onClick={toggleReviewed} size="small" variant="outlined">{reviewState.isReviewed(displayedPath ?? '') ? t('review.fileTree.reviewed') : t('review.diff.markReviewed')}</Button></Tooltip> : null}
            <Tooltip describeChild title={whitespaceIgnored ? t('review.diff.whitespace.ignoredHint') : t('review.diff.whitespace.hint')}><ToggleButton onChange={toggleWhitespace} selected={whitespaceIgnored} size="small" sx={{ flexShrink: 0, py: 0.25, ...diffOnlySx }} value="ignore-whitespace">{t('review.diff.whitespace.toggle')}</ToggleButton></Tooltip>
            <ToggleButtonGroup aria-label={t('review.diff.layout')} exclusive onChange={(_, next: DiffLayout | null) => { if (next) changeLayout(next) }} size="small" sx={{ flexShrink: 0, ...diffOnlySx }} value={layout}>
              <Tooltip title={t('review.diff.unifiedTooltip')}><ToggleButton aria-label={t('review.diff.unified')} value="unified"><ViewStreamOutlinedIcon fontSize="small" /></ToggleButton></Tooltip>
              <Tooltip title={t('review.diff.splitTooltip')}><ToggleButton aria-label={t('review.diff.split')} value="split"><VerticalSplitOutlinedIcon fontSize="small" /></ToggleButton></Tooltip>
            </ToggleButtonGroup>
            {canBlame ? <Button aria-pressed={blameOpen} onClick={() => setBlameOpen((value) => !value)} size="small" variant={blameOpen ? 'contained' : 'outlined'}>{t('review.diff.blame')}</Button> : null}
            {view === 'diff' && markdownDiff && parsed.status === 'valid' && !diffSearch.trim() ? <Button aria-label={renderedMarkdownDiff ? t('review.diff.markdown.showSource') : t('review.diff.markdown.showPreview')} onClick={() => setMarkdownMode({ key: markdownModeKey, mode: renderedMarkdownDiff ? 'source' : 'preview' })} size="small" variant="outlined">{renderedMarkdownDiff ? t('review.diff.markdown.source') : t('review.diff.markdown.preview')}</Button> : null}
             {allowFileView ? <ToggleButtonGroup aria-label={t('review.diff.viewToggle')} exclusive onChange={(_, next: 'diff' | 'file' | null) => { if (next) changeFileView(next) }} size="small" sx={{ flexShrink: 0 }} value={view}>
              <ToggleButton value="diff">{t('review.diff.view.diff')}</ToggleButton>
              <ToggleButton value="file">{t('review.diff.view.file')}</ToggleButton>
            </ToggleButtonGroup> : null}
          </Row>
           {/* One dense row: the search fields take the height of a toolbar, not of a form. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ ...hairline('bottom'), px: 1, py: 0.5 }}>
            <Tooltip describeChild placement="bottom-start" title={t('review.diff.search.hint')}><TextField
              fullWidth
              onChange={(event) => { setDiffSearch(event.target.value); setActiveSearch(null) }}
              placeholder={t('review.diff.search.placeholder')}
              size="small"
              sx={denseFieldSx}
              value={diffSearch}
              slotProps={{ htmlInput: { 'aria-label': t('review.diff.search.placeholder') }, input: { endAdornment: <InputAdornment position="end"><Typography aria-live="polite" color="textSecondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{diffSearch.trim() ? `${activeSearchResultIndex >= 0 ? activeSearchResultIndex + 1 : 0}/${searchMatches.length}` : ''}</Typography><Tooltip title={t('review.diff.search.previousTooltip')}><span><IconButton aria-label={t('review.diff.search.previous')} disabled={searchMatches.length === 0} onClick={() => navigateSearch(-1)} size="small"><KeyboardArrowUpRoundedIcon /></IconButton></span></Tooltip><Tooltip title={t('review.diff.search.nextTooltip')}><span><IconButton aria-label={t('review.diff.search.next')} disabled={searchMatches.length === 0} onClick={() => navigateSearch(1)} size="small"><KeyboardArrowDownRoundedIcon /></IconButton></span></Tooltip></InputAdornment> } }}
            /></Tooltip>
            {treeShown ? null : fileSearchField(false)}
          </Stack>
          {fileSearch.trim() && fileSearchMatches.length === 0 ? <Typography color="textSecondary" role="status" sx={{ px: 1.5, pt: 1 }} variant="caption">{t('review.fileTree.noMatch')}</Typography> : null}
          {selectedDiff?.tooLarge ? <Box sx={{ p: 2 }}><Row spacing={1}><ErrorOutlineRoundedIcon color="warning" fontSize="small" /><Typography variant="body2">{t('review.diff.tooLarge')}</Typography></Row></Box> : null}
          {selectedDiff?.collapsed ? <Box sx={{ p: 2 }}><Typography color="textSecondary" variant="body2">{t('review.diff.collapsed')}</Typography></Box> : null}
          {historyStart && fileSource?.iid ? <LineHistoryView key={JSON.stringify(historyStart)} iid={fileSource.iid} onClose={() => setHistory(null)} onRestart={(start) => setHistory({ path: displayedPath ?? '', start })} projectId={fileSource.projectId} sessionId={fileSource.sessionId} start={historyStart} /> : view === 'file' ? <MarkdownLinkProvider repository={markdownRepository} sessionId={sourceSessionId}>{canBlame && fileSource && selectedDiff
            ? <BlameProvider enabled={blameOpen} onHistory={openHistory} initialNewLine={fileAnchor?.path === displayedPath ? fileAnchor.line : 1} key={`${fileSource.sha}:${displayedPath}:full`} lines={[]} newPath={selectedDiff.newPath} oldPath={selectedDiff.oldPath} projectId={fileSource.projectId} sessionId={fileSource.sessionId} sha={fileSource.sha}>
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
            <PageControls offset={diffOffset} pageSize={DIFF_PAGE_SIZE} total={displayLines.length} onNext={() => updateDiffOffset((current) => Math.min(current + DIFF_PAGE_SIZE, Math.max(0, displayLines.length - 1)))} onPrevious={() => updateDiffOffset((current) => Math.max(0, current - DIFF_PAGE_SIZE))} />
            {/* Always wrapped while Blame can be shown, so toggling it does not remount the diff and an open comment editor in it. */}
            {canBlame && fileSource && selectedDiff
              ? <BlameProvider beforeSha={fileSource.beforeSha} enabled={blameOpen} onHistory={openHistory} key={`${fileSource.sha}:${fileSource.beforeSha ?? ''}:${displayedPath}`} lines={rows} newPath={selectedDiff.newPath} oldPath={selectedDiff.oldPath} projectId={fileSource.projectId} sessionId={fileSource.sessionId} sha={fileSource.sha}>{diffContent}</BlameProvider>
              : diffContent}
          </>}
        </Box>
      </Row>
    </Box>
  )
}


const denseFieldSx = { '& .MuiInputBase-input': { py: 0.5 } }
const NO_SHOWN_GAPS: ReadonlyMap<string, number> = new Map()
const NO_HUNKS: DiffHunk[] = []
// Rendered Markdown without diff marks still labels its blocks with their source lines, so switching views keeps the place.
const NO_FILE_ANNOTATIONS: FullFileDiffAnnotations = { addedLines: new Set(), consistent: true, removedByAnchor: new Map() }

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}

function isInsideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"], [role="menubar"], [role="listbox"]') !== null
}

function FileKindMark({ diff }: { diff: Diff }) {
  const [label, color] = diff.untracked ? ['U', 'success.main'] : diff.newFile ? ['A', 'success.main'] : diff.deletedFile ? ['D', 'error.main'] : diff.renamedFile ? ['R', 'info.main'] : ['M', 'warning.main']
  // Drawn from `data-kind`, so the letter is not read as part of the file row's name, which already says the path.
  return <Box aria-hidden component="span" data-kind={label} sx={{ color, flexShrink: 0, fontFamily: 'code.fontFamily', fontSize: 'overline.fontSize', fontWeight: 700, width: 10, '&::before': { content: 'attr(data-kind)' } }} />
}

function PageControls({ offset, pageSize, total, onNext, onPrevious }: { offset: number; pageSize: number; total: number; onNext: () => void; onPrevious: () => void }) {
  const t = useT()
  if (total <= pageSize && offset === 0) return null
  const end = Math.min(total, offset + pageSize)
  const previous = offset
  const remaining = Math.max(0, total - end)
  return <Row aria-label={t('review.diff.page.label')} spacing={1} sx={{ flexWrap: 'wrap', px: 1.5, py: 1 }}>
    <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{remaining > 0 ? t('review.diff.page.rangeRemaining', { start: String(offset + 1), end: String(end), total: String(total), remaining: String(remaining) }) : t('review.diff.page.range', { start: String(offset + 1), end: String(end), total: String(total) })}</Typography>
    <Button aria-label={t('review.diff.page.previousLines', { count: String(pageSize) })} disabled={previous === 0} onClick={onPrevious} size="small">{t('review.diff.page.previous')}</Button>
    <Button aria-label={t('review.diff.page.nextLines', { count: String(pageSize) })} disabled={remaining === 0} onClick={onNext} size="small">{t('review.diff.page.next')}</Button>
  </Row>
}

/** Choosing the lines of a comment with the 「+」 buttons, by absolute line index. */
interface LineSelection {
  isChosen: (index: number) => boolean
  onAction: (index: number, event: React.MouseEvent) => void
  onDragStart: (index: number, event: React.MouseEvent) => void
  onDragOver: (index: number) => void
  onKeyDown: (index: number, event: React.KeyboardEvent) => void
}

/** The 「+」 of a commentable line; it also extends a multi-line choice. A plain element, as a page holds many rows. */
function lineAction(index: number, label: string, selection: LineSelection) {
  return <button aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown" aria-label={label} className="diff-action line-action" data-line-action={index} onClick={(event) => selection.onAction(index, event)} onKeyDown={(event) => selection.onKeyDown(index, event)} onMouseDown={(event) => selection.onDragStart(index, event)} title={translate('review.diff.lineActionTitle')} type="button">+</button>
}

/** Follows a gutter drag over the rows, which carry their line index. */
function dragOver(selection: LineSelection) {
  return (event: React.MouseEvent) => {
    const index = (event.target as HTMLElement).closest?.('[data-line-index]')?.getAttribute('data-line-index')
    if (index) selection.onDragOver(Number(index))
  }
}

function UnifiedDiff({ activeSearchMatch, allowComments, blameEnabled, gapExpansion, lineSelection, lines, scrollRef, searchMatchIndices, searchTerm, selectedPosition, startIndex, threadView, tokens }: { activeSearchMatch: number; allowComments: boolean; blameEnabled: boolean; gapExpansion?: GapExpansion; lineSelection: LineSelection; lines: ParsedLine[]; scrollRef: React.RefObject<HTMLDivElement | null>; searchMatchIndices: Set<number>; searchTerm: string; selectedPosition?: Position; startIndex: number; threadView?: ThreadView; tokens: SyntaxToken[][] }) {
  const t = useT()
  const skipped = diffGaps(lines, startIndex)
  // Opened unchanged lines: plain context rows, outside paging and search.
  const openedRows = (opened: ParsedLine[], openedTokens: SyntaxToken[][]) => opened.map((line, index) => <Fragment key={`opened-${line.newLine}`}>
    <div className="diff-row" data-file-anchor={line.newLine} data-kind="context" data-testid="diff-opened-line">
      {blameEnabled ? <BlameCell line={line.newLine} side="new" /> : null}
      <span className="diff-gutter"><span className="diff-number">{line.oldLine}</span><span className="diff-number">{line.newLine}</span></span>
      <span className="diff-code"><span className="diff-prefix">{line.prefix}</span> {renderCode(openedTokens[index] ?? [{ text: line.text }], '')}</span>
    </div>
    <LineThreads line={line} view={threadView} />
  </Fragment>)
  // Rows are plain elements styled from this one block: a page holds up to
  // DIFF_PAGE_SIZE rows, and per-row styled components dominate render time.
  return (
    <Box ref={scrollRef} sx={(theme) => ({ ...diffBaseStyles(theme),
      // Long code lines wrap, so the page stays the only scroll.
      '& .diff-rows': { minWidth: 0 },
      '& .blame-cell': { alignItems: 'center', bgcolor: 'surface.list', ...hairline('right'), color: 'text.secondary', display: 'inline-flex', flexShrink: 0, fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', width: 132 },
      '& .blame-action': { background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', flexShrink: 0, font: 'inherit', fontSize: 'caption.fontSize', padding: '0 4px', textAlign: 'left', whiteSpace: 'nowrap' },
      '& .blame-action:hover, & .blame-action:focus-visible': { color: theme.palette.primary.main, textDecoration: 'underline' },
      '& .blame-author': { fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      '& .diff-row': { '--row-bg': theme.palette.background.paper, alignItems: 'stretch', backgroundColor: 'var(--row-bg)', color: theme.palette.text.primary, display: 'flex', minHeight: 20 },
      '& .diff-row[data-kind="add"]': { '--row-bg': theme.palette.diff?.addedBackground, color: theme.palette.diff?.addedText },
      '& .diff-row[data-kind="remove"]': { '--row-bg': theme.palette.diff?.deletedBackground, color: theme.palette.diff?.deletedText },
      '& .diff-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .diff-row[data-search-active="true"]': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: -2 },
      '& mark': { backgroundColor: theme.palette.diff?.searchMatchBackground, color: theme.palette.diff?.searchMatchText },
      '& .diff-gutter': { alignItems: 'stretch', backgroundColor: 'var(--row-bg)', display: 'flex', flexShrink: 0, paddingRight: '26px', position: 'relative' },
      // Lines chosen for a multi-line comment: a bar and a tint on the gutter, keeping the add/remove colour of the code.
      '& .diff-row[data-range="true"] .diff-gutter': { backgroundColor: theme.palette.action.selected, boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` },
      '& .diff-number': { color: theme.palette.text.secondary, padding: '0 6px', textAlign: 'right', userSelect: 'none', width: 44 },
      '& .diff-row:hover .diff-action, & .diff-row:focus-within .diff-action, & .diff-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .diff-code': { color: theme.palette.text.primary, flex: 1, minWidth: 0, overflowWrap: 'anywhere', paddingRight: '24px', whiteSpace: 'pre-wrap' },
      '& .diff-row[data-kind="add"] .diff-prefix': { color: theme.palette.diff?.addedText },
      '& .diff-row[data-kind="remove"] .diff-prefix': { color: theme.palette.diff?.deletedText },
    })}>
      {lines.length === 0 ? <Typography color="textSecondary" sx={{ fontFamily: 'fontFamily', p: 2 }} variant="body2">{t('review.diff.empty')}</Typography> : null}
      <div className="diff-rows" onMouseOver={allowComments ? dragOver(lineSelection) : undefined}>
        {lines.map((line, index) => {
          const isSelectedPosition = matchesPosition(line, selectedPosition)
          const position = linePosition(line)
          const lineIndex = startIndex + index
          const key = `${lineIndex}-${line.oldLine ?? ''}-${line.newLine ?? ''}`
          return <Fragment key={key}>
            {skipped[index].count > 0 ? <DiffGap expansion={gapExpansion} gap={skipped[index]} renderLines={openedRows} /> : null}
            <div className="diff-row" data-kind={line.kind} data-line-id={isSelectedPosition && selectedPosition ? positionLineId(selectedPosition) : undefined} data-line-index={lineIndex} data-range={allowComments && lineSelection.isChosen(lineIndex) ? 'true' : undefined} data-search-match={searchMatchIndices.has(lineIndex) ? 'true' : undefined} data-search-active={activeSearchMatch === lineIndex ? 'true' : undefined} data-selected={isSelectedPosition ? 'true' : undefined} data-testid="diff-line" data-file-anchor={line.newLine} tabIndex={isSelectedPosition ? -1 : undefined}>
              {blameEnabled ? <BlameCell line={line.kind === 'remove' ? line.oldLine : line.newLine} side={line.kind === 'remove' ? 'old' : 'new'} /> : null}
              <span className="diff-gutter">
                <span className="diff-number">{line.oldLine ?? ''}</span>
                <span className="diff-number">{line.newLine ?? ''}</span>
                {position && allowComments ? lineAction(lineIndex, t('review.diff.commentOnLine', { path: line.newPath, line: String(line.newLine ?? line.oldLine) }), lineSelection) : null}
              </span>
              <span className="diff-code"><span className="diff-prefix">{line.prefix}</span> {renderCode(tokens[index] ?? [{ text: line.text }], searchTerm)}</span>
            </div>
            <LineThreads line={line} view={threadView} />
          </Fragment>
        })}
      </div>
    </Box>
  )
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

function linePosition(line: ParsedLine): Position | undefined {
  return line.commentable && (line.newLine !== undefined || line.oldLine !== undefined)
    ? { baseSha: '', headSha: '', newLine: line.newLine, newPath: line.newPath, oldPath: line.oldPath, oldLine: line.oldLine, positionType: 'text', startSha: '' }
    : undefined
}

interface SplitRow {
  key: string
  /** Unchanged lines GitLab omitted before this row. */
  gap?: DiffGapInfo
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
  const skipped = diffGaps(lines, startIndex)
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
      rows.push({ gap: pair === 0 ? skipped[start] : undefined, key: `${startIndex + start}-${pair}`, left: removed[pair]?.line, leftIndex: removed[pair]?.index, right: added[pair]?.line, rightIndex: added[pair]?.index })
    }
  }
  return rows
}

function SplitDiff({ activeSearchMatch, allowComments, blameEnabled, gapExpansion, lineSelection, lines, scrollRef, searchMatchIndices, searchTerm, selectedPosition, startIndex, threadView, tokens }: { activeSearchMatch: number; allowComments: boolean; blameEnabled: boolean; gapExpansion?: GapExpansion; lineSelection: LineSelection; lines: ParsedLine[]; scrollRef: React.RefObject<HTMLDivElement | null>; searchMatchIndices: Set<number>; searchTerm: string; selectedPosition?: Position; startIndex: number; threadView?: ThreadView; tokens: SyntaxToken[][] }) {
  const t = useT()
  const rows = useMemo(() => buildSplitRows(lines, startIndex), [lines, startIndex])
  const cell = (line: ParsedLine | undefined, side: 'old' | 'new', lineIndex: number | undefined) => {
    // Context rows offer one comment action, on the new side, with both line numbers.
    const showAction = line && allowComments && (line.kind !== 'context' || side === 'new')
    const position = showAction ? linePosition(line) : undefined
    const number = side === 'old' ? line?.oldLine : line?.newLine
    const kind = !line ? 'empty' : line.kind
    const label = side === 'old' && line?.kind === 'remove'
      ? t('review.diff.commentOnOldLine', { path: line.oldPath, line: String(line.oldLine) })
      : line ? t('review.diff.commentOnLine', { path: line.newPath, line: String(line.newLine ?? line.oldLine) }) : ''
    const chosen = allowComments && lineIndex !== undefined && lineSelection.isChosen(lineIndex)
    return <>
      {blameEnabled ? <BlameCell line={number} side={side} /> : null}
      <span className="split-number" data-kind={kind} data-line-index={line ? lineIndex : undefined} data-range={chosen ? 'true' : undefined} data-side={side}>
        {number ?? ''}
        {position && lineIndex !== undefined ? lineAction(lineIndex, label, lineSelection) : null}
      </span>
      <span className="split-code" data-kind={kind} data-search-match={lineIndex !== undefined && searchMatchIndices.has(lineIndex) ? 'true' : undefined}>{line && lineIndex !== undefined ? renderCode(tokens[lineIndex - startIndex] ?? [{ text: line.text }], searchTerm) : ''}</span>
    </>
  }
  // Opened unchanged lines: the same text on both sides, outside paging and search.
  const openedRows = (opened: ParsedLine[], openedTokens: SyntaxToken[][]) => opened.map((line, index) => {
    const code = renderCode(openedTokens[index] ?? [{ text: line.text }], '')
    return <Fragment key={`opened-${line.newLine}`}>
      <div className="split-row" data-file-anchor={line.newLine} data-testid="diff-opened-line">
        {blameEnabled ? <BlameCell line={line.oldLine} side="old" /> : null}
        <span className="split-number" data-kind="context" data-side="old">{line.oldLine}</span>
        <span className="split-code" data-kind="context">{code}</span>
        {blameEnabled ? <BlameCell line={line.newLine} side="new" /> : null}
        <span className="split-number" data-kind="context" data-side="new">{line.newLine}</span>
        <span className="split-code" data-kind="context">{code}</span>
      </div>
      <LineThreads line={line} view={threadView} />
    </Fragment>
  })
  return (
    <Box ref={scrollRef} sx={(theme) => ({ ...diffBaseStyles(theme),
      '& .split-row': { display: 'grid', gridTemplateColumns: blameEnabled ? '106px 72px minmax(0, 1fr) 106px 72px minmax(0, 1fr)' : '72px minmax(0, 1fr) 72px minmax(0, 1fr)', minHeight: 20 },
      '& .blame-cell': { alignItems: 'center', bgcolor: 'surface.list', ...hairline('right'), color: 'text.secondary', display: 'inline-flex', flexShrink: 0, fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', width: 132 },
      '& .blame-action': { background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', flexShrink: 0, font: 'inherit', fontSize: 'caption.fontSize', padding: '0 4px', textAlign: 'left', whiteSpace: 'nowrap' },
      '& .blame-action:hover, & .blame-action:focus-visible': { color: theme.palette.primary.main, textDecoration: 'underline' },
      '& .blame-author': { fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      '& .split-row .blame-cell': { width: 106 },
      '& .split-row .blame-author': { display: 'none' },
      '& .split-row[data-selected="true"]': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      '& .split-row[data-search-active="true"]': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: -2 },
      '& mark': { backgroundColor: theme.palette.diff?.searchMatchBackground, color: theme.palette.diff?.searchMatchText },
      // As in the unified view: room for a 5-digit number, then the 26px of the comment button.
      '& .split-number': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.secondary, padding: '0 26px 0 6px', position: 'relative', textAlign: 'right', userSelect: 'none' },
      '& .split-number[data-side="new"]': hairline('left', { color: theme.palette.divider, position: false }),
      '& .split-code': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, overflowWrap: 'anywhere', padding: '0 10px 0 6px', whiteSpace: 'pre-wrap' },
      '& [data-kind="remove"]': { backgroundColor: theme.palette.diff?.deletedBackground },
      '& .split-number[data-kind="remove"]': { color: theme.palette.diff?.deletedText },
      '& [data-kind="add"]': { backgroundColor: theme.palette.diff?.addedBackground },
      '& .split-number[data-kind="add"]': { color: theme.palette.diff?.addedText },
      '& [data-kind="empty"]': { backgroundColor: quietBand(theme) },
      '& .split-row:hover .diff-action, & .split-row:focus-within .diff-action, & .split-row[data-selected="true"] .diff-action': { opacity: 1 },
      '& .split-number[data-range="true"]': { boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` },
      '& .diff-gap > span': { position: 'static' },
    })} onMouseOver={allowComments ? dragOver(lineSelection) : undefined}>
      {rows.length === 0 ? <Typography color="textSecondary" sx={{ fontFamily: 'fontFamily', p: 2 }} variant="body2">{t('review.diff.empty')}</Typography> : null}
      {rows.map((row) => {
        const selected = Boolean(selectedPosition && ((row.left && matchesPosition(row.left, selectedPosition)) || (row.right && matchesPosition(row.right, selectedPosition))))
        const activeSearch = row.leftIndex === activeSearchMatch || row.rightIndex === activeSearchMatch
        const hasSearchMatch = (row.leftIndex !== undefined && searchMatchIndices.has(row.leftIndex)) || (row.rightIndex !== undefined && searchMatchIndices.has(row.rightIndex))
        return <Fragment key={row.key}>
          {row.gap && row.gap.count > 0 ? <DiffGap expansion={gapExpansion} gap={row.gap} renderLines={openedRows} /> : null}
          <div className="split-row" data-line-id={selected && selectedPosition ? positionLineId(selectedPosition) : undefined} data-search-active={activeSearch ? 'true' : undefined} data-search-match={hasSearchMatch ? 'true' : undefined} data-selected={selected ? 'true' : undefined} data-testid="diff-split-row" data-file-anchor={row.right?.newLine ?? row.left?.newLine} tabIndex={selected ? -1 : undefined}>
            {cell(row.left, 'old', row.leftIndex)}
            {cell(row.right, 'new', row.rightIndex)}
          </div>
          <LineThreads line={row.left} view={threadView} />
          {row.right !== row.left ? <LineThreads line={row.right} view={threadView} /> : null}
        </Fragment>
      })}
    </Box>
  )
}

/** Rows without code (empty split cells, omitted lines): a tone that stays visible on the dark theme too. */
function quietBand(theme: Theme): string {
  return theme.palette.mode === 'dark' && theme.palette.surface ? theme.palette.surface.list : theme.palette.action.hover
}

/** Styles shared by the unified and side-by-side layouts. */
function diffBaseStyles(theme: Theme) {
  return {
    flex: 1,
    fontFamily: theme.typography.code?.fontFamily ?? 'monospace',
    fontSize: theme.typography.code?.fontSize ?? '0.8125rem',
    lineHeight: '20px',
    minWidth: 0,
    py: 0.5,
    '& .diff-action': { alignItems: 'center', backgroundColor: theme.palette.fill?.primary ?? theme.palette.primary.dark, border: 0, borderRadius: `${theme.shape.borderRadius}px`, color: theme.palette.fill?.primaryText ?? theme.palette.primary.contrastText, cursor: 'pointer', fontFamily: theme.typography.fontFamily, fontSize: theme.typography.body1.fontSize, fontWeight: 700, height: 16, lineHeight: '16px', opacity: 0, padding: 0, position: 'absolute', right: '3px', textAlign: 'center', top: 2, width: 20 },
    // The visible mark stays small to fit the 20px row; the hit area around it is 26×24px.
    '& .diff-action::before': { content: '""', inset: '-4px -3px', position: 'absolute' },
    '& .diff-action:hover': { backgroundColor: theme.palette.fill?.primaryHover ?? theme.palette.primary.dark },
    '& .diff-action:focus-visible': { opacity: 1, outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    ...syntaxStyles(theme),
    '& .diff-gap': { alignItems: 'center', backgroundColor: quietBand(theme), color: theme.palette.text.secondary, columnGap: '12px', display: 'flex', flexWrap: 'wrap', fontFamily: theme.typography.fontFamily, fontSize: theme.typography.caption.fontSize, lineHeight: gridLine(6), padding: '0 12px' },
    '& .diff-gap-toggle': { alignItems: 'center', background: 'none', border: 0, borderRadius: `${theme.shape.borderRadius}px`, color: theme.palette.primary.main, cursor: 'pointer', display: 'inline-flex', font: 'inherit', gap: '4px', margin: '0 -4px', padding: '0 4px' },
    '& .diff-gap-toggle:hover': { textDecoration: 'underline' },
    '& .diff-gap-toggle:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    '& .diff-gap-error': { color: theme.palette.error.main },
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
    ? <Row align="stretch"><span className="blame-cell" /><Box sx={{ ...hairline('right'), flex: '0 0 52px' }} />{deletion}</Row>
    : deletion
}

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

  return <Box ref={rootRef} sx={blameEnabled ? (theme: Theme) => ({
    '& .blame-cell': { alignItems: 'center', bgcolor: 'surface.list', ...hairline('right'), color: 'text.secondary', display: 'inline-flex', flexShrink: 0, fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', width: 132 },
    '& .blame-action': { background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', flexShrink: 0, font: 'inherit', fontSize: 'caption.fontSize', padding: '0 4px', textAlign: 'left', whiteSpace: 'nowrap' },
    '& .blame-action:hover, & .blame-action:focus-visible': { color: theme.palette.primary.main, textDecoration: 'underline' },
    '& .blame-author': { fontSize: 'caption.fontSize', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }) : undefined}>
    {markdown ? <Box sx={{ ...hairline('bottom'), px: 1, py: 0.5 }}>
      <Button aria-label={showSource ? t('review.fullFile.renderMarkdown') : t('review.fullFile.showMarkdownSource')} onClick={toggleSource} size="small" variant="outlined">{showSource ? t('review.fullFile.markdown') : t('review.fullFile.source')}</Button>
    </Box> : null}
    {annotations && !annotations.consistent ? <Typography color="warning.main" role="status" sx={{ px: 1.5, py: 1 }} variant="caption">{t('review.fullFile.inconsistent')}</Typography> : null}
    {!content ? <Typography color="textSecondary" sx={{ p: 2 }} variant="body2">{t('review.fullFile.empty')}</Typography>
      : markdown && !showSource ? <Box aria-label={t('review.fullFile.markdownPreview')} sx={(theme) => ({
          minWidth: 0, px: 2, py: 1.5,
          '& [data-review-change="add"]': { backgroundColor: theme.palette.diff?.addedBackground, boxShadow: `inset 3px 0 0 ${theme.palette.success.main}`, borderRadius: 1, px: 0.5 },
          '& [data-review-deleted="true"]': { backgroundColor: theme.palette.diff?.deletedBackground, ...hairline('left', { color: 'error.main', width: 3 }), my: 1, px: 1.5, py: 1 },
          '& [data-review-marker="remove"]': changeMarkerStyles(theme, 'remove'),
          '& [data-review-deleted="true"] pre': { fontFamily: 'code.fontFamily', fontSize: 'code.fontSize', mb: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
        })}><MockMarkdown body={content} renderBlame={blameEnabled ? (line) => <BlameCell line={line} side="new" /> : undefined} review={changeMarkers ?? NO_FILE_ANNOTATIONS} size="body1" /></Box>
        : <>
          <PageControls offset={offset} pageSize={FILE_PAGE_SIZE} total={lines.length} onNext={nextPage} onPrevious={previousPage} />
          <Box data-testid="file-lines" sx={(theme) => ({ ...syntaxStyles(theme), py: 0.5 })}>{visibleLines.map((line, index) => {
            const fileLine = offset + index + 1
            const additions = changeMarkers?.addedLines.has(fileLine)
            return <Fragment key={fileLine}>
              {(changeMarkers?.removedByAnchor.get(fileLine) ?? []).map((item, removedIndex) => <RemovedFullFileLines blameEnabled={blameEnabled} item={item} key={`${item.oldStart}:${removedIndex}`} />)}
              <Row data-change={additions ? 'add' : undefined} data-file-line={fileLine} data-testid="file-line" align="stretch" sx={(theme) => ({
                backgroundColor: additions ? theme.palette.diff?.addedBackground : undefined,
                boxShadow: additions ? `inset 3px 0 0 ${theme.palette.success.main}` : undefined, minHeight: 20,
              })}>{blameEnabled ? <BlameCell line={fileLine} side="new" /> : null}<Typography color="textSecondary" sx={{ ...hairline('right'), flex: '0 0 52px', px: 1, textAlign: 'right', userSelect: 'none' }} variant="code">{fileLine}</Typography><Typography component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', px: 1, whiteSpace: 'pre-wrap' }} variant="code">{renderCode(visibleTokens[index] ?? [{ text: line }], '')}</Typography></Row>
            </Fragment>
          })}
          {offset + visibleLines.length >= lines.length ? (changeMarkers?.removedByAnchor.get(lines.length + 1) ?? []).map((item, index) => <RemovedFullFileLines blameEnabled={blameEnabled} item={item} key={`last:${item.oldStart}:${index}`} />) : null}
          </Box>
          <PageControls offset={offset} pageSize={FILE_PAGE_SIZE} total={lines.length} onNext={() => turnPageFromBottom(nextPage)} onPrevious={() => turnPageFromBottom(previousPage)} />
        </>}
  </Box>
}

/**
 * The first whole-file line or rendered Markdown block on screen below `top`, with where it is.
 * One starting on screen is preferred to a block that starts above it, such as a list around it.
 */
function firstVisibleFileLine(root: HTMLElement, top: number): { line: number; top: number } | null {
  const bottom = globalThis.innerHeight || 1000
  let partly: { line: number; top: number } | null = null
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-file-line], [data-source-start]'))) {
    const rect = node.getBoundingClientRect()
    const line = Number(node.dataset.fileLine ?? node.dataset.sourceStart)
    if (rect.bottom <= top + 2 || rect.top >= bottom - 2 || !Number.isSafeInteger(line) || line <= 0) continue
    if (rect.top >= top - 2) return { line, top: rect.top }
    partly ??= { line, top: rect.top }
  }
  return partly
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

/** Scrolls the nearest scrolling ancestor of `node`, or the page, by `delta` pixels. */
function scrollNearestBy(node: HTMLElement, delta: number) {
  if (!delta) return
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) { parent.scrollTop += delta; return }
  }
  const page = document.scrollingElement ?? document.documentElement
  page.scrollTop += delta
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
