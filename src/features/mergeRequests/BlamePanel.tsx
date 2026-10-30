import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { formatAbsoluteTime, shortSha } from '../../lib/format'
import { commitUrl, openGitLabUrl } from '../../lib/gitlab'
import type { BlameBlock, BlameQuery, CommitMergeRequestsQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { blameAttributions, blameWindowStart, BLAME_WINDOW, type BlameAttribution } from './blameLines'
import { MAX_HISTORY_LINES, type HistoryCursor, type LineRange } from './lineHistory'
import { useT } from '../../i18n/useT'

type Side = 'old' | 'new'
/** Windows read at once; the rest wait, so a long file does not send every read together. */
const MAX_LOADING_WINDOWS = 3

interface WindowResult { data: BlameBlock[] | null; failed: boolean; refresh: () => void }
type CellState =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'failed'; retry: () => void }
  | { kind: 'empty' }
  | { kind: 'ready'; attribution: BlameAttribution }
interface BlameContextValue {
  cell: (side: Side, line: number) => CellState
  /** Asks for the blame of the window holding `line`; a cell asks for its own line when shown. */
  want: (side: Side, line: number) => void
  select: (side: Side, line: number, attribution: BlameAttribution, anchorEl: HTMLElement) => void
}
const BlameContext = createContext<BlameContextValue | null>(null)

const windowKey = (side: Side, start: number) => `${side}:${start}`

/** Fetch only when the user enables Blame, for the lines shown. Each side uses the correct
 * Git SHA and file path; the code itself is rendered exclusively by the diff viewer. */
export function BlameProvider({ beforeSha, children, enabled = true, newPath, oldPath, onHistory, projectId, projectUrl, selectedLines, sessionId, sha }: {
  beforeSha?: string
  children: ReactNode
  /** Keeps the file subtree mounted when the Blame toggle changes. */
  enabled?: boolean
  newPath: string
  oldPath: string
  /** Opens the history of lines; without it the popover does not offer it. */
  onHistory?: (start: HistoryCursor) => void
  projectId: string
  /** The project's GitLab page, for opening a commit there. */
  projectUrl?: string
  /** The lines chosen in the view, offered as a range to follow. */
  selectedLines?: { side: Side; range: LineRange }
  sessionId: string
  sha: string
}) {
  const t = useT()
  // Windows in the order they were asked for; the earliest are read first.
  const [wanted, setWanted] = useState<string[]>([])
  const wantedKeys = useRef(new Set<string>())
  const [results, setResults] = useState<Readonly<Record<string, WindowResult>>>({})
  const [selection, setSelection] = useState<{ anchor: HTMLElement; block: BlameBlock; line: number; side: Side } | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const want = useCallback((side: Side, line: number) => {
    if (side === 'old' && !beforeSha) return
    const key = windowKey(side, blameWindowStart(line))
    if (wantedKeys.current.has(key)) return
    wantedKeys.current.add(key)
    setWanted((current) => [...current, key])
  }, [beforeSha])
  const report = useCallback((key: string, result: WindowResult) => {
    setResults((current) => {
      const previous = current[key]
      if (previous && previous.data === result.data && previous.failed === result.failed && previous.refresh === result.refresh) return current
      return { ...current, [key]: result }
    })
  }, [])

  const reading = useMemo(() => {
    const active: string[] = []
    let waiting = 0
    for (const key of wanted) {
      const result = results[key]
      if (result?.data || result?.failed) active.push(key)
      else if (waiting < MAX_LOADING_WINDOWS) {
        active.push(key)
        waiting += 1
      }
    }
    return active
  }, [results, wanted])

  // One map per side across the windows read; a run is marked where its commit starts on screen.
  const maps = useMemo(() => {
    const merged = { new: new Map<number, BlameAttribution>(), old: new Map<number, BlameAttribution>() }
    for (const key of wanted) {
      const data = results[key]?.data
      if (!data) continue
      const [side, start] = key.split(':')
      for (const [line, attribution] of blameAttributions(data, Number(start))) merged[side as Side].set(line, attribution)
    }
    for (const map of [merged.new, merged.old]) {
      for (const [line, attribution] of map) {
        const first = map.get(line - 1)?.block.commitId !== attribution.block.commitId
        if (first !== attribution.first) map.set(line, { ...attribution, first })
      }
    }
    return merged
  }, [results, wanted])

  const relatedQuery: CommitMergeRequestsQuery | null = enabled && selection
    ? { kind: 'commitMergeRequests', projectId, sha: selection.block.commitId }
    : null
  const related = useGitLabQuery(sessionId, relatedQuery)

  const value = useMemo<BlameContextValue>(() => ({
    cell: (side, line) => {
      if (side === 'old' && !beforeSha) return { kind: 'unavailable' }
      const attribution = maps[side].get(line)
      if (attribution) return { attribution, kind: 'ready' }
      const result = results[windowKey(side, blameWindowStart(line))]
      if (result?.failed) return { kind: 'failed', retry: result.refresh }
      return result?.data ? { kind: 'empty' } : { kind: 'loading' }
    },
    select: (side, line, attribution, anchor) => {
      setSelection({ anchor, block: attribution.block, line, side })
      setOpenError(null)
    },
    want,
  }), [beforeSha, maps, results, want])

  const followFrom = (range: LineRange) => {
    if (!selection || !onHistory) return
    const old = selection.side === 'old'
    const revision = old ? beforeSha : sha
    if (!revision) return
    setSelection(null)
    onHistory({ path: old ? oldPath : newPath, range, sha: revision })
  }
  // The lines this commit wrote around the selected one, as far as the blame read shows them.
  const commitRun = (() => {
    if (!selection) return null
    const map = maps[selection.side]
    let start = selection.line
    let end = selection.line
    while (end - start + 1 < MAX_HISTORY_LINES && map.get(start - 1)?.block.commitId === selection.block.commitId) start -= 1
    while (end - start + 1 < MAX_HISTORY_LINES && map.get(end + 1)?.block.commitId === selection.block.commitId) end += 1
    return { end, start }
  })()
  const chosen = selection && selectedLines?.side === selection.side && (selectedLines.range.start !== selectedLines.range.end) ? selectedLines.range : null
  const open = (url: string) => {
    setOpenError(null)
    void openGitLabUrl(sessionId, url).catch((error: unknown) => setOpenError(error instanceof Error ? error.message : t('review.blame.openError')))
  }

  return <BlameContext.Provider value={value}>
    {children}
    {enabled ? reading.map((key) => {
      const [side, start] = key.split(':')
      const path = side === 'old' ? oldPath : newPath
      const revision = side === 'old' ? beforeSha : sha
      return revision && path ? <BlameWindow id={key} key={key} onResult={report} query={{ kind: 'blame', projectId, path, sha: revision, startLine: Number(start), endLine: Number(start) + BLAME_WINDOW - 1 }} sessionId={sessionId} /> : null
    }) : null}
    <Popover anchorEl={selection?.anchor} anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }} onClose={() => setSelection(null)} open={enabled && Boolean(selection)} slotProps={{ paper: { sx: { maxWidth: 440, p: 1.5, width: 'min(440px, calc(100vw - 24px))' } } }}>
      {selection ? <Box aria-label={t('review.blame.details')} role="dialog">
        <Stack spacing={1}>
          <Typography sx={{ fontWeight: 700 }} variant="subtitle2">{shortSha(selection.block.commitId)} · {selection.block.authorName || t('review.blame.unknownAuthor')}</Typography>
          <Typography color="textSecondary" variant="caption">{t(selection.side === 'old' ? 'review.blame.oldLine' : 'review.blame.newLine', { line: String(selection.line), time: selection.block.committedAt ? formatAbsoluteTime(selection.block.committedAt) : t('review.blame.unknownTime') })}</Typography>
          <Typography sx={{ overflowWrap: 'anywhere' }} variant="body2">{selection.block.title || t('review.blame.noMessage')}</Typography>
          {onHistory ? <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
            <Typography color="textSecondary" variant="caption">{t('review.blame.followHeading')}</Typography>
            <Button onClick={() => followFrom({ end: selection.line, start: selection.line })} size="small" variant="outlined">{t('review.blame.historyLine', { line: String(selection.line) })}</Button>
            {commitRun && commitRun.end > commitRun.start ? <Button onClick={() => followFrom(commitRun)} size="small" variant="outlined">{t('review.blame.historyRun', { start: String(commitRun.start), end: String(commitRun.end) })}</Button> : null}
            {chosen ? <Button onClick={() => followFrom(chosen)} size="small" variant="outlined">{t('review.blame.historySelected', { start: String(chosen.start), end: String(chosen.end) })}</Button> : null}
          </Stack> : null}
          {projectUrl ? <Button onClick={() => open(commitUrl(projectUrl, selection.block.commitId))} size="small" sx={{ alignSelf: 'flex-start' }}>{t('review.blame.openCommit')}</Button> : null}
          <Divider />
          <Typography color="textSecondary" variant="caption">{t('review.blame.relatedMrs')}</Typography>
          {related.loading && !related.data ? <Typography variant="caption">{t('review.blame.loading')}</Typography> : null}
          {related.error ? <Alert severity="warning">{t('review.blame.relatedError', { message: related.error.message })}</Alert> : null}
          {related.data?.length === 0 ? <Typography color="textSecondary" variant="caption">{t('review.blame.noRelated')}</Typography> : null}
          {(related.data ?? []).map((mr) => <Button key={`${mr.projectId}:${mr.iid}`} onClick={() => open(mr.webUrl)} size="small" sx={{ alignSelf: 'flex-start', justifyContent: 'flex-start', textAlign: 'left' }}>!{mr.iid} {mr.title}</Button>)}
          {openError ? <Alert severity="warning">{openError}</Alert> : null}
        </Stack>
      </Box> : null}
    </Popover>
  </BlameContext.Provider>
}

/** Reads one window of blame and hands it to the provider. */
function BlameWindow({ id, onResult, query, sessionId }: { id: string; onResult: (id: string, result: WindowResult) => void; query: BlameQuery; sessionId: string }) {
  const result = useGitLabQuery(sessionId, query)
  const failed = Boolean(result.error) && !result.data
  useEffect(() => {
    onResult(id, { data: result.data, failed, refresh: result.refresh })
  }, [failed, id, onResult, result.data, result.refresh])
  return null
}

/** A narrow gutter within the actual diff row, not a second code viewer. Every line names its
 * commit, so a hunk that starts inside a run still shows whose lines it holds; the first line
 * of a run is drawn in full and the rest are muted. */
export function BlameCell({ line, side }: { line?: number; side: Side }) {
  const t = useT()
  const context = useContext(BlameContext)
  const want = context?.want
  useEffect(() => {
    if (want && line !== undefined) want(side, line)
  }, [line, side, want])
  if (!context || line === undefined) return <span className="blame-cell" />
  const state = context.cell(side, line)
  if (state.kind === 'unavailable') return <span aria-label={t('review.blame.noHistory')} className="blame-cell"><span className="blame-status">—</span></span>
  if (state.kind === 'loading') return <span aria-busy="true" className="blame-cell" data-side={side}><span className="blame-status" title={t('review.blame.loading')}>…</span></span>
  if (state.kind === 'empty') return <span className="blame-cell" data-side={side}><span className="blame-status">—</span></span>
  if (state.kind === 'failed') {
    return <span className="blame-cell" data-side={side}>
      <button aria-label={t('review.blame.retry', { line: String(line) })} className="blame-action" onClick={(event) => {
        event.stopPropagation()
        state.retry()
      }} title={t('review.blame.failed')} type="button"><span className="blame-sha">!</span></button>
    </span>
  }
  const { attribution } = state
  const { block } = attribution
  return <span className="blame-cell" data-first={attribution.first ? 'true' : undefined} data-side={side}>
    <button aria-label={t('review.blame.lineLabel', { line: String(line), sha: shortSha(block.commitId), author: block.authorName })} className="blame-action" data-continued={attribution.first ? undefined : 'true'} onClick={(event) => {
      event.stopPropagation()
      context.select(side, line, attribution, event.currentTarget)
    }} title={`${shortSha(block.commitId)} · ${block.authorName} · ${block.committedAt ? formatAbsoluteTime(block.committedAt) : ''}\n${block.title}`} type="button">
      <span className="blame-sha">{shortSha(block.commitId)}</span>
      <span className="blame-author">{block.authorName}</span>
    </button>
  </span>
}
