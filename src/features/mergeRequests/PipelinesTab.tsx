import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import DoNotDisturbAltRoundedIcon from '@mui/icons-material/DoNotDisturbAltRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import { type ConfirmOptions } from '../../components/Feedback'
import { useConfirm } from '../../components/feedbackContext'
import { Pager } from '../../components/Pager'
import { PipelineStatus } from '../../components/PipelineStatus'
import { RelativeTime } from '../../components/RelativeTime'
import { useT } from '../../i18n/useT'
import { formatFetchedAt, shortSha } from '../../lib/format'
import type { JobAction, MrPipelinesQuery, Pipeline, PipelineAction, PipelineJob, PipelineJobsQuery, PipelineQuery } from '../../types/gitlab'
import { useQueryRefreshAllowed } from '../shared/QueryRefreshPolicy'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { JobLog } from './JobLog'
import { canCancel, canPlayJob, canRetryJob, canRetryPipeline, formatDuration, groupByStage, isActiveStatus, PIPELINE_REFRESH_MS } from './pipelineState'
import { Bar, Row } from '../../components/Row'

export interface PipelinesTabProps {
  sessionId: string | null
  /** The MR's project and number; job and pipeline writes are recorded against this MR. */
  projectId: string
  iid: string
  /** Writes to this MR are locked (an unknown outcome) or one is being sent. */
  disabled: boolean
  /** Sends one write through the MR's write guard; resolves true once GitLab confirmed it. */
  onRunAction: (action: JobAction | PipelineAction) => Promise<boolean>
  onOpenUrl: (url: string) => void
}

/**
 * The MR's pipelines, the jobs of the chosen one by stage, and a job's log.
 * While something runs and this tab is shown it is read again every 15
 * seconds; finished pipelines are not polled.
 */
export function PipelinesTab({ disabled, iid, onOpenUrl, onRunAction, projectId, sessionId }: PipelinesTabProps) {
  const t = useT()
  const confirm = useConfirm()
  const autoRefresh = useQueryRefreshAllowed()
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<{ pipelineId: string; jobId: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const listQuery = useMemo<MrPipelinesQuery>(() => ({ iid, kind: 'mrPipelines', page, projectId }), [iid, page, projectId])
  // The list is polled only while one of its pipelines runs; that is known once a page is read.
  const [listPolling, setListPolling] = useState(false)
  const list = useGitLabQuery<MrPipelinesQuery>(sessionId, listQuery, { refreshIntervalMs: listPolling ? PIPELINE_REFRESH_MS : false })
  const pipelines = useMemo(() => [...(list.data ?? [])].sort((left, right) => Number(right.id) - Number(left.id)), [list.data])
  const anyActive = pipelines.some((pipeline) => isActiveStatus(pipeline.status))
  if (anyActive !== listPolling) setListPolling(anyActive)

  // The newest pipeline is shown unless another one was chosen.
  const selected = pipelines.find((pipeline) => pipeline.id === selectedId) ?? pipelines[0] ?? null
  const pipelineProjectId = selected?.projectId ?? projectId
  const detailQuery = useMemo<PipelineQuery | null>(() => selected ? { kind: 'pipeline', pipelineId: selected.id, projectId: pipelineProjectId } : null, [pipelineProjectId, selected])
  const jobsQuery = useMemo<PipelineJobsQuery | null>(() => selected ? { kind: 'pipelineJobs', pipelineId: selected.id, projectId: pipelineProjectId } : null, [pipelineProjectId, selected])
  const [detailPolling, setDetailPolling] = useState(false)
  const detail = useGitLabQuery<PipelineQuery>(sessionId, detailQuery, { refreshIntervalMs: detailPolling ? PIPELINE_REFRESH_MS : false })
  const jobsResult = useGitLabQuery<PipelineJobsQuery>(sessionId, jobsQuery, { refreshIntervalMs: detailPolling ? PIPELINE_REFRESH_MS : false })
  const pipeline: Pipeline | null = selected ? { ...selected, ...(detail.data?.id === selected.id ? detail.data : {}) } : null
  const active = isActiveStatus(pipeline?.status)
  if (active !== detailPolling) setDetailPolling(active)

  const jobs = useMemo(() => jobsResult.data ?? [], [jobsResult.data])
  const stages = useMemo(() => groupByStage(jobs), [jobs])
  const shownJob = selected && selectedJob?.pipelineId === selected.id ? jobs.find((job) => job.id === selectedJob.jobId) ?? null : null

  const refreshAll = () => { list.refresh(); detail.refresh(); jobsResult.refresh() }
  const run = async (key: string, action: JobAction | PipelineAction, question?: ConfirmOptions) => {
    if (disabled || busy) return
    if (question && !await confirm(question)) return
    setBusy(key)
    try {
      if (await onRunAction(action)) refreshAll()
    } finally {
      setBusy(null)
    }
  }
  const jobAction = (kind: JobAction['kind'], job: PipelineJob): JobAction => ({ iid, jobId: job.id, kind, pipelineProjectId, projectId })
  const pipelineAction = (kind: PipelineAction['kind'], target: Pipeline): PipelineAction => ({ iid, kind, pipelineId: target.id, pipelineProjectId, projectId })
  const writesDisabled = disabled || Boolean(busy)

  return (
    // The overview's reading width, so on a wide window a job's duration and actions stay near its name.
    <Stack spacing={1.5} sx={{ maxWidth: 1200 }}>
      <Bar spacing={1} sx={{ minHeight: 32 }}>
        <Typography color="textSecondary" component="h2" variant="overline">{t('mergeRequest.pipelines.heading')}</Typography>
        <Typography color="textSecondary" role="status" variant="caption">
          {list.refreshing ? t('mergeRequest.common.refreshing') : list.stale ? t('mergeRequest.common.savedAt', { time: formatFetchedAt(list.snapshot?.fetchedAt) }) : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('mergeRequest.pipelines.refreshTooltip')}><span><IconButton aria-label={t('mergeRequest.pipelines.refresh')} disabled={list.loading} onClick={refreshAll}><RefreshRoundedIcon /></IconButton></span></Tooltip>
      </Bar>
      {list.error && !pipelines.length ? <Alert severity="error">{t('mergeRequest.pipelines.loadFailed', { error: list.error.message })}</Alert> : null}
      {list.error && pipelines.length ? <Alert severity="warning">{t('mergeRequest.pipelines.refreshFailed', { error: list.error.message })}</Alert> : null}
      {list.loading ? <Typography color="textSecondary" role="status" variant="body2">{t('mergeRequest.pipelines.loading')}</Typography> : null}
      {list.data && !pipelines.length && !list.error ? <Typography color="textSecondary" variant="body2">{page > 1 ? t('mergeRequest.pipelines.emptyPage') : t('mergeRequest.pipelines.empty')}</Typography> : null}
      {pipelines.length || page > 1 ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { lg: '240px minmax(0, 1fr)', xs: '1fr' } }}>
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <List aria-label={t('mergeRequest.pipelines.list')} dense disablePadding>
              {pipelines.map((item) => {
                const current = item.id === selected?.id
                return (
                  <ListItemButton aria-current={current ? 'true' : undefined} key={item.id} onClick={() => setSelectedId(item.id)} selected={current} sx={{ alignItems: 'flex-start', borderRadius: 1, flexDirection: 'column', px: 1, py: 0.5 }}>
                    <Row spacing={1} sx={{ maxWidth: '100%' }}>
                      <PipelineStatus status={item.status} />
                      <Typography color="textSecondary" variant="caption">#{item.id}</Typography>
                    </Row>
                    <Typography noWrap sx={{ fontFamily: 'code.fontFamily', maxWidth: '100%' }} variant="caption">{item.ref} · {shortSha(item.sha)}</Typography>
                    {item.createdAt ? <RelativeTime prefix={t('mergeRequest.common.created')} value={item.createdAt} /> : null}
                  </ListItemButton>
                )
              })}
            </List>
            <Pager hasNext={Boolean(list.snapshot?.nextPage)} hasPrevious={page > 1} onNext={() => { setPage(page + 1); setSelectedId(null) }} onPrevious={() => { setPage(Math.max(1, page - 1)); setSelectedId(null) }} page={page} />
          </Stack>
          {pipeline ? (
            <Stack component="section" aria-label={t('mergeRequest.pipelines.title', { id: pipeline.id })} spacing={1.5} sx={{ minWidth: 0 }}>
              <Bar sx={{ columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography component="h3" variant="subtitle1">{t('mergeRequest.pipelines.title', { id: pipeline.id })}</Typography>
                <PipelineStatus status={pipeline.status} />
                <Box sx={{ flex: 1 }} />
                {canRetryPipeline(pipeline.status) ? <Button disabled={writesDisabled} onClick={() => void run('retry-pipeline', pipelineAction('retryPipeline', pipeline), { confirmLabel: t('mergeRequest.pipelines.retryConfirm'), message: t('mergeRequest.pipelines.retryMessage'), title: t('mergeRequest.pipelines.retryTitle', { id: pipeline.id }) })} size="small" startIcon={<ReplayRoundedIcon />} variant="outlined">{busy === 'retry-pipeline' ? t('mergeRequest.pipelines.retrying') : t('mergeRequest.pipelines.retry')}</Button> : null}
                {canCancel(pipeline.status) ? <Button color="error" disabled={writesDisabled} onClick={() => void run('cancel-pipeline', pipelineAction('cancelPipeline', pipeline), { cancelLabel: t('mergeRequest.pipelines.cancelKeepRunning'), confirmLabel: t('mergeRequest.pipelines.cancelConfirm'), destructive: true, message: t('mergeRequest.pipelines.cancelMessage'), title: t('mergeRequest.pipelines.cancelTitle', { id: pipeline.id }) })} size="small" startIcon={<DoNotDisturbAltRoundedIcon />} variant="outlined">{busy === 'cancel-pipeline' ? t('mergeRequest.pipelines.canceling') : t('mergeRequest.pipelines.cancel')}</Button> : null}
                {pipeline.webUrl ? <Tooltip title={t('mergeRequest.pipelines.openInGitLab')}><IconButton aria-label={t('mergeRequest.pipelines.openInGitLab')} onClick={() => onOpenUrl(pipeline.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
              </Bar>
              <Row sx={{ columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Tooltip title={pipeline.ref}><Typography color="textSecondary" noWrap sx={{ fontFamily: 'code.fontFamily', maxWidth: '100%', minWidth: 0 }} variant="caption">{pipeline.ref}</Typography></Tooltip>
                <Tooltip title={pipeline.sha}><Typography color="textSecondary" sx={{ fontFamily: 'code.fontFamily' }} variant="caption">{shortSha(pipeline.sha)}</Typography></Tooltip>
                {pipeline.createdAt ? <RelativeTime prefix={t('mergeRequest.common.created')} value={pipeline.createdAt} /> : null}
                {formatDuration(pipeline.duration) ? <Typography color="textSecondary" variant="caption">{t('mergeRequest.pipelines.duration', { duration: formatDuration(pipeline.duration) ?? '' })}</Typography> : null}
              </Row>
              {active ? <Typography color="textSecondary" variant="caption">{autoRefresh ? t('mergeRequest.pipelines.autoRefreshOn') : t('mergeRequest.pipelines.autoRefreshOff')}</Typography> : null}
              {detail.error ? <Alert severity="warning">{t('mergeRequest.pipelines.detailFailed', { error: detail.error.message })}</Alert> : null}
              {jobsResult.error && !jobs.length ? <Alert severity="error">{t('mergeRequest.pipelines.jobsFailed', { error: jobsResult.error.message })}</Alert> : null}
              {jobsResult.error && jobs.length ? <Alert severity="warning">{t('mergeRequest.pipelines.jobsRefreshFailed', { error: jobsResult.error.message })}</Alert> : null}
              {jobsResult.loading ? <Typography color="textSecondary" role="status" variant="body2">{t('mergeRequest.pipelines.jobsLoading')}</Typography> : null}
              {jobsResult.snapshot?.completeness === 'truncated' ? <Alert severity="info">{t('mergeRequest.pipelines.jobsTruncated')}</Alert> : null}
              {jobsResult.data && !jobs.length && !jobsResult.error ? <Typography color="textSecondary" variant="body2">{t('mergeRequest.pipelines.jobsEmpty')}</Typography> : null}
              {stages.map((group) => (
                <Box component="section" aria-label={group.stage ? t('mergeRequest.pipelines.stage', { stage: group.stage }) : t('mergeRequest.pipelines.stageUnknownLabel')} key={group.stage}>
                  <Typography color="textSecondary" component="h4" variant="overline">{group.stage || t('mergeRequest.pipelines.stageUnknown')}</Typography>
                  <List disablePadding dense>
                    {group.jobs.map((job) => (
                      <JobRow
                        disabled={writesDisabled}
                        job={job}
                        key={job.id}
                        onCancel={() => void run(`cancel-${job.id}`, jobAction('cancelJob', job), { cancelLabel: t('mergeRequest.pipelines.cancelKeepRunning'), confirmLabel: t('mergeRequest.pipelines.cancelConfirm'), destructive: true, title: t('mergeRequest.jobs.cancelTitle', { name: job.name }) })}
                        onOpenUrl={onOpenUrl}
                        onPlay={() => void run(`play-${job.id}`, jobAction('playJob', job), { confirmLabel: t('mergeRequest.jobs.playConfirm'), message: t('mergeRequest.jobs.playMessage'), title: t('mergeRequest.jobs.playTitle', { name: job.name }) })}
                        onRetry={() => void run(`retry-${job.id}`, jobAction('retryJob', job), { confirmLabel: t('mergeRequest.pipelines.retryConfirm'), message: t('mergeRequest.jobs.retryMessage'), title: t('mergeRequest.jobs.retryTitle', { name: job.name }) })}
                        onSelect={() => setSelectedJob({ jobId: job.id, pipelineId: pipeline.id })}
                        selected={shownJob?.id === job.id}
                      />
                    ))}
                  </List>
                </Box>
              ))}
              {shownJob ? <JobLog job={shownJob} key={shownJob.id} onOpenUrl={onOpenUrl} projectId={pipelineProjectId} sessionId={sessionId} />
                : jobs.some((job) => job.kind === 'job') ? <Typography color="textSecondary" variant="caption">{t('mergeRequest.jobs.selectHint')}</Typography> : null}
            </Stack>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  )
}

function JobRow({ disabled, job, onCancel, onOpenUrl, onPlay, onRetry, onSelect, selected }: { disabled: boolean; job: PipelineJob; onCancel: () => void; onOpenUrl: (url: string) => void; onPlay: () => void; onRetry: () => void; onSelect: () => void; selected: boolean }) {
  const t = useT()
  const duration = formatDuration(job.duration)
  const bridge = job.kind === 'bridge'
  const summary = (
    <>
      <PipelineStatus prefix="" status={job.status} />
      <Typography noWrap sx={{ flex: 1, fontFamily: 'code.fontFamily', minWidth: 0 }} variant="body2">{job.name}</Typography>
      {job.allowFailure && job.status === 'failed' ? <Chip label={t('mergeRequest.jobs.allowFailure')} size="small" variant="outlined" /> : null}
      {bridge ? <Chip label={t('mergeRequest.jobs.downstream')} size="small" variant="outlined" /> : null}
      {duration ? <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="caption">{duration}</Typography> : null}
    </>
  )
  return (
    <Bar component="li" sx={{ gap: 0.5, listStyle: 'none' }}>
      {bridge
        ? <Row spacing={1} sx={{ flex: 1, minHeight: 32, minWidth: 0, px: 1 }}>{summary}</Row>
        : <ListItemButton aria-label={t('mergeRequest.jobs.showLog', { name: job.name })} aria-pressed={selected} onClick={onSelect} selected={selected} sx={{ borderRadius: 1, flex: 1, gap: 1, minHeight: 32, minWidth: 0, px: 1, py: 0.25 }}>{summary}</ListItemButton>}
      <Row sx={{ flexShrink: 0 }}>
        {bridge && job.downstreamPipeline ? <>
          <PipelineStatus prefix={t('mergeRequest.jobs.downstreamPrefix')} status={job.downstreamPipeline.status} />
          {job.downstreamPipeline.webUrl ? <Tooltip title={t('mergeRequest.jobs.openDownstream')}><IconButton aria-label={t('mergeRequest.jobs.openDownstreamOf', { name: job.name })} onClick={() => onOpenUrl(job.downstreamPipeline!.webUrl)} size="small"><LaunchRoundedIcon fontSize="small" /></IconButton></Tooltip> : null}
        </> : null}
        {canPlayJob(job) ? <Tooltip title={t('mergeRequest.jobs.play')}><span><IconButton aria-label={t('mergeRequest.jobs.playJob', { name: job.name })} disabled={disabled} onClick={onPlay} size="small"><PlayArrowRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
        {canRetryJob(job) ? <Tooltip title={t('mergeRequest.jobs.retry')}><span><IconButton aria-label={t('mergeRequest.jobs.retryJob', { name: job.name })} disabled={disabled} onClick={onRetry} size="small"><ReplayRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
        {canCancel(job.status) ? <Tooltip title={t('mergeRequest.jobs.cancel')}><span><IconButton aria-label={t('mergeRequest.jobs.cancelJob', { name: job.name })} disabled={disabled} onClick={onCancel} size="small"><DoNotDisturbAltRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Row>
    </Bar>
  )
}
