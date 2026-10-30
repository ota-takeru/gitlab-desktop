import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useT } from '../../i18n/useT'
import { formatAbsoluteTime, shortSha } from '../../lib/format'
import { commitUrl, normalizeGitLabError, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import type { BlameQuery, CommitDiffQuery, CommitMergeRequestsQuery, GitLabQuery, GitLabQueryData } from '../../types/gitlab'
import { hairline } from '../../components/hairline'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import type { ParsedLine } from './diffParser'
import { historyStep, isFollowedLine, MAX_HISTORY_LINES, type HistoryCursor, type HistoryFetchers, type HistoryStep, type HistoryStop } from './lineHistory'
import { Row } from '../../components/Row'

interface HistoryState {
  steps: HistoryStep[]
  loading: boolean
  stop: HistoryStop | null
  error: string | null
}

/** Steps read one after another without asking, so a few clicks reach far back. */
export const AUTO_STEPS = 5

/** A commit's blame and diff never change, so the stored copy is used when there is one. */
async function readOnce<Q extends GitLabQuery>(sessionId: string, query: Q, usable: (data: GitLabQueryData<Q>) => boolean = () => true): Promise<GitLabQueryData<Q>> {
  const cached = await queryGitLab({ mode: 'cache', query, sessionId }).catch(() => null)
  if (cached && usable(cached.data)) return cached.data
  const fresh = await queryGitLab({ mode: 'network', query, sessionId })
  if (!fresh) throw new Error('empty response')
  return fresh.data
}

function useLineHistory(sessionId: string, projectId: string, iid: string | undefined, start: HistoryCursor) {
  const [state, setState] = useState<HistoryState>({ error: null, loading: true, steps: [], stop: null })
  const run = useRef(0)
  const fetchers = useMemo<HistoryFetchers>(() => ({
    // Blame stored before the app kept parent commits has to be read again.
    blame: (sha, path, startLine, endLine) => readOnce<BlameQuery>(sessionId, { endLine, kind: 'blame', path, projectId, sha, startLine }, (blocks) => blocks.every((block) => block.parentIds !== undefined)),
    commitDiff: (sha, page) => readOnce<CommitDiffQuery>(sessionId, { ...(iid ? { iid } : {}), kind: 'commitDiff', page, projectId, sha }),
  }), [iid, projectId, sessionId])
  /** Reads up to `count` steps from `cursor`, showing each as it arrives; the caller has shown it as loading. */
  const read = useCallback((cursor: HistoryCursor, steps: HistoryStep[], count: number) => {
    const current = ++run.current
    const readStep = (at: HistoryCursor, before: HistoryStep[], left: number) => {
      historyStep(at, fetchers).then((result) => {
        if (current !== run.current) return
        if (!('commit' in result)) {
          setState({ error: null, loading: false, steps: before, stop: result.stop })
          return
        }
        const after = [...before, result]
        const next = left > 1 && !result.stop ? result.next : null
        setState({ error: null, loading: Boolean(next), steps: after, stop: result.stop ?? null })
        if (next) readStep(next, after, left - 1)
      }, (caught: unknown) => {
        if (current !== run.current) return
        setState({ error: normalizeGitLabError(caught).message, loading: false, steps: before, stop: null })
      })
    }
    readStep(cursor, steps, count)
  }, [fetchers])
  const load = (cursor: HistoryCursor, steps: HistoryStep[]) => {
    setState({ error: null, loading: true, steps, stop: null })
    read(cursor, steps, AUTO_STEPS)
  }
  // The view is keyed by its start, so the first steps are read once, on mount.
  const first = useRef(start)
  useEffect(() => {
    read(first.current, [], AUTO_STEPS)
    return () => { run.current += 1 }
  }, [read])
  /** Where the next step is read from: after the last step, or the start. */
  const pending = state.steps.length ? state.steps.at(-1)!.next : start
  return {
    ...state,
    canLoadMore: Boolean(pending) && !state.loading && !state.stop && !state.error,
    /** Follows `cursor` instead, after the first `keep` steps. */
    follow: (cursor: HistoryCursor, keep: number) => load(cursor, state.steps.slice(0, keep)),
    loadMore: () => { if (pending) load(pending, state.steps) },
    pending,
    retry: () => { if (pending) load(pending, state.steps) },
  }
}

/** The lines the range form follows: from a revision, after the steps that led there. */
interface RangeBase { cursor: HistoryCursor; keep: number }

/** Where the followed lines came from, commit by commit, as `git log -L` shows them. */
export function LineHistoryView({ closeLabel, iid, onClose, onRestart, projectId, projectUrl, sessionId, start }: {
  /** The close button's text; it returns to the diff by default. */
  closeLabel?: string
  /** The MR the commits are read for; a repository file has none. */
  iid?: string
  onClose: () => void
  /** Follows other lines of the starting revision instead. */
  onRestart: (cursor: HistoryCursor) => void
  projectId: string
  /** The project's GitLab page, for opening a commit there. */
  projectUrl?: string
  sessionId: string
  start: HistoryCursor
}) {
  const t = useT()
  const history = useLineHistory(sessionId, projectId, iid, start)
  const [selected, setSelected] = useState(0)
  const [base, setBase] = useState<RangeBase>({ cursor: start, keep: 0 })
  const [rangeDraft, setRangeDraft] = useState({ start: String(start.range.start), end: String(start.range.end) })
  const listRef = useRef<HTMLDivElement>(null)
  const startFieldRef = useRef<HTMLInputElement>(null)
  const selectedIndex = Math.min(selected, Math.max(0, history.steps.length - 1))
  const step = history.steps[selectedIndex]
  const draftStart = Number(rangeDraft.start)
  const draftEnd = Number(rangeDraft.end)
  const draftValid = Number.isSafeInteger(draftStart) && Number.isSafeInteger(draftEnd) && draftStart >= 1 && draftEnd >= draftStart && draftEnd - draftStart < MAX_HISTORY_LINES
  const fromStart = base.keep === 0 && base.cursor === start

  const moveSelection = (event: React.KeyboardEvent, index: number) => {
    const target = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : -1
    if (target < 0 || target >= history.steps.length) return
    event.preventDefault()
    setSelected(target)
    listRef.current?.querySelector<HTMLElement>(`[data-step="${target}"]`)?.focus()
  }
  /** Lets the range form follow other lines of `cursor`, after the first `keep` steps. */
  const editRangeFrom = (cursor: HistoryCursor, keep: number) => {
    setBase({ cursor, keep })
    setRangeDraft({ start: String(cursor.range.start), end: String(cursor.range.end) })
    startFieldRef.current?.focus()
    startFieldRef.current?.select()
  }

  return <Box aria-label={t('review.history.label', { path: start.path })} role="region" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <Row spacing={1} useFlexGap sx={{ ...hairline('bottom'), flexWrap: 'wrap', px: 1.5, py: 1 }}>
      <Stack sx={{ minWidth: 0, mr: 'auto' }}>
        <Typography sx={{ fontWeight: 600 }} variant="body2">{t('review.history.title', { start: String(start.range.start), end: String(start.range.end) })}</Typography>
        <Typography color={fromStart ? 'textSecondary' : 'primary'} sx={{ overflowWrap: 'anywhere' }} variant="caption">
          {fromStart ? t('review.history.base.start', { path: start.path }) : t('review.history.base.commit', { path: base.cursor.path, sha: shortSha(base.cursor.sha) })}
        </Typography>
      </Stack>
      <Row component="form" spacing={1} onSubmit={(event) => {
        event.preventDefault()
        if (!draftValid) return
        const cursor = { ...base.cursor, range: { start: draftStart, end: draftEnd } }
        if (fromStart) {
          onRestart(cursor)
          return
        }
        setSelected(base.keep)
        history.follow(cursor, base.keep)
      }}>
        <TextField label={t('review.history.rangeStart')} onChange={(event) => setRangeDraft((draft) => ({ ...draft, start: event.target.value }))} size="small" sx={{ width: 96 }} value={rangeDraft.start} slotProps={{ htmlInput: { inputMode: 'numeric', ref: startFieldRef } }} />
        <TextField label={t('review.history.rangeEnd')} onChange={(event) => setRangeDraft((draft) => ({ ...draft, end: event.target.value }))} size="small" sx={{ width: 96 }} value={rangeDraft.end} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
        <Button disabled={!draftValid} size="small" type="submit" variant="outlined">{t('review.history.restart')}</Button>
        {fromStart ? null : <Button onClick={() => editRangeFrom(start, 0)} size="small">{t('review.history.base.reset')}</Button>}
      </Row>
      <Button onClick={onClose} size="small" variant="outlined">{closeLabel ?? t('review.history.close')}</Button>
    </Row>
    <Stack direction={{ xs: 'column', md: 'row' }} sx={{ minHeight: 0 }}>
      <Box ref={listRef} aria-label={t('review.history.steps')} role="list" sx={{ ...hairline('right'), flexShrink: 0, width: { xs: '100%', md: 280 } }}>
        {history.steps.map((item, index) => {
          const moved = index > 0 && (item.range.start !== history.steps[index - 1].before?.start || item.range.end !== history.steps[index - 1].before?.end)
          const changedRange = index === 0 ? item.range.start !== start.range.start || item.range.end !== start.range.end : moved
          return <Box key={`${item.commit.commitId}:${index}`} role="listitem">
            <Box
              aria-current={index === selectedIndex ? 'true' : undefined}
              component="button"
              data-step={index}
              onClick={() => setSelected(index)}
              onKeyDown={(event: React.KeyboardEvent) => moveSelection(event, index)}
              sx={{ bgcolor: index === selectedIndex ? 'action.selected' : 'transparent', border: 0, ...hairline('bottom'), color: 'text.primary', cursor: 'pointer', display: 'block', font: 'inherit', px: 1.5, py: 1, textAlign: 'left', width: '100%', '&:hover': { bgcolor: 'action.hover' } }}
              type="button"
            >
              <Typography noWrap sx={{ fontWeight: 600 }} variant="body2">{item.commit.title || t('review.blame.noMessage')}</Typography>
              <Typography color="textSecondary" component="div" noWrap variant="caption"><Box component="span" sx={{ fontFamily: 'code.fontFamily' }}>{shortSha(item.commit.commitId)}</Box> · {item.commit.authorName || t('review.blame.unknownAuthor')} · {item.commit.committedAt ? formatAbsoluteTime(item.commit.committedAt) : t('review.blame.unknownTime')}</Typography>
              {changedRange ? <Typography color="primary" component="div" variant="caption">{t('review.history.rangeAt', { start: String(item.range.start), end: String(item.range.end) })}</Typography> : null}
            </Box>
          </Box>
        })}
        <Stack spacing={1} sx={{ px: 1.5, py: 1 }}>
          {history.loading ? <Typography color="textSecondary" role="status" variant="caption">{t('review.history.loading')}</Typography> : null}
          {history.error ? <Alert action={<Button color="inherit" onClick={history.retry} size="small">{t('review.history.retry')}</Button>} severity="warning">{t('review.history.error', { message: history.error })}</Alert> : null}
          {history.stop ? <Typography color="textSecondary" role="status" variant="caption">{t(`review.history.stop.${history.stop}`)}</Typography> : null}
          {history.stop === 'tooWide' && history.pending ? <Button onClick={() => editRangeFrom(history.pending!, history.steps.length)} size="small" sx={{ alignSelf: 'flex-start' }} variant="outlined">{t('review.history.narrow', { start: String(history.pending.range.start), end: String(history.pending.range.end) })}</Button> : null}
          {history.canLoadMore && history.steps.length ? <Button onClick={() => {
            // The first step asked for is shown as soon as it arrives.
            setSelected(history.steps.length)
            history.loadMore()
          }} size="small" sx={{ alignSelf: 'flex-start' }} variant="outlined">{t('review.history.older')}</Button> : null}
        </Stack>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {step ? <StepDetail onEditRange={() => editRangeFrom({ path: step.path, range: step.range, sha: step.commit.commitId }, selectedIndex)} projectId={projectId} projectUrl={projectUrl} sessionId={sessionId} step={step} /> : null}
      </Box>
    </Stack>
  </Box>
}

function StepDetail({ onEditRange, projectId, projectUrl, sessionId, step }: { onEditRange: () => void; projectId: string; projectUrl?: string; sessionId: string; step: HistoryStep }) {
  const t = useT()
  const relatedQuery = useMemo<CommitMergeRequestsQuery>(() => ({ kind: 'commitMergeRequests', projectId, sha: step.commit.commitId }), [projectId, step.commit.commitId])
  const related = useGitLabQuery(sessionId, relatedQuery)
  const [openError, setOpenError] = useState<string | null>(null)
  const open = (url: string) => {
    setOpenError(null)
    void openGitLabUrl(sessionId, url).catch((error: unknown) => setOpenError(error instanceof Error ? error.message : t('review.blame.openError')))
  }
  return <Stack spacing={1} sx={{ p: 1.5 }}>
    <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body2">{step.commit.title || t('review.blame.noMessage')}</Typography>
    <Typography color="textSecondary" variant="caption"><Box component="span" sx={{ fontFamily: 'code.fontFamily' }}>{shortSha(step.commit.commitId)}</Box> · {step.commit.authorName || t('review.blame.unknownAuthor')} · {step.commit.committedAt ? formatAbsoluteTime(step.commit.committedAt) : t('review.blame.unknownTime')}</Typography>
    <Typography color="textSecondary" sx={{ fontFamily: 'code.fontFamily', overflowWrap: 'anywhere' }} variant="caption">{t('review.history.where', { path: step.path, start: String(step.range.start), end: String(step.range.end) })}</Typography>
    <Row spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {projectUrl ? <Button onClick={() => open(commitUrl(projectUrl, step.commit.commitId))} size="small" variant="outlined">{t('review.blame.openCommit')}</Button> : null}
      <Button onClick={onEditRange} size="small">{t('review.history.editRange')}</Button>
    </Row>
    {related.data?.length ? <Stack sx={{ alignItems: 'flex-start' }}>
      <Typography color="textSecondary" variant="caption">{t('review.blame.relatedMrs')}</Typography>
      {related.data.map((mr) => <Button key={`${mr.projectId}:${mr.iid}`} onClick={() => open(mr.webUrl)} size="small" sx={{ justifyContent: 'flex-start', textAlign: 'left' }}>!{mr.iid} {mr.title}</Button>)}
    </Stack> : null}
    {openError ? <Alert severity="warning">{openError}</Alert> : null}
    {step.segments.length ? null : <Typography color="textSecondary" variant="body2">{t('review.history.noSegments')}</Typography>}
    {step.segments.map((segment, index) => <StepSegment key={index} lines={segment} step={step} />)}
  </Stack>
}

/** One hunk part in the diff viewer's code style; the followed lines carry the accent bar. */
function StepSegment({ lines, step }: { lines: ParsedLine[]; step: HistoryStep }) {
  const t = useT()
  return <Box aria-label={t('review.history.change')} component="figure" role="group" sx={{ borderRadius: 1, m: 0, overflow: 'hidden', ...hairline(['top', 'right', 'bottom', 'left']) }}>
    {lines.map((line, index) => <Box
      data-followed={isFollowedLine(line, step) ? 'true' : undefined}
      data-kind={line.kind}
      key={`${line.oldLine ?? ''}:${line.newLine ?? ''}:${index}`}
      sx={(theme) => ({
        color: 'text.primary',
        display: 'grid',
        fontFamily: 'code.fontFamily',
        fontSize: 'code.fontSize',
        gridTemplateColumns: '44px 44px 16px minmax(0, 1fr)',
        lineHeight: '20px',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
        '&[data-kind="add"]': { bgcolor: theme.palette.diff?.addedBackground, '& .history-prefix': { color: theme.palette.diff?.addedText } },
        '&[data-kind="remove"]': { bgcolor: theme.palette.diff?.deletedBackground, '& .history-prefix': { color: theme.palette.diff?.deletedText } },
        '&[data-followed="true"]': { boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` },
      })}
    >
      <Box component="span" sx={{ color: 'text.secondary', px: 0.5, textAlign: 'right', userSelect: 'none' }}>{line.oldLine ?? ''}</Box>
      <Box component="span" sx={{ color: 'text.secondary', px: 0.5, textAlign: 'right', userSelect: 'none' }}>{line.newLine ?? ''}</Box>
      <Box aria-hidden className="history-prefix" component="span">{line.prefix}</Box>
      <Box component="span" sx={{ pr: 1 }}>{line.text}</Box>
    </Box>)}
  </Box>
}
