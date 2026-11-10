import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import LaptopRoundedIcon from '@mui/icons-material/LaptopRounded'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { keyframes } from '@mui/material/styles'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { frame } from '../../components/hairline'
import { gridLine } from '../../theme'
import { formatAbsoluteTime, shortSha } from '../../lib/format'
import type { Commit, Diff, Discussion, Draft, MrVersion, Position } from '../../types/gitlab'
import type { ThreadActions } from './DiffThreads'
import { DiffViewer } from './DiffViewer'
import { DiffMaximizeContext, MAXIMIZED_SX } from './diffMaximize'
import { isInsideControlGroup } from '../../lib/eventTargets'
import type { MoreCommits } from './useCommitPages'
import type { ReviewedFileContext } from './useReviewedFiles'
import type { SuggestionActions } from './SuggestionBlock'
import { LoadingSkeleton } from './LoadingPanel'
import { useFadeAfterLoading } from './useFadeAfterLoading'
import { currentLocale, translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

/** The MR's versions, and the range the changes tab compares, if it shows one. */
export interface VersionChoice {
  /** The start of the range shown: an earlier version, a commit or the target branch. */
  compareFrom: string | null
  /** The end of the range when it is not the MR head. */
  compareTo: string | null
  error: Error | null
  headSha?: string
  items: MrVersion[]
  loading: boolean
  /** GitLab has older versions than the listed ones. */
  more: boolean
  /** Shows the changes from one commit to another (null: the MR head). */
  onSelect: (fromSha: string, toSha: string | null) => void
}

/** The tab's top padding: the commit row sticks exactly where it rests, so scrolling does not move it, and its `::before` covers what scrolls through the gap. */
const TIMELINE_GAP = 12

export function ChangesTab({ compareBaseSha, local, fileSource, threadActions, pendingDrafts, lineComposer, discussions, discussionHeadSha, discussionsIncomplete, onOpenDiscussion, reviewContext, allowComments, changesError, changesLoading, changesMissing, changesTruncated, commits, commitsError, commitsLoading, diffs, fileResult, fileView, moreCommits, onComment, onSelectCommit, onSelectFile, onViewChange, selectedCommit, selectedFile, selectedPosition, suggestionActions, versions }: { compareBaseSha?: string; local?: LocalChoice; fileSource?: { sessionId: string; projectId: string; sha: string; beforeSha?: string; iid?: string; projectUrl?: string }; reviewContext?: ReviewedFileContext; allowComments: boolean; changesError: Error | null; changesLoading: boolean; /** GitLab's list leaves out files of the MR: its count of them, when it does. */ changesMissing?: string | null; changesTruncated: boolean; commits: Commit[]; commitsError: Error | null; commitsLoading: boolean; diffs: Diff[]; fileResult: { data: { content: string } | null; loading: boolean; error: Error | null }; fileView: 'diff' | 'file'; moreCommits: MoreCommits | null; onComment: (position: Position) => void; onSelectCommit: (sha: string | null) => void; onSelectFile: (path: string) => void; onViewChange: (view: 'diff' | 'file') => void; selectedCommit: string | null; selectedFile: string | null; selectedPosition?: Position; discussions?: Discussion[]; discussionHeadSha?: string; discussionsIncomplete: boolean; onOpenDiscussion: (discussionId: string) => void; lineComposer?: { position: Position; node: React.ReactNode }; pendingDrafts?: Draft[]; threadActions?: ThreadActions; suggestionActions?: SuggestionActions; versions: VersionChoice }) {
  const t = useT()
  const compareFrom = versions.compareFrom
  const showingLocal = Boolean(local?.active)
  const showTimeline = !commitsError || commits.length > 0
  const diffsFade = useFadeAfterLoading(changesLoading && !diffs.length)
  // Maximized, the diff covers the window with the commit row folded above it; choosing another commit keeps it maximized.
  const [maximized, setMaximized] = useState(false)
  const [commitsOpen, setCommitsOpen] = useState(false)
  const maximize = useMemo(() => ({ maximized, setMaximized }), [maximized])
  const timelineShown = showTimeline && (!maximized || commitsOpen)
  const stickyRow = showTimeline || maximized
  // Maximized, the row sits at the very top of the view, with nothing above it to show through.
  const timelineGap = maximized ? 0 : TIMELINE_GAP
  // The commit row stays in view under the MR header; the diff's own sticky rows start below it.
  const rootRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    const timeline = timelineRef.current
    if (!root) return
    const update = () => root.style.setProperty('--commit-timeline-height', `${timeline ? timeline.offsetHeight + timelineGap : 0}px`)
    update()
    if (!timeline || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(timeline)
    return () => observer.disconnect()
  }, [stickyRow, timelineGap])
  // A shown diff has its own Esc, which comes first; while none is drawn (loading, failed, no local clone), Esc still restores.
  useEffect(() => {
    if (!maximized) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || rootRef.current?.querySelector('[data-diff-viewer]') || isInsideControlGroup(event.target) || document.querySelector('.MuiModal-root:not(.MuiModal-hidden)')) return
      event.preventDefault()
      event.stopPropagation()
      setMaximized(false)
    }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [maximized])
  return (
    <DiffMaximizeContext.Provider value={maximize}>
    <Stack data-diff-maximized={maximized ? 'true' : undefined} ref={rootRef} spacing={1.5} sx={{ '--mr-header-height': 'var(--detail-header-height, 0px)', ...(maximized ? MAXIMIZED_SX : {}) }}>
      {commitsError && !commits.length ? <Alert severity="error">{t('review.changes.commitsError', { message: commitsError.message })}</Alert> : null}
      {commitsError && commits.length ? <Alert severity="warning">{t('review.changes.commitsStale', { message: commitsError.message })}</Alert> : null}
      {stickyRow ? <Box ref={timelineRef} sx={{ bgcolor: 'background.default', position: 'sticky', py: 0.5, top: `calc(var(--mr-header-height) + ${timelineGap}px)`, zIndex: 2, '&::before': { bgcolor: 'background.default', content: '""', height: timelineGap, left: 0, position: 'absolute', right: 0, top: -timelineGap } }}>
        {maximized ? <Button aria-expanded={commitsOpen} onClick={() => setCommitsOpen((open) => !open)} size="small" startIcon={commitsOpen ? <ExpandMoreRoundedIcon /> : <ChevronRightRoundedIcon />}>{commitsOpen ? t('review.changes.hideCommits') : t('review.changes.showCommits')}</Button> : null}
        {timelineShown ? <CommitTimeline baseSha={compareBaseSha} commits={commits} local={local} headSha={discussionHeadSha} loading={commitsLoading} more={moreCommits} onSelect={onSelectCommit} selected={selectedCommit} versions={versions} /> : null}
      </Box> : null}
      <Stack spacing={1.5} sx={{ '--detail-header-height': 'calc(var(--mr-header-height) + var(--commit-timeline-height, 0px))' }}>
      {showingLocal ? local?.content : <>
      {changesTruncated ? <Alert severity="warning">{t('review.changes.truncated')}</Alert> : null}
      {changesMissing ? <Alert severity="warning">{t('review.changes.filesMissing', { shown: diffs.length, total: changesMissing })}</Alert> : null}
      {changesError && !diffs.length ? <Alert severity="error">{t('review.changes.diffError', { message: changesError.message })}</Alert> : null}
      {changesError && diffs.length ? <Alert severity="warning">{t('review.changes.diffStale', { message: changesError.message })}</Alert> : null}
      {changesLoading && !diffs.length ? <LoadingSkeleton label={t('review.changes.loading')} variant="changes" /> : null}
      {!changesLoading && !changesError && compareFrom && !diffs.length ? <Typography color="textSecondary" role="status" variant="body2">{t('review.changes.noChangesInRange')}</Typography> : null}
      {(!changesLoading || diffs.length) && (!changesError || diffs.length) ? <Box sx={diffsFade}><DiffViewer threadActions={threadActions} pendingDrafts={pendingDrafts} lineComposer={lineComposer} discussionHeadSha={discussionHeadSha} discussions={discussions} discussionsIncomplete={discussionsIncomplete} onOpenDiscussion={onOpenDiscussion} reviewContext={!changesLoading && !changesError ? reviewContext : undefined} key={selectedCommit ?? (compareFrom ? `range:${compareFrom}:${versions.compareTo ?? ''}` : 'mr')} allowComments={allowComments} diffs={diffs} fileContent={fileResult.data?.content} fileLoading={fileResult.loading} fileSource={fileSource} onComment={onComment} onSelectFile={onSelectFile} onViewChange={onViewChange} selectedFile={selectedFile} selectedPosition={selectedPosition} suggestionActions={suggestionActions} view={fileView} /></Box> : null}
      {fileResult.error ? <Alert severity="error">{t('review.changes.fileError', { message: fileResult.error.message })}</Alert> : null}
      </>}
      </Stack>
    </Stack>
    </DiffMaximizeContext.Provider>
  )
}

/** The left end of the commit row: older commits load as it comes near, or from the button for keyboard use. */
function MoreCommitsEnd({ more, rootRef }: { more: MoreCommits; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const t = useT()
  const { auto, onLoad } = more
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!auto || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoad() }, { root: rootRef.current, rootMargin: '0px 0px 0px 480px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [auto, onLoad, rootRef])
  return <Box ref={sentinelRef} sx={{ alignSelf: 'center', flexShrink: 0, px: 1 }}>{more.loading ? <Typography color="textSecondary" role="status" variant="caption">{t('review.changes.loadingCommits')}</Typography> : <Button onClick={onLoad} size="small">{t('review.changes.nextCommits')}</Button>}</Box>
}

/** The linked local clone as a comparison target, with the view that shows it. */
interface LocalChoice {
  active: boolean
  /** The clone's state, read without opening the view. */
  badge?: React.ReactNode
  content: React.ReactNode
  /** The commit the working tree is compared from when it ends a range of the MR's commits (null: the MR head). */
  from: string | null
  onSelect: (from?: string) => void
}

/** One place on the row: the versions before a rebase, older commits not read yet, a commit, or the local changes. */
type RowCell = { kind: 'rebased' } | { kind: 'more' } | { kind: 'commit'; commit: Commit } | { kind: 'local' }

/** Where a box or a run of boxes sits in the row, in px. */
interface BandBox { height: number; left: number; top: number; width: number }

/** The row's measured pieces: the range shown, where it parts between its commits (where one piece ends and the next starts, in px), and the range a button would give. */
interface RowLayout { aimed: BandBox | null; partings: [number, number][]; range: BandBox | null }

/** A drag across boxes to choose them. */
interface RowGesture { anchor: number; x: number; moved: boolean }

// Every piece of the range, and the tint under the pointer, reaches this far past its box on both sides, so the
// space between two pieces is the same as between a piece and a tinted box (8px in the 16px gap). At a growing end
// it leaves room for the button, which sits midway between the piece's edge and the box's text (after the text
// button's 12px inset). The range leans this far towards the end whose button is under the pointer (further while
// it is pressed).
const ROW_GAP = 16
const GROW_REACH = 4
const BOX_INSET = 12
const GROW_PULL = 6
const GROW_PULL_PRESSED = 10
const GROW_EASE = 'cubic-bezier(0.2, 0, 0, 1)'
// The outline of the range a button would give runs out from the range towards the end it reaches.
const growRight = keyframes`from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0) }`
const growLeft = keyframes`from { clip-path: inset(0 0 0 100%) } to { clip-path: inset(0) }`

/**
 * The comparison row, oldest at the left. One tinted piece marks the commits whose changes are shown: one box is that commit alone, neighbouring boxes are their changes together. A click chooses one commit;
 * the buttons beside the piece take it to the first or the latest commit; a drag across boxes or a Shift+click
 * chooses the commits between.
 */
function CommitTimeline({ baseSha, commits, local, headSha, loading, more, onSelect, selected, versions }: { baseSha?: string; commits: Commit[]; local?: LocalChoice; headSha?: string; loading: boolean; more: MoreCommits | null; onSelect: (sha: string | null) => void; selected: string | null; versions: VersionChoice }) {
  const t = useT()
  const showingLocal = Boolean(local?.active)
  const head = headSha ?? commits[0]?.id
  // GitLab lists commits newest first; the row reads from old to new.
  const ordered = useMemo(() => commits.slice().reverse(), [commits])
  // Numbered as GitLab does (oldest is 1) when every version is listed.
  const versionLabel = (sha: string) => {
    const index = versions.items.findIndex((version) => version.headCommitSha === sha)
    if (index < 0) return undefined
    return versions.more ? t('review.changes.versionPush') : t('review.changes.versionTag', { number: versions.items.length - index })
  }
  // Earlier versions whose head is not on the row: pushed before a rebase, or older than the commits read.
  const rebased = versions.items.filter((version) => version.headCommitSha !== head && !ordered.some((commit) => commit.id === version.headCommitSha))
  const cells: RowCell[] = []
  if (rebased.length) cells.push({ kind: 'rebased' })
  if (more && ordered.length) cells.push({ kind: 'more' })
  for (const commit of ordered) cells.push({ commit, kind: 'commit' })
  if (local) cells.push({ kind: 'local' })
  const commitCell = (sha?: string | null) => sha ? cells.findIndex((cell) => cell.kind === 'commit' && cell.commit.id === sha) : -1
  const rebasedCell = cells.findIndex((cell) => cell.kind === 'rebased')
  const moreCell = cells.findIndex((cell) => cell.kind === 'more')
  const firstCommit = cells.findIndex((cell) => cell.kind === 'commit')
  const localCell = cells.findIndex((cell) => cell.kind === 'local')
  const headCell = commitCell(head)
  // A range from the target branch starts here; commits not read yet are in it too.
  const baseCell = moreCell >= 0 ? moreCell : firstCommit
  /** The first cell of a range compared from `from`. */
  const startAt = (from: string) => {
    if (from === baseSha) return baseCell
    const after = commitCell(from)
    if (after >= 0) return after + 1
    if (moreCell >= 0 && ordered[0]?.parentIds?.[0] === from) return firstCommit
    return rebasedCell
  }
  const shown: [number, number] | null = showingLocal ? [local?.from ? startAt(local.from) : localCell, localCell]
    : selected ? [commitCell(selected), commitCell(selected)]
    : versions.compareFrom ? [startAt(versions.compareFrom), versions.compareTo ? commitCell(versions.compareTo) : headCell]
    : [baseCell, headCell]
  const range = shown && shown[0] >= 0 && shown[1] >= shown[0] ? shown : null
  const whole = !selected && !versions.compareFrom && !showingLocal

  /** The commit the changes of a range starting at `cell` are compared from. */
  const fromOf = (cell: number): string | undefined => {
    const at = cells[cell]
    if (at.kind === 'rebased') return versions.compareFrom ?? undefined
    if (at.kind === 'more') return baseSha
    if (at.kind !== 'commit') return undefined
    const before = cells[cell - 1]
    if (!before || before.kind === 'rebased') return baseSha
    if (before.kind === 'commit') return before.commit.id
    return at.commit.parentIds?.[0]
  }
  /** Shows the changes of the cells from `a` to `b`, in the view GitLab can give for them. */
  const choose = (a: number, b: number) => {
    if (a < 0 || b < a) return
    const last = cells[b]
    // The working tree is compared with the MR head only, so its box is chosen alone.
    // The working tree alone is compared with the MR head; with commits before it, from the commit the range starts after.
    if (last.kind === 'local') {
      if (a === b) { local?.onSelect(); return }
      const from = fromOf(a)
      if (from) local?.onSelect(from)
      return
    }
    if (last.kind !== 'commit') return
    const first = cells[a]
    if (a === b && first.kind === 'commit') { onSelect(first.commit.id); return }
    if (a === baseCell && b === headCell) { onSelect(null); return }
    const from = fromOf(a)
    if (from) versions.onSelect(from, b === headCell ? null : last.commit.id)
  }
  /** Moves one end of the range to the end of the row. */
  const extend = (side: 'start' | 'end') => { if (range) choose(side === 'start' ? baseCell : range[0], side === 'end' ? headCell : range[1]) }

  // The commit chosen last: a range grows from it, and it stays marked inside the range.
  const [chosenSha, setAnchorSha] = useState<string | null>(null)
  const anchorSha = selected ?? chosenSha

  // The range follows a drag; the diff changes once the pointer is let go.
  const [preview, setPreview] = useState<[number, number] | null>(null)
  const previewRef = useRef<[number, number] | null>(null)
  const [start, end] = preview ?? range ?? [-1, -1]
  const anchorCell = commitCell(anchorSha)
  const anchorShown = anchorCell >= start && anchorCell <= end ? anchorCell : -1
  // An end that can grow to the end of the row has a button just outside the range.
  const growable = !preview && range !== null && (cells[range[1]]?.kind === 'commit' || cells[range[1]]?.kind === 'local')
  const growStart = growable && range !== null && baseCell >= 0 && range[0] > baseCell
  const growEnd = growable && range !== null && range[1] < headCell
  // The pointer (or focus) on one of those buttons: the range it would give is shown before anything changes.
  const [aim, setAim] = useState<{ pressed: boolean; side: 'start' | 'end' } | null>(null)
  const activeAim = aim && (aim.side === 'start' ? growStart : growEnd) ? aim : null
  const aimed: [number, number] | null = activeAim && range ? (activeAim.side === 'start' ? [baseCell, range[1]] : [range[0], headCell]) : null
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<number, HTMLElement>())
  const cellRef = (index: number) => (element: HTMLElement | null) => { if (element) cellRefs.current.set(index, element); else cellRefs.current.delete(index) }
  const gesture = useRef<RowGesture | null>(null)
  // A Shift+click has already chosen the range, so the box's own click does not choose it alone.
  const skipClick = useRef(false)
  const pointerX = useRef(0)
  const scrollFrame = useRef(0)
  const nearestCommit = (x: number) => {
    let nearest = -1
    let distance = Infinity
    cellRefs.current.forEach((element, index) => {
      if (cells[index]?.kind !== 'commit' && cells[index]?.kind !== 'local') return
      const box = element.getBoundingClientRect()
      const away = Math.abs(box.left + box.width / 2 - x)
      if (away < distance) { distance = away; nearest = index }
    })
    return nearest
  }
  const follow = (x: number) => {
    const drag = gesture.current
    if (!drag) return
    const at = nearestCommit(x)
    if (at < 0) return
    const next: [number, number] = [Math.min(drag.anchor, at), Math.max(drag.anchor, at)]
    if (previewRef.current && next[0] === previewRef.current[0] && next[1] === previewRef.current[1]) return
    previewRef.current = next
    setPreview(next)
  }
  // Near either side of the row, a drag turns it, so the range can reach commits out of view.
  const scrollWhileDragging = () => {
    cancelAnimationFrame(scrollFrame.current)
    const step = () => {
      const scroller = scrollerRef.current
      if (!gesture.current?.moved || !scroller) return
      const box = scroller.getBoundingClientRect()
      const x = pointerX.current
      const edge = 32
      const speed = x < box.left + edge ? -Math.min(24, (box.left + edge - x) / 2 + 2) : x > box.right - edge ? Math.min(24, (x - box.right + edge) / 2 + 2) : 0
      if (speed) { scroller.scrollLeft += speed; follow(x) }
      scrollFrame.current = requestAnimationFrame(step)
    }
    scrollFrame.current = requestAnimationFrame(step)
  }
  const endGesture = (commit: boolean) => {
    const drag = gesture.current
    const next = previewRef.current
    gesture.current = null
    previewRef.current = null
    cancelAnimationFrame(scrollFrame.current)
    setPreview(null)
    if (!commit || !drag?.moved || !next) return
    const at = cells[drag.anchor]
    if (at?.kind === 'commit') setAnchorSha(at.commit.id)
    choose(next[0], next[1])
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    pointerX.current = event.clientX
    if (target.closest('[data-version-tag], [data-range-grow]')) return
    const element = target.closest<HTMLElement>('[data-cell-index]')
    const index = element ? Number(element.dataset.cellIndex) : -1
    if (index < 0 || (cells[index]?.kind !== 'commit' && cells[index]?.kind !== 'local')) return
    if (event.shiftKey && range && (cells[range[1]].kind === 'commit' || cells[range[1]].kind === 'local')) {
      skipClick.current = true
      // From the commit chosen last, when it is in the range; otherwise the range grows to the commit clicked.
      const from = anchorShown >= 0 ? anchorShown : index < range[0] ? range[1] : range[0]
      choose(Math.min(index, from), Math.max(index, from))
      return
    }
    gesture.current = { anchor: index, moved: false, x: event.clientX }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerX.current = event.clientX
    const drag = gesture.current
    if (!drag) return
    if (!drag.moved) {
      // A few pixels first, so a click stays a click.
      if (Math.abs(event.clientX - drag.x) < 4) return
      drag.moved = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      scrollWhileDragging()
    }
    follow(event.clientX)
  }

  // The range and the range a button would give are drawn behind the boxes, measured once they are laid out.
  const [layout, setLayout] = useState<RowLayout | null>(null)
  const [aimStart, aimEnd] = aimed ?? [-1, -1]
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = () => {
      // Measured against the row, since a box may sit in a wrapper of its own.
      const origin = row.getBoundingClientRect()
      const place = (from: number, to: number): BandBox | null => {
        const a = cellRefs.current.get(from)?.getBoundingClientRect()
        const b = cellRefs.current.get(to)?.getBoundingClientRect()
        return a && b ? { height: Math.round(a.height), left: Math.round(a.left - origin.left), top: Math.round(a.top - origin.top), width: Math.round(b.right - a.left) } : null
      }
      const next: RowLayout = {
        aimed: aimStart >= 0 ? place(aimStart, aimEnd) : null,
        // Between each pair of neighbouring boxes in the range: one piece ends `GROW_REACH` past the first box and
        // the next starts `GROW_REACH` before the second.
        partings: start >= 0 ? Array.from({ length: Math.max(0, end - start) }, (_, offset): [number, number] | null => {
          const a = cellRefs.current.get(start + offset)?.getBoundingClientRect()
          const b = cellRefs.current.get(start + offset + 1)?.getBoundingClientRect()
          return a && b ? [Math.round(a.right - origin.left) + GROW_REACH, Math.round(b.left - origin.left) - GROW_REACH] : null
        }).filter((cut): cut is [number, number] => cut !== null) : [],
        range: start >= 0 ? place(start, end) : null,
      }
      setLayout((current) => current && JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    // Measured now, before the row is painted, and again whenever the row or a box changes size.
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    cellRefs.current.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [start, end, aimStart, aimEnd, cells.length])

  // A box has no frame of its own: the tinted pieces behind the range say what is chosen. Under the pointer, a box
  // outside the range is tinted; a box inside a range of several commits is outlined as the piece a click would leave
  // (that commit alone), the same outline a grow button shows, set 3px inside; the one commit shown alone does not
  // react. Both are drawn in the shape of a piece (the box and `reach` past it on each side), so a tinted box sits in
  // the row exactly as a chosen one does.
  // A box the button would add turns as the range would reach it, nearest first.
  const box = (inBand: boolean, delay = 0, hover: 'tint' | 'outline' | 'none' = 'tint', reach = GROW_REACH) => ({
    bgcolor: 'transparent', borderRadius: 1, color: inBand ? 'text.primary' : 'text.secondary', cursor: hover === 'none' ? 'default' : 'pointer', flexShrink: 0, fontWeight: 400, minHeight: 28, minWidth: 0, position: 'relative', px: 1, transition: `color 140ms ${delay}ms`, zIndex: 2,
    '&::before': { borderRadius: 1, bottom: 0, content: '""', left: -reach, outline: '1px solid transparent', outlineOffset: -3, pointerEvents: 'none', position: 'absolute', right: -reach, top: 0, transition: 'background-color 120ms, outline-color 120ms', zIndex: -1 },
    '&:hover': { bgcolor: 'transparent', color: hover === 'tint' ? 'text.primary' : undefined },
    '&:hover::before': hover === 'tint' ? { bgcolor: 'action.hover' } : hover === 'outline' ? { outlineColor: 'primary.main' } : {},
  })
  // One tab stop for the row (the last box of the range); ←/→ Home/End move between boxes.
  const tabStop = end >= 0 ? end : firstCommit
  const moveFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-commit-item]'))
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)))
    items[next].focus()
    items[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  // The row opens at its right end, the latest; older commits added at the left keep the view where it was.
  const fromRight = useRef(0)
  const [overflow, setOverflow] = useState({ left: false, right: false })
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return
    const update = () => {
      fromRight.current = Math.max(0, scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft)
      setOverflow({ left: scroller.scrollLeft > 0, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 })
    }
    // The observer reports the first size as soon as it starts observing.
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
    scroller.addEventListener('scroll', update, { passive: true })
    // The mouse wheel turns the row; at either end it goes on to scroll the page.
    const turnWheel = (event: WheelEvent) => {
      if (event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const left = Math.min(scroller.scrollWidth - scroller.clientWidth, Math.max(0, scroller.scrollLeft + event.deltaY))
      // scrollLeft is fractional at some widths while scrollWidth is rounded, so the end is within a pixel.
      if (Math.abs(left - scroller.scrollLeft) < 1) return
      event.preventDefault()
      scroller.scrollLeft = left
    }
    scroller.addEventListener('wheel', turnWheel, { passive: false })
    return () => { observer.disconnect(); scroller.removeEventListener('scroll', update); scroller.removeEventListener('wheel', turnWheel) }
  }, [])
  const hasLocal = Boolean(local)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth - fromRight.current)
  }, [commits.length, loading, hasLocal, rebased.length])
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), [])
  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    scroller?.scrollBy?.({ behavior: 'smooth', left: direction * scroller.clientWidth * 0.8 })
  }
  const scrollable = overflow.left || overflow.right
  // A clicked box moves to the middle of the row, so the commits on both sides of it stay in view.
  const centre = (element: HTMLElement) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const view = scroller.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    scroller.scrollBy?.({ behavior: 'smooth', left: box.left + box.width / 2 - (view.left + view.width / 2) })
  }

  // The range reaches past its boxes on both sides by the same amount as each piece inside it.
  const bandOf = (box: BandBox) => ({ height: box.height, left: box.left - GROW_REACH, top: box.top, width: box.width + GROW_REACH * 2 })
  const pull = activeAim ? (activeAim.pressed ? GROW_PULL_PRESSED : GROW_PULL) : 0
  const rangeBand = layout?.range ? bandOf(layout.range) : null
  // Over a button, the range leans a little towards the end it would reach.
  const shownBand = rangeBand && activeAim ? { ...rangeBand, left: rangeBand.left - (activeAim.side === 'start' ? pull : 0), width: rangeBand.width + pull } : rangeBand
  // The range split at the partings into one piece per commit; the outer ends keep the range's own reach and lean.
  const pieces = (band: { left: number; width: number }) => {
    const cuts = layout?.partings ?? []
    const edges = [band.left, ...cuts.flat(), band.left + band.width]
    return Array.from({ length: cuts.length + 1 }, (_, index) => ({ key: start + index, left: edges[index * 2], width: edges[index * 2 + 1] - edges[index * 2] }))
  }
  const aimedBand = layout?.aimed && activeAim ? bandOf(layout.aimed) : null
  const growButton = (side: 'start' | 'end') => {
    if (!range || !layout?.range) return null
    const on = activeAim?.side === side
    const single = range[0] === range[1]
    const label = side === 'start' ? t(single ? 'review.changes.upToHere' : 'review.changes.extendToStart') : t(single ? 'review.changes.fromHere' : 'review.changes.extendToEnd')
    const middle = side === 'start' ? layout.range.left + (BOX_INSET - GROW_REACH) / 2 : layout.range.left + layout.range.width - (BOX_INSET - GROW_REACH) / 2
    const x = middle + (on ? (side === 'start' ? -pull : pull) / 2 : 0)
    const Icon = side === 'start' ? ChevronLeftRoundedIcon : ChevronRightRoundedIcon
    // Above the row, so the tip never covers the version marks under the boxes, and pulled close to the row so it
    // stays clear of the tab names above.
    return <Tooltip enterDelay={300} key={`grow-${side}`} placement="top" slotProps={{ popper: { modifiers: [{ name: 'offset', options: { offset: [0, -10] } }] } }} title={label}>
      <ButtonBase
        aria-label={label}
        data-commit-item
        data-range-grow={side}
        onBlur={() => setAim(null)}
        onClick={() => { setAim(null); extend(side) }}
        onFocus={() => setAim({ pressed: false, side })}
        onMouseEnter={() => setAim({ pressed: false, side })}
        onMouseLeave={() => setAim(null)}
        onPointerDown={() => setAim({ pressed: true, side })}
        onPointerUp={() => setAim((current) => current && { ...current, pressed: false })}
        sx={{
          // No fill of its own under the pointer: the range leaning towards it and the outline say enough, and a filled
          // square on the tinted range would read as a third surface.
          // The lighter blue stands out from the tinted range in the dark theme too.
          borderRadius: 1, color: on ? 'primary.light' : 'text.secondary', height: layout.range.height, left: x - 10, position: 'absolute', top: layout.range.top, transform: on && activeAim?.pressed ? 'scale(0.9)' : 'none', transition: `left 160ms ${GROW_EASE}, background-color 120ms, color 120ms, transform 120ms ${GROW_EASE}`, width: 20, zIndex: 3,
          // The button takes the full height of the row, and its hit area reaches a little past the range's edge and
          // over the start of the box's text, so it is easy to take without the arrow looking any bigger. The box
          // under it is already in the range, so a click there loses little.
          '&::before': { bottom: 0, content: '""', position: 'absolute', top: 0, ...(side === 'start' ? { left: -6, right: -8 } : { left: -8, right: -6 }) },
          '& svg': { fontSize: 16, transform: on ? `translateX(${side === 'start' ? -2 : 2}px)` : 'none', transition: `transform 160ms ${GROW_EASE}` },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '& svg': { transition: 'none' } },
        }}
        tabIndex={-1}
      ><Icon /></ButtonBase>
    </Tooltip>
  }
  // Under the right end of the commit it marks (the last commit of that push), so it reads as that box's own mark.
  const tagSx = { color: 'text.secondary', fontSize: 'caption.fontSize', lineHeight: gridLine(4), position: 'absolute', right: 4, top: '100%', whiteSpace: 'nowrap' } as const
  const cell = (index: number) => {
    const at = cells[index]
    const inBand = index >= start && index <= end
    const wanted = aimed !== null && !inBand && index >= aimed[0] && index <= aimed[1]
    const delay = wanted && range ? Math.max(0, (activeAim?.side === 'end' ? index - range[1] : range[0] - index) - 1) * 35 : 0
    if (at.kind === 'rebased') return <Box key="rebased" ref={cellRef(index)} sx={{ alignSelf: 'center', flexShrink: 0, position: 'relative', zIndex: 2 }}><RebasedVersions active={rebased.some((version) => version.headCommitSha === versions.compareFrom)} items={rebased} more={versions.more} numberOf={(version) => versions.more ? null : versions.items.length - versions.items.indexOf(version)} onPick={(sha) => versions.onSelect(sha, null)} /></Box>
    if (at.kind === 'more') return more ? <Box data-cell-index={index} key="more" ref={cellRef(index)} sx={{ alignSelf: 'center', flexShrink: 0, position: 'relative', zIndex: 2 }}><MoreCommitsEnd more={more} rootRef={scrollerRef} /></Box> : null
    if (at.kind === 'local') return local ? [
      // Apart from the commits: the working tree is not on GitLab.
      <Divider flexItem key="local-divider" orientation="vertical" sx={{ my: 1.5 }} />,
      range && index === range[0] && growStart ? growButton('start') : null,
      <Tooltip describeChild key="local" title={t('review.changes.localHint')}><Button aria-pressed={showingLocal} color="inherit" data-cell-index={index} data-commit-item onClick={(event) => { if (skipClick.current) skipClick.current = false; else { centre(event.currentTarget); setAnchorSha(null); local.onSelect() } }} ref={cellRef(index)} startIcon={<LaptopRoundedIcon fontSize="small" />} sx={{ ...box(inBand, 0, inBand ? (end > start ? 'outline' : 'none') : 'tint'), alignSelf: 'center' }} tabIndex={index === tabStop ? 0 : -1}>{t('review.changes.local')}{local.badge}</Button></Tooltip>,
    ] : null
    const { commit } = at
    const time = commit.committedAt || commit.createdAt
    const latest = commit.id === head
    const tag = latest ? undefined : versionLabel(commit.id)
    return [
      range && index === range[0] && growStart ? growButton('start') : null,
      <Box key={commit.id} sx={{ alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
        {/* Above the row like the arrows' tips, and a little late, so passing over the row does not cover the tabs above. */}
        <Tooltip describeChild enterDelay={600} placement="top" title={`${shortSha(commit.id)} ${commit.title}\n${formatAbsoluteTime(time)}`}><Button aria-pressed={inBand} color="inherit" data-cell-index={index} data-commit-item onClick={(event) => { if (skipClick.current) skipClick.current = false; else { centre(event.currentTarget); setAnchorSha(commit.id); onSelect(commit.id) } }} ref={cellRef(index)} sx={{ ...box(inBand || wanted, delay, inBand ? (end > start ? 'outline' : 'none') : 'tint'), justifyContent: 'flex-start', maxWidth: 200 }} tabIndex={index === tabStop ? 0 : -1}><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.title}</Box></Button></Tooltip>
        {tag ? <Tooltip title={t('review.changes.versionFrom', { version: tag })}><ButtonBase data-version-tag onClick={() => { setAnchorSha(null); choose(index + 1, headCell) }} sx={{ ...tagSx, borderRadius: 1, px: 0.5, transition: 'color 120ms', '&:hover, &.Mui-focusVisible': { color: 'primary.main', textDecoration: 'underline' } }}>{tag}</ButtonBase></Tooltip> : null}
      </Box>,
      range && index === range[1] && growEnd ? growButton('end') : null,
    ]
  }

  const status = (() => {
    if (whole) return `${baseSha ? `${t('review.changes.target')} ${shortSha(baseSha)}` : t('review.changes.target')} → ${t('review.changes.latest')}${head ? ` ${shortSha(head)}` : ''}`
    if (showingLocal && !local?.from) return `${t('review.changes.latest')}${head ? ` ${shortSha(head)}` : ''} → ${t('review.changes.workingTree')}`
    if (showingLocal && local?.from) {
      const to = t('review.changes.workingTree')
      const first = range ? cells[range[0]] : undefined
      if (first?.kind === 'commit' && range) return t('review.changes.rangeOfCommits', { count: range[1] - range[0], from: shortSha(first.commit.id), to })
      return t('review.changes.rangeAfter', { from: local.from === baseSha ? `${t('review.changes.target')} ${shortSha(baseSha)}` : shortSha(local.from), to })
    }
    if (!versions.compareFrom) return ''
    const to = shortSha(versions.compareTo ?? head ?? '')
    const first = range ? cells[range[0]] : undefined
    if (first?.kind === 'commit' && range) return t('review.changes.rangeOfCommits', { count: range[1] - range[0] + 1, from: shortSha(first.commit.id), to })
    const from = versions.compareFrom === baseSha ? `${t('review.changes.target')} ${shortSha(baseSha)}` : first?.kind === 'rebased' ? t('review.changes.rebasedVersion', { sha: shortSha(versions.compareFrom) }) : shortSha(versions.compareFrom)
    return t('review.changes.rangeAfter', { from, to })
  })()
  const selectedTitle = selected ? commits.find((commit) => commit.id === selected)?.title : undefined
  const readOnlyNote = selected ? t('review.changes.commitNote') : showingLocal ? t(local?.from ? 'review.changes.localRangeNote' : 'review.changes.localNote') : versions.compareFrom ? t('review.changes.rangeNote') : null
  const hasTags = ordered.some((commit) => commit.id !== head && versionLabel(commit.id))
  return <Stack spacing={0.5}>
    <Row spacing={0.5} sx={{ minWidth: 0 }}>
      <Box aria-label={t('review.changes.compareTarget')} onKeyDown={moveFocus} ref={scrollerRef} role="toolbar" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain' }}>
        <Row onLostPointerCapture={() => endGesture(true)} onPointerCancel={() => endGesture(false)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => endGesture(true)} ref={rowRef} spacing={ROW_GAP / 8} sx={{ minHeight: 32, minWidth: 'max-content', pb: hasTags ? 2.5 : 0.5, position: 'relative', pt: 0.5, px: 2, touchAction: 'pan-x', userSelect: 'none' }}>
          {/* One tinted piece per commit, 2px apart, each with the same corners, so even the whole MR reads as separate commits. */}
          {shownBand && range ? pieces(shownBand).map((piece) => <Box aria-hidden key={piece.key} sx={{ bgcolor: 'surface.selected', borderRadius: 1, height: shownBand.height, left: piece.left, pointerEvents: 'none', position: 'absolute', top: shownBand.top, transition: preview ? 'none' : `left 160ms ${GROW_EASE}, width 160ms ${GROW_EASE}`, width: piece.width, zIndex: 1, '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />) : null}
          {aimedBand ? <Box aria-hidden key={activeAim?.side} sx={{ animation: `${activeAim?.side === 'start' ? growLeft : growRight} 240ms ${GROW_EASE}`, borderRadius: 1, height: aimedBand.height, left: aimedBand.left, pointerEvents: 'none', position: 'absolute', top: aimedBand.top, width: aimedBand.width, zIndex: 1, ...frame({ color: 'primary.main' }), '@media (prefers-reduced-motion: reduce)': { animation: 'none', transition: 'none' } }} /> : null}
          {loading && !ordered.length ? <Typography color="textSecondary" sx={{ px: 1 }} variant="caption">{t('review.changes.loadingCommits')}</Typography> : cells.map((_, index) => cell(index))}
        </Row>
      </Box>
      {scrollable ? <Tooltip title={t('review.changes.scrollLeftTooltip')}><span><IconButton aria-label={t('review.changes.scrollLeft')} disabled={!overflow.left} onClick={() => scrollBy(-1)}><ChevronLeftRoundedIcon /></IconButton></span></Tooltip> : null}
      {scrollable ? <Tooltip title={t('review.changes.scrollRightTooltip')}><span><IconButton aria-label={t('review.changes.scrollRight')} disabled={!overflow.right} onClick={() => scrollBy(1)}><ChevronRightRoundedIcon /></IconButton></span></Tooltip> : null}
    </Row>
    <Row spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      <Button aria-pressed={whole} color="inherit" onClick={() => { setAnchorSha(null); onSelect(null) }} size="small" sx={{ ...box(false, 0, 'tint', 0), bgcolor: whole ? 'surface.selected' : 'transparent', '&:hover': { bgcolor: whole ? 'surface.selected' : 'transparent', color: 'text.primary' }, color: whole ? 'primary.main' : 'text.secondary' }}>{t('review.changes.wholeMr')}</Button>
      <Typography color="textSecondary" variant="caption">
        {selected ? t('review.changes.showingCommit') : t('review.changes.showing')} <Box component="span" sx={{ color: 'text.primary', fontFamily: 'code.fontFamily', verticalAlign: 'top' }}>{selected ? shortSha(selected) : status}</Box>
        {/* The row shortens a long title; the commit shown has it in full here. */}
        {selectedTitle ? <Box component="span" sx={{ color: 'text.primary', ml: 1 }}>{selectedTitle}</Box> : null}
      </Typography>
      {/* A view other than the whole MR cannot take comments: a short mark says so, and its tip (or a screen reader) has the whole note. */}
      {readOnlyNote ? <Tooltip describeChild title={readOnlyNote}><Typography color="textSecondary" component="span" role="note" sx={{ alignItems: 'center', cursor: 'help', display: 'inline-flex', gap: 0.5 }} tabIndex={0} variant="caption"><VisibilityOutlinedIcon aria-hidden fontSize="small" />{t('review.changes.readOnly')}<Box component="span" sx={visuallyHiddenSx}>{readOnlyNote}</Box></Typography></Tooltip> : null}
      {versions.error && !versions.items.length ? <Typography color="error" variant="caption">{t('review.versions.error', { message: versions.error.message })}</Typography> : null}
    </Row>
  </Stack>
}

/** Read by screen readers only. */
const visuallyHiddenSx = { clip: 'rect(0 0 0 0)', height: '1px', overflow: 'hidden', position: 'absolute', whiteSpace: 'nowrap', width: '1px' } as const

/** Versions whose head is not on the row (pushed before a rebase), as a start for the range. */
function RebasedVersions({ active, items, more, numberOf, onPick }: { active: boolean; items: MrVersion[]; more: boolean; numberOf: (version: MrVersion) => number | null; onPick: (sha: string) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return <>
    <Button aria-haspopup="menu" aria-pressed={active} color="inherit" data-commit-item endIcon={<ExpandMoreRoundedIcon />} onClick={(event) => setAnchor(event.currentTarget)} size="small" startIcon={<HistoryRoundedIcon fontSize="small" />} sx={{ borderRadius: 1, color: active ? 'primary.main' : 'text.secondary', minHeight: 28, transition: 'background-color 120ms, color 120ms', '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }} tabIndex={-1}>{t('review.changes.rebasedVersions')}</Button>
    <Menu anchorEl={anchor} onClose={() => setAnchor(null)} open={Boolean(anchor)}>
      {items.map((version) => {
        const at = numberOf(version)
        const values = { sha: shortSha(version.headCommitSha), time: formatVersionTime(version.createdAt) }
        return <MenuItem key={version.id} onClick={() => { setAnchor(null); onPick(version.headCommitSha) }}>{at ? t('review.versions.optionNumbered', { ...values, number: at }) : t('review.versions.option', values)}</MenuItem>
      })}
      {more ? <MenuItem disabled>{t('review.versions.older')}</MenuItem> : null}
    </Menu>
  </>
}

function formatVersionTime(value: string): string {
  const time = Date.parse(value)
  return Number.isNaN(time) ? translate('review.versions.unknownTime') : new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'numeric' }).format(time)
}
