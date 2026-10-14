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

import { PipelineStatus } from '../../components/PipelineStatus'
import type { JobTraceQuery, PipelineJob, TraceColor, TraceSpan } from '../../types/gitlab'
import { useQueryRefreshAllowed } from '../shared/QueryRefreshPolicy'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { isActiveStatus, PIPELINE_REFRESH_MS } from './pipelineState'

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
    <Box aria-label={label} component="pre" tabIndex={0} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'divider', borderRadius: 1, fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', lineHeight: 1.6, m: 0, overflowWrap: 'anywhere', px: 1.5, py: 1, whiteSpace: 'pre-wrap' }}>
      {lines.map((spans, index) => (
        <Box component="span" key={index} sx={{ display: 'block', minHeight: '1.6em' }}>
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
  const autoRefresh = useQueryRefreshAllowed()
  const active = isActiveStatus(job.status)
  const query = useMemo<JobTraceQuery>(() => ({ jobId: job.id, kind: 'jobTrace', projectId }), [job.id, projectId])
  const result = useGitLabQuery<JobTraceQuery>(sessionId, query, { refreshIntervalMs: active ? PIPELINE_REFRESH_MS : false })
  // Counted from the end, so the newest lines stay in view as a running log grows.
  const [pageFromEnd, setPageFromEnd] = useState(0)
  const lines = useMemo(() => result.data?.lines ?? [], [result.data])
  const pages = Math.max(1, Math.ceil(lines.length / LOG_PAGE_LINES))
  const page = Math.min(pageFromEnd, pages - 1)
  const end = lines.length - page * LOG_PAGE_LINES
  const start = Math.max(0, end - LOG_PAGE_LINES)
  const shown = useMemo(() => lines.slice(start, end), [end, lines, start])
  const openButton = job.webUrl ? <Button color="inherit" onClick={() => onOpenUrl(job.webUrl)} size="small">GitLabで開く</Button> : undefined
  return (
    <Stack component="section" aria-label={`${job.name}のログ`} spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32 }}>
        <Typography color="textSecondary" component="h3" variant="overline">ログ</Typography>
        <Typography noWrap sx={{ fontFamily: 'code.fontFamily', minWidth: 0 }} variant="body2">{job.name}</Typography>
        <PipelineStatus prefix="" status={job.status} />
        <Box sx={{ flex: 1 }} />
        {result.refreshing ? <Typography color="textSecondary" role="status" variant="caption">更新中…</Typography> : null}
        <Tooltip title="ログを再取得"><span><IconButton aria-label="ログを再取得" disabled={result.loading || result.refreshing} onClick={result.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        {job.webUrl ? <Tooltip title="GitLabでジョブを開く"><IconButton aria-label="GitLabでジョブを開く" onClick={() => onOpenUrl(job.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
      </Stack>
      {active ? <Typography color="textSecondary" variant="caption">{autoRefresh ? '実行中のため、表示している間は15秒ごとにログを更新します。' : '自動更新はオフです。更新ボタンで最新のログを取得してください。'}</Typography> : null}
      {result.error && !result.data ? <Alert action={openButton} severity="error">ログを取得できませんでした: {result.error.message}</Alert> : null}
      {result.error && result.data ? <Alert severity="warning">ログの更新に失敗しました。前回取得したログを表示しています: {result.error.message}</Alert> : null}
      {result.data?.headOmitted ? <Alert action={openButton} severity="info">ログが長いため先頭を省略し、末尾だけを表示しています。全体はGitLabで確認してください。</Alert> : null}
      {result.loading ? <Typography color="textSecondary" role="status" variant="body2">ログを読み込み中…</Typography> : null}
      {result.data && lines.length === 0 ? <Typography color="textSecondary" variant="body2">{active ? 'ログはまだありません。ジョブが進むとここに表示されます。' : 'このジョブのログはありません。'}</Typography> : null}
      {lines.length > LOG_PAGE_LINES ? (
        <Stack aria-label="ログの行ページ" direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">表示 {start + 1}–{end} / {lines.length}行</Typography>
          <Button aria-label={`前の${LOG_PAGE_LINES}行`} disabled={start === 0} onClick={() => setPageFromEnd(page + 1)} size="small">前へ</Button>
          <Button aria-label={`次の${LOG_PAGE_LINES}行`} disabled={page === 0} onClick={() => setPageFromEnd(page - 1)} size="small">次へ</Button>
          <Button disabled={page === 0} onClick={() => setPageFromEnd(0)} size="small">末尾へ</Button>
        </Stack>
      ) : null}
      {shown.length ? <JobLogLines label={`${job.name}のログ本文`} lines={shown} /> : null}
    </Stack>
  )
}
