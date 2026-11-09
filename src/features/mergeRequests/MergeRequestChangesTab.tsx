import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { frame } from '../../components/hairline'
import { formatAbsoluteTime, shortSha } from '../../lib/format'
import type { Commit, Diff, Discussion, Draft, MrVersion, Position } from '../../types/gitlab'
import type { ThreadActions } from './DiffThreads'
import { DiffViewer } from './DiffViewer'
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
  // The commit row stays in view under the MR header; the diff's own sticky rows start below it.
  const rootRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    const timeline = timelineRef.current
    if (!root) return
    const update = () => root.style.setProperty('--commit-timeline-height', `${timeline ? timeline.offsetHeight + TIMELINE_GAP : 0}px`)
    update()
    if (!timeline || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(timeline)
    return () => observer.disconnect()
  }, [showTimeline])
  return (
    <Stack ref={rootRef} spacing={1.5} sx={{ '--mr-header-height': 'var(--detail-header-height, 0px)' }}>
      {commitsError && !commits.length ? <Alert severity="error">{t('review.changes.commitsError', { message: commitsError.message })}</Alert> : null}
      {commitsError && commits.length ? <Alert severity="warning">{t('review.changes.commitsStale', { message: commitsError.message })}</Alert> : null}
      {showTimeline ? <Box ref={timelineRef} sx={{ bgcolor: 'background.default', position: 'sticky', py: 0.5, top: `calc(var(--mr-header-height) + ${TIMELINE_GAP}px)`, zIndex: 2, '&::before': { bgcolor: 'background.default', content: '""', height: TIMELINE_GAP, left: 0, position: 'absolute', right: 0, top: -TIMELINE_GAP } }}><CommitTimeline baseSha={compareBaseSha} commits={commits} local={local} headSha={discussionHeadSha} loading={commitsLoading} more={moreCommits} onSelect={onSelectCommit} selected={selectedCommit} versions={versions} /></Box> : null}
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
  onSelect: () => void
}

/** A point in time on the comparison row: the target branch, the state after a commit, or the local working tree. */
interface RangePoint {
  id: string
  /** Missing where the commit is not known (before commits not read yet) and for the working tree. */
  sha?: string
  kind: 'base' | 'parent' | 'commit' | 'worktree'
  /** How the status line names it. */
  name: string
  /** The label under the point: the target, a version, the latest, the working tree. */
  tag?: string
}

/** What lies between two neighbouring points: a commit, the local changes, or commits not read yet. */
type RangeStep = { kind: 'commit'; commit: Commit } | { kind: 'local' } | { kind: 'more' }

/**
 * The comparison row, oldest at the left: points in time with the commits between them. The diff shown runs
 * between two points, the start and the end; one commit alone is the range over that commit.
 */
function CommitTimeline({ baseSha, commits, local, headSha, loading, more, onSelect, selected, versions }: { baseSha?: string; commits: Commit[]; local?: LocalChoice; headSha?: string; loading: boolean; more: MoreCommits | null; onSelect: (sha: string | null) => void; selected: string | null; versions: VersionChoice }) {
  const t = useT()
  const showingLocal = Boolean(local?.active)
  const head = headSha ?? commits[0]?.id
  // GitLab lists commits newest first; the row reads from old to new, like the start and end of the range.
  const ordered = useMemo(() => commits.slice().reverse(), [commits])
  const versionTag = (sha: string) => {
    const index = versions.items.findIndex((version) => version.headCommitSha === sha)
    if (index < 0) return undefined
    // Numbered as GitLab does (oldest is 1) when every version is listed.
    return versions.more ? t('review.changes.versionPush') : t('review.changes.versionTag', { number: versions.items.length - index })
  }
  const points: RangePoint[] = [{ id: 'base', kind: 'base', name: baseSha ? `${t('review.changes.target')} ${shortSha(baseSha)}` : t('review.changes.target'), sha: baseSha, tag: t('review.changes.target') }]
  const steps: RangeStep[] = []
  if (more && ordered.length) {
    const parent = ordered[0].parentIds?.[0]
    steps.push({ kind: 'more' })
    points.push({ id: `before:${ordered[0].id}`, kind: 'parent', name: parent ? shortSha(parent) : '…', sha: parent })
  }
  for (const commit of ordered) {
    const latest = commit.id === head
    const tag = latest ? t('review.changes.latest') : versionTag(commit.id)
    steps.push({ commit, kind: 'commit' })
    points.push({ id: commit.id, kind: 'commit', name: tag ? `${tag} ${shortSha(commit.id)}` : shortSha(commit.id), sha: commit.id, tag })
  }
  if (local) {
    steps.push({ kind: 'local' })
    points.push({ id: 'worktree', kind: 'worktree', name: t('review.changes.workingTree'), tag: t('review.changes.workingTree') })
  }
  const indexOf = (sha?: string | null) => sha ? points.findIndex((point) => point.sha === sha) : -1
  const headIndex = indexOf(head)
  // Earlier versions whose head is not on the row: pushed before a rebase, or older than the commits read.
  const rebased = versions.items.filter((version) => version.headCommitSha !== head && indexOf(version.headCommitSha) < 0)
  // The range as point indices; -1 is the menu of versions before a rebase, left of the row.
  const range: [number, number] = showingLocal ? [headIndex, points.length - 1]
    : selected ? [indexOf(selected) - 1, indexOf(selected)]
    : versions.compareFrom ? [versions.compareFrom === baseSha ? 0 : indexOf(versions.compareFrom), versions.compareTo ? indexOf(versions.compareTo) : headIndex]
    : [0, headIndex]
  const [dragRange, setDragRange] = useState<[number, number] | null>(null)
  const [start, end] = dragRange ?? range
  const whole = !selected && !versions.compareFrom && !showingLocal

  /** Shows the changes from point `a` to point `b`, in the view GitLab can give for them. */
  const choose = (a: number, b: number) => {
    if (b <= a || b < 0) return
    const to = points[b]
    // The working tree is compared with the MR head only, so the range starts there.
    if (to.kind === 'worktree') { local?.onSelect(); return }
    const step = a >= 0 ? steps[a] : undefined
    if (b === a + 1 && step?.kind === 'commit') { onSelect(step.commit.id); return }
    if (a === 0 && b === headIndex) { onSelect(null); return }
    const from = a < 0 ? versions.compareFrom : points[a].sha
    if (!from || !to.sha) return
    versions.onSelect(from, b === headIndex ? null : to.sha)
  }
  /** A point clicked: the nearer end of the range moves to it. */
  const movePoint = (index: number) => {
    if (points[index].kind === 'worktree') { if (!showingLocal) local?.onSelect(); return }
    if (showingLocal) { if (index < headIndex) choose(index, headIndex); return }
    if (index === start || index === end) return
    if (index < start) choose(index, end)
    else if (index > end) choose(start, index)
    else if (index - start <= end - index) choose(index, end)
    else choose(start, index)
  }
  const fromHere = (step: number) => choose(step, !showingLocal && end > step ? end : headIndex)
  const toHere = (step: number) => choose(!showingLocal && start <= step ? start : 0, step + 1)

  // Many commits stay on one line; the arrows scroll it when it is wider than the pane.
  const scrollerRef = useRef<HTMLDivElement>(null)
  // The ends are dragged along the row; the diff changes once the end is let go.
  const dragging = useRef<'start' | 'end' | null>(null)
  const nearestPoint = (x: number) => {
    let nearest = -1
    let distance = Infinity
    scrollerRef.current?.querySelectorAll<HTMLElement>('[data-point-index]').forEach((element) => {
      const box = element.getBoundingClientRect()
      const away = Math.abs(box.left + box.width / 2 - x)
      if (away < distance) { distance = away; nearest = Number(element.dataset.pointIndex) }
    })
    return nearest
  }
  // The click that ends a drag does not move the range again.
  const dragged = useRef(false)
  // The range while dragging, for the pointer events, which can come faster than the row renders.
  const dragAt = useRef<[number, number] | null>(null)
  const endDrag = (next: [number, number] | null) => {
    dragging.current = null
    dragAt.current = null
    setDragRange(null)
    if (next && (next[0] !== range[0] || next[1] !== range[1])) choose(next[0], next[1])
  }
  // The handlers stay on the point that was taken (an end of the range shown), wherever the dragged end has gone.
  const dragHandlers = (index: number) => showingLocal || (index !== range[0] && index !== range[1]) ? {} : {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      dragging.current = index === range[0] ? 'start' : 'end'
      dragged.current = false
      dragAt.current = range
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setDragRange(range)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const current = dragAt.current
      if (!dragging.current || !current) return
      const at = nearestPoint(event.clientX)
      // The working tree is not a GitLab point, so a dragged end stops at the MR head.
      if (at < 0 || points[at].kind === 'worktree' || (!points[at].sha && at !== 0)) return
      const next: [number, number] = dragging.current === 'start' ? [Math.min(at, current[1] - 1), current[1]] : [current[0], Math.max(at, current[0] + 1)]
      if (next[0] === current[0] && next[1] === current[1]) return
      dragged.current = true
      dragAt.current = next
      setDragRange(next)
    },
    onPointerUp: () => endDrag(dragAt.current),
    onPointerCancel: () => endDrag(null),
  }

  const item = (active: boolean) => ({ bgcolor: active ? 'surface.selected' : 'transparent', ...frame({ color: active ? 'primary.main' : 'divider' }), borderRadius: 1, color: active ? 'text.primary' : 'text.secondary', flexShrink: 0, fontWeight: active ? 600 : 400, minHeight: 28, px: 1, '&:hover': { bgcolor: active ? 'surface.selected' : 'action.hover', outlineColor: active ? 'primary.main' : 'surface.borderStrong' } })
  const inRange = (step: number) => step >= start && step < end
  const label = { color: 'text.secondary', fontSize: 'caption.fontSize', left: '50%', lineHeight: 1.4, pointerEvents: 'none', position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap' } as const
  const handleLabel = (index: number) => index === start ? t('review.changes.rangeStart') : index === end ? t('review.changes.rangeEnd') : null
  // One tab stop for the whole row (the end of the range); ←/→ Home/End move between items.
  const tabStop = end >= 0 ? end : 0
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
  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    scroller?.scrollBy?.({ behavior: 'smooth', left: direction * scroller.clientWidth * 0.8 })
  }
  const scrollable = overflow.left || overflow.right

  const point = (index: number) => {
    const at = points[index]
    const isEnd = index === start || index === end
    const handle = handleLabel(index)
    return <ButtonBase
      aria-label={handle ? t('review.changes.pointWithEnd', { end: handle, name: at.name }) : t('review.changes.point', { name: at.name })}
      data-commit-item
      data-point-index={index}
      key={`point:${at.id}`}
      onClick={() => { if (dragged.current) dragged.current = false; else movePoint(index) }}
      tabIndex={index === tabStop ? 0 : -1}
      {...dragHandlers(index)}
      sx={{
        alignSelf: 'stretch', borderRadius: 1, cursor: isEnd && !showingLocal ? 'grab' : 'pointer', flexShrink: 0, position: 'relative', touchAction: 'none', width: 24,
        // The line of the row runs through the point; inside the range it takes the range's colour.
        '&::before, &::after': { content: '""', height: 2, position: 'absolute', top: 'calc(50% - 1px)', width: '50%' },
        '&::before': { bgcolor: index > 0 && inRange(index - 1) ? 'primary.main' : 'divider', left: 0 },
        '&::after': { bgcolor: index < steps.length && inRange(index) ? 'primary.main' : 'divider', right: 0 },
      }}
    >
      <Box component="span" sx={{ bgcolor: isEnd ? 'primary.main' : 'text.secondary', borderRadius: '50%', height: isEnd ? 14 : 8, position: 'relative', width: isEnd ? 14 : 8, zIndex: 1 }} />
      {handle ? <Box component="span" sx={{ ...label, bottom: 'calc(50% + 10px)', color: 'primary.main', fontWeight: 600 }}>{handle}</Box> : null}
      {at.tag ? <Box component="span" sx={{ ...label, top: 'calc(50% + 10px)' }}>{at.tag}</Box> : null}
    </ButtonBase>
  }
  const step = (index: number) => {
    const at = steps[index]
    if (at.kind === 'more') return more ? <MoreCommitsEnd key="more" more={more} rootRef={scrollerRef} /> : null
    if (at.kind === 'local') return local ? <Tooltip describeChild key="local" title={t('review.changes.localHint')}><Button aria-pressed={showingLocal} color="inherit" data-commit-item onClick={local.onSelect} sx={{ ...item(showingLocal), alignSelf: 'center' }} tabIndex={-1}>{t('review.changes.local')}{local.badge}</Button></Tooltip> : null
    const { commit } = at
    const time = commit.committedAt || commit.createdAt
    const active = inRange(index)
    return <Box key={commit.id} sx={{ alignSelf: 'center', flexShrink: 0, position: 'relative', '&:hover > .range-actions, &:focus-within > .range-actions': { display: 'flex' } }}>
      <Tooltip describeChild title={`${commit.title}\n${formatAbsoluteTime(time)}`}><Button aria-pressed={active} color="inherit" data-commit-item onClick={() => onSelect(commit.id)} sx={{ ...item(active), justifyContent: 'flex-start', gap: 1, maxWidth: 240 }} tabIndex={-1}><Box component="span" sx={{ color: 'primary.main', fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', flexShrink: 0 }}>{shortSha(commit.id)}</Box><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.title}</Box></Button></Tooltip>
      <Row aria-label={t('review.changes.rangeActions', { sha: shortSha(commit.id) })} className="range-actions" role="group" spacing={0.25} sx={{ bgcolor: 'background.paper', borderRadius: 1, bottom: '100%', display: 'none', left: '50%', p: 0.25, position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap', zIndex: 3, ...frame({ color: 'surface.borderStrong' }) }}>
        <Button color="inherit" onClick={() => fromHere(index)} size="small" sx={{ minHeight: 0, py: 0 }}>{t('review.changes.fromHere')}</Button>
        <Button color="inherit" onClick={() => onSelect(commit.id)} size="small" sx={{ minHeight: 0, py: 0 }}>{t('review.changes.onlyThis')}</Button>
        <Button color="inherit" onClick={() => toHere(index)} size="small" sx={{ minHeight: 0, py: 0 }}>{t('review.changes.toHere')}</Button>
      </Row>
    </Box>
  }

  const fromName = start >= 0 ? points[start]?.name : start === -1 && versions.compareFrom ? t('review.changes.rebasedVersion', { sha: shortSha(versions.compareFrom) }) : '…'
  const selectedTitle = selected ? commits.find((commit) => commit.id === selected)?.title : undefined
  const toName = end >= 0 ? points[end]?.name : versions.compareTo ? shortSha(versions.compareTo) : head ? shortSha(head) : '…'
  return <Stack spacing={0.5}>
    <Row spacing={0.5} sx={{ minWidth: 0 }}>
      <Box aria-label={t('review.changes.compareTarget')} onKeyDown={moveFocus} ref={scrollerRef} role="toolbar" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}><Row align="stretch" spacing={0} sx={{ minHeight: 32, minWidth: 'max-content', pb: 2.5, pt: 3.5, px: 4 }}>
        {rebased.length ? <RebasedVersions active={start === -1} items={rebased} more={versions.more} numberOf={(version) => versions.more ? null : versions.items.length - versions.items.indexOf(version)} onPick={(sha) => versions.onSelect(sha, null)} /> : null}
        {point(0)}
        {loading && !ordered.length ? <Typography color="textSecondary" sx={{ alignSelf: 'center', px: 1 }} variant="caption">{t('review.changes.loadingCommits')}</Typography> : steps.map((_, index) => [step(index), point(index + 1)])}
      </Row></Box>
      {scrollable ? <Tooltip title={t('review.changes.scrollLeftTooltip')}><span><IconButton aria-label={t('review.changes.scrollLeft')} disabled={!overflow.left} onClick={() => scrollBy(-1)}><ChevronLeftRoundedIcon /></IconButton></span></Tooltip> : null}
      {scrollable ? <Tooltip title={t('review.changes.scrollRightTooltip')}><span><IconButton aria-label={t('review.changes.scrollRight')} disabled={!overflow.right} onClick={() => scrollBy(1)}><ChevronRightRoundedIcon /></IconButton></span></Tooltip> : null}
    </Row>
    <Row spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      <Button aria-pressed={whole} color="inherit" onClick={() => onSelect(null)} size="small" sx={item(whole)}>{t('review.changes.wholeMr')}</Button>
      <Typography color="textSecondary" variant="caption">
        {selected ? t('review.changes.showingCommit') : t('review.changes.showing')} <Box component="span" sx={{ color: 'text.primary', fontFamily: 'code.fontFamily', verticalAlign: 'top' }}>{selected ? shortSha(selected) : `${fromName} → ${toName}`}</Box>
        {/* The row shortens a long title; the commit shown has it in full here. */}
        {selectedTitle ? <Box component="span" sx={{ color: 'text.primary', ml: 1 }}>{selectedTitle}</Box> : null}
      </Typography>
      {versions.error && !versions.items.length ? <Typography color="error" variant="caption">{t('review.versions.error', { message: versions.error.message })}</Typography> : null}
    </Row>
    {selected ? <Typography color="textSecondary" role="note" variant="caption">{t('review.changes.commitNote')}</Typography> : null}
    {showingLocal ? <Typography color="textSecondary" role="note" variant="caption">{t('review.changes.localNote')}</Typography> : null}
    {versions.compareFrom && !selected ? <Typography color="textSecondary" role="note" variant="caption">{t('review.changes.rangeNote')}</Typography> : null}
  </Stack>
}

/** Versions whose head is not on the row (pushed before a rebase), as a start for the range. */
function RebasedVersions({ active, items, more, numberOf, onPick }: { active: boolean; items: MrVersion[]; more: boolean; numberOf: (version: MrVersion) => number | null; onPick: (sha: string) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return <Box sx={{ alignSelf: 'center', flexShrink: 0, mr: 1, position: 'relative' }}>
    {active ? <Box component="span" sx={{ bottom: '100%', color: 'primary.main', fontSize: 'caption.fontSize', fontWeight: 600, left: '50%', lineHeight: 1.4, mb: 0.25, position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{t('review.changes.rangeStart')}</Box> : null}
    <Button aria-haspopup="menu" aria-pressed={active} color="inherit" data-commit-item endIcon={<ExpandMoreRoundedIcon />} onClick={(event) => setAnchor(event.currentTarget)} size="small" sx={{ bgcolor: active ? 'surface.selected' : 'transparent', borderRadius: 1, color: active ? 'text.primary' : 'text.secondary', ...frame({ color: active ? 'primary.main' : 'divider' }) }} tabIndex={-1}>{t('review.changes.rebasedVersions')}</Button>
    <Menu anchorEl={anchor} onClose={() => setAnchor(null)} open={Boolean(anchor)}>
      {items.map((version) => {
        const at = numberOf(version)
        const values = { sha: shortSha(version.headCommitSha), time: formatVersionTime(version.createdAt) }
        return <MenuItem key={version.id} onClick={() => { setAnchor(null); onPick(version.headCommitSha) }}>{at ? t('review.versions.optionNumbered', { ...values, number: at }) : t('review.versions.option', values)}</MenuItem>
      })}
      {more ? <MenuItem disabled>{t('review.versions.older')}</MenuItem> : null}
    </Menu>
  </Box>
}

function formatVersionTime(value: string): string {
  const time = Date.parse(value)
  return Number.isNaN(time) ? translate('review.versions.unknownTime') : new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'numeric' }).format(time)
}
