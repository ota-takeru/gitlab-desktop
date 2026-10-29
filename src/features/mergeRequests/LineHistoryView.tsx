import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useT } from '../../i18n/useT'
import { formatAbsoluteTime, shortSha } from '../../lib/format'
import { normalizeGitLabError, queryGitLab } from '../../lib/gitlab'
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

/** A commit's blame and diff never change, so the stored copy is used when there is one. */
async function readOnce<Q extends GitLabQuery>(sessionId: string, query: Q, usable: (data: GitLabQueryData<Q>) => boolean = () => true): Promise<GitLabQueryData<Q>> {
  const cached = await queryGitLab({ mode: 'cache', query, sessionId }).catch(() => null)
  if (cached && usable(cached.data)) return cached.data
  const fresh = await queryGitLab({ mode: 'network', query, sessionId })
  if (!fresh) throw new Error('empty response')
  return fresh.data
}

function useLineHistory(sessionId: string, projectId: string, iid: string, start: HistoryCursor) {
  const [state, setState] = useState<HistoryState>({ error: null, loading: true, steps: [], stop: null })
  const run = useRef(0)
  const fetchers = useMemo<HistoryFetchers>(() => ({
    // Blame stored before the app kept parent commits has to be read again.
    blame: (sha, path, startLine, endLine) => readOnce<BlameQuery>(sessionId, { endLine, kind: 'blame', path, projectId, sha, startLine }, (blocks) => blocks.every((block) => block.parentIds !== undefined)),
    commitDiff: (sha, page) => readOnce<CommitDiffQuery>(sessionId, { iid, kind: 'commitDiff', page, projectId, sha }),
  }), [iid, projectId, sessionId])
  /** Reads one step; the caller has shown it as loading. */
  const read = useCallback((cursor: HistoryCursor, steps: HistoryStep[]) => {
    const current = ++run.current
    historyStep(cursor, fetchers).then((result) => {
      if (current !== run.current) return
      if ('commit' in result) setState({ error: null, loading: false, steps: [...steps, result], stop: result.stop ?? null })
      else setState({ error: null, loading: false, steps, stop: result.stop })
    }, (caught: unknown) => {
      if (current !== run.current) return
      setState({ error: normalizeGitLabError(caught).message, loading: false, steps, stop: null })
    })
  }, [fetchers])
  const load = (cursor: HistoryCursor, steps: HistoryStep[]) => {
    setState({ error: null, loading: true, steps, stop: null })
    read(cursor, steps)
  }
  // The view is keyed by its start, so the first step is read once, on mount.
  const first = useRef(start)
  useEffect(() => {
    read(first.current, [])
    return () => { run.current += 1 }
  }, [read])
  const next = state.steps.at(-1)?.next ?? null
  const loadMore = () => { if (next) load(next, state.steps) }
  return { ...state, canLoadMore: Boolean(next) && !state.loading && !state.stop, loadMore, retry: () => load(state.steps.at(-1)?.next ?? start, state.steps) }
}

/** Where the followed lines came from, commit by commit, as `git log -L` shows them. */
export function LineHistoryView({ iid, onClose, onRestart, projectId, sessionId, start }: {
  iid: string
  onClose: () => void
  /** Follows other lines of the starting revision instead. */
  onRestart: (cursor: HistoryCursor) => void
  projectId: string
  sessionId: string
  start: HistoryCursor
}) {
  const t = useT()
  const history = useLineHistory(sessionId, projectId, iid, start)
  const [selected, setSelected] = useState(0)
  const [rangeDraft, setRangeDraft] = useState({ start: String(start.range.start), end: String(start.range.end) })
  const listRef = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.min(selected, Math.max(0, history.steps.length - 1))
  const step = history.steps[selectedIndex]
  const draftStart = Number(rangeDraft.start)
  const draftEnd = Number(rangeDraft.end)
  const draftValid = Number.isSafeInteger(draftStart) && Number.isSafeInteger(draftEnd) && draftStart >= 1 && draftEnd >= draftStart && draftEnd - draftStart < MAX_HISTORY_LINES

  const moveSelection = (event: React.KeyboardEvent, index: number) => {
    const target = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : -1
    if (target < 0 || target >= history.steps.length) return
    event.preventDefault()
    setSelected(target)
    listRef.current?.querySelector<HTMLElement>(`[data-step="${target}"]`)?.focus()
  }

  return <Box aria-label={t('review.history.label', { path: start.path })} role="region" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <Row spacing={1} useFlexGap sx={{ ...hairline('bottom'), flexWrap: 'wrap', px: 1.5, py: 1 }}>
      <Typography sx={{ fontWeight: 600, mr: 'auto' }} variant="body2">{t('review.history.title', { start: String(start.range.start), end: String(start.range.end) })}</Typography>
      <Row component="form" spacing={1} onSubmit={(event) => {
        event.preventDefault()
        if (draftValid) onRestart({ ...start, range: { start: draftStart, end: draftEnd } })
      }}>
        <TextField label={t('review.history.rangeStart')} onChange={(event) => setRangeDraft((draft) => ({ ...draft, start: event.target.value }))} size="small" sx={{ width: 96 }} value={rangeDraft.start} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
        <TextField label={t('review.history.rangeEnd')} onChange={(event) => setRangeDraft((draft) => ({ ...draft, end: event.target.value }))} size="small" sx={{ width: 96 }} value={rangeDraft.end} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
        <Button disabled={!draftValid} size="small" type="submit" variant="outlined">{t('review.history.restart')}</Button>
      </Row>
      <Button onClick={onClose} size="small" variant="outlined">{t('review.history.close')}</Button>
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
          {history.canLoadMore ? <Button onClick={() => {
            // The step asked for is shown as soon as it arrives.
            setSelected(history.steps.length)
            history.loadMore()
          }} size="small" sx={{ alignSelf: 'flex-start' }} variant="outlined">{t('review.history.older')}</Button> : null}
        </Stack>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {step ? <StepDetail projectId={projectId} sessionId={sessionId} step={step} /> : null}
      </Box>
    </Stack>
  </Box>
}

function StepDetail({ projectId, sessionId, step }: { projectId: string; sessionId: string; step: HistoryStep }) {
  const t = useT()
  const relatedQuery = useMemo<CommitMergeRequestsQuery>(() => ({ kind: 'commitMergeRequests', projectId, sha: step.commit.commitId }), [projectId, step.commit.commitId])
  const related = useGitLabQuery(sessionId, relatedQuery)
  return <Stack spacing={1} sx={{ p: 1.5 }}>
    <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body2">{step.commit.title || t('review.blame.noMessage')}</Typography>
    <Typography color="textSecondary" variant="caption"><Box component="span" sx={{ fontFamily: 'code.fontFamily' }}>{shortSha(step.commit.commitId)}</Box> · {step.commit.authorName || t('review.blame.unknownAuthor')} · {step.commit.committedAt ? formatAbsoluteTime(step.commit.committedAt) : t('review.blame.unknownTime')}</Typography>
    <Typography color="textSecondary" sx={{ fontFamily: 'code.fontFamily', overflowWrap: 'anywhere' }} variant="caption">{t('review.history.where', { path: step.path, start: String(step.range.start), end: String(step.range.end) })}</Typography>
    {related.data?.length ? <Typography color="textSecondary" variant="caption">{t('review.blame.relatedMrs')}: {related.data.map((mr) => `!${mr.iid} ${mr.title}`).join(', ')}</Typography> : null}
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
