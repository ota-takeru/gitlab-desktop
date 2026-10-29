import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import { frame } from '../../components/hairline'
import { gridLine } from '../../theme'
import { PipelineStatus } from '../../components/PipelineStatus'
import { useT } from '../../i18n/useT'
import type { JobTraceQuery, PipelineJob, TraceColor, TraceSpan } from '../../types/gitlab'
import { useQueryRefreshAllowed } from '../shared/QueryRefreshPolicy'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { isActiveStatus, PIPELINE_REFRESH_MS } from './pipelineState'
import { Row } from '../../components/Row'

/** Lines drawn at once; a longer log is read page by page from its end. */
export const LOG_PAGE_LINES = 500

/** Log colours as theme colours, so both themes keep them readable. */
const traceColors: Record<TraceColor, string> = {
  blue: 'info.main',
  cyan: 'primary.main',
  gray: 'text.secondary',
  green: 'success.main',
  magenta: 'secondary.main',
  red: 'error.main',
  yellow: 'warning.main',
}

/** Log lines with the colours and bold kept from the job's output; also shown in the UI catalog. */
export function JobLogLines({ label, lines }: { label: string; lines: TraceSpan[][] }) {
  return (
    <Box aria-label={label} component="pre" tabIndex={0} sx={{ bgcolor: 'surface.raised', ...frame(), '&:focus-visible': { outline: (theme) => `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 }, borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', lineHeight: gridLine(5), m: 0, overflowWrap: 'anywhere', px: 1.5, py: 1, whiteSpace: 'pre-wrap' }}>
      {lines.map((spans, index) => (
        <Box component="span" key={index} sx={{ display: 'block', minHeight: gridLine(5) }}>
          {spans.map((span, at) => span.fg || span.bold
            ? <Box component="span" key={at} sx={{ color: span.fg ? traceColors[span.fg] : undefined, fontWeight: span.bold ? 600 : undefined }}>{span.text}</Box>
            : span.text)}
        </Box>
      ))}
    </Box>
  )
}

/**
 * The end of one job's log. It is read again every 15 seconds while the job
 * runs and this view is shown, and is never saved on the device.
 */
export function JobLog({ job, onOpenUrl, projectId, sessionId }: { job: PipelineJob; onOpenUrl: (url: string) => void; projectId: string; sessionId: string | null }) {
  const t = useT()
  const autoRefresh = useQueryRefreshAllowed()
  const active = isActiveStatus(job.status)
  const query = useMemo<JobTraceQuery>(() => ({ jobId: job.id, kind: 'jobTrace', projectId }), [job.id, projectId])
  const result = useGitLabQuery<JobTraceQuery>(sessionId, query, { refreshIntervalMs: active ? PIPELINE_REFRESH_MS : false })
  // null follows the end, so the newest lines stay in view as a running log grows; an older page keeps the same lines while lines are added.
  // It counts lines of the whole log: when its start is left out, `omittedLines` places the kept lines in it.
  const [pinnedEnd, setPinnedEnd] = useState<number | null>(null)
  const lines = useMemo(() => result.data?.lines ?? [], [result.data])
  const offset = result.data?.omittedLines ?? 0
  const latest = pinnedEnd === null || pinnedEnd - offset >= lines.length
  // A page whose lines were all since left out of the kept end gives way to the earliest kept lines.
  const end = latest ? lines.length : pinnedEnd - offset > 0 ? pinnedEnd - offset : Math.min(lines.length, LOG_PAGE_LINES)
  const start = Math.max(0, end - LOG_PAGE_LINES)
  const shown = useMemo(() => lines.slice(start, end), [end, lines, start])
  const openButton = job.webUrl ? <Button color="inherit" onClick={() => onOpenUrl(job.webUrl)} size="small">{t('mergeRequest.common.openInGitLab')}</Button> : undefined
  return (
    <Stack component="section" aria-label={t('mergeRequest.jobLog.label', { name: job.name })} spacing={1}>
      <Row spacing={1} sx={{ minHeight: 32 }}>
        <Typography color="textSecondary" component="h3" variant="overline">{t('mergeRequest.jobLog.heading')}</Typography>
        <Typography noWrap sx={{ fontFamily: 'code.fontFamily', minWidth: 0 }} variant="body2">{job.name}</Typography>
        <PipelineStatus prefix="" status={job.status} />
        <Box sx={{ flex: 1 }} />
        {result.refreshing ? <Typography color="textSecondary" role="status" variant="caption">{t('mergeRequest.common.refreshing')}</Typography> : null}
        <Tooltip title={t('mergeRequest.jobLog.refresh')}><span><IconButton aria-label={t('mergeRequest.jobLog.refresh')} disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        {job.webUrl ? <Tooltip title={t('mergeRequest.jobLog.openJob')}><IconButton aria-label={t('mergeRequest.jobLog.openJob')} onClick={() => onOpenUrl(job.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
      </Row>
      {active ? <Typography color="textSecondary" variant="caption">{autoRefresh ? t('mergeRequest.jobLog.autoRefreshOn') : t('mergeRequest.jobLog.autoRefreshOff')}</Typography> : null}
      {result.error && !result.data ? <Alert action={openButton} severity="error">{t('mergeRequest.jobLog.loadFailed', { error: result.error.message })}</Alert> : null}
      {result.error && result.data ? <Alert severity="warning">{t('mergeRequest.jobLog.refreshFailed', { error: result.error.message })}</Alert> : null}
      {result.data?.headOmitted ? <Alert action={openButton} severity="info">{t('mergeRequest.jobLog.headOmitted')}</Alert> : null}
      {result.loading ? <Typography color="textSecondary" role="status" variant="body2">{t('mergeRequest.jobLog.loading')}</Typography> : null}
      {result.data && lines.length === 0 ? <Typography color="textSecondary" variant="body2">{active ? t('mergeRequest.jobLog.emptyActive') : t('mergeRequest.jobLog.empty')}</Typography> : null}
      {lines.length > LOG_PAGE_LINES ? (
        <Row aria-label={t('mergeRequest.jobLog.pages')} spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{t('mergeRequest.jobLog.range', { end: String(offset + end), start: String(offset + start + 1), total: String(offset + lines.length) })}</Typography>
          <Button aria-label={t('mergeRequest.jobLog.previousLines', { count: LOG_PAGE_LINES })} disabled={start === 0} onClick={() => setPinnedEnd(offset + start)} size="small">{t('mergeRequest.jobLog.previous')}</Button>
          <Button aria-label={t('mergeRequest.jobLog.nextLines', { count: LOG_PAGE_LINES })} disabled={latest} onClick={() => setPinnedEnd(end + LOG_PAGE_LINES >= lines.length ? null : offset + end + LOG_PAGE_LINES)} size="small">{t('mergeRequest.jobLog.next')}</Button>
          <Button disabled={latest} onClick={() => setPinnedEnd(null)} size="small">{t('mergeRequest.jobLog.last')}</Button>
        </Row>
      ) : null}
      {shown.length ? <JobLogLines label={t('mergeRequest.jobLog.body', { name: job.name })} lines={shown} /> : null}
    </Stack>
  )
}
