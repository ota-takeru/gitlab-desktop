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
import { formatFetchedAt, shortSha } from '../../lib/format'
import type { JobAction, MrPipelinesQuery, Pipeline, PipelineAction, PipelineJob, PipelineJobsQuery, PipelineQuery } from '../../types/gitlab'
import { useQueryRefreshAllowed } from '../shared/QueryRefreshPolicy'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { JobLog } from './JobLog'
import { canCancel, canPlayJob, canRetryJob, canRetryPipeline, formatDuration, groupByStage, isActiveStatus, PIPELINE_REFRESH_MS } from './pipelineState'

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
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32 }}>
        <Typography color="textSecondary" component="h2" variant="overline">パイプライン</Typography>
        <Typography color="textSecondary" role="status" variant="caption">
          {list.refreshing ? '更新中…' : list.stale ? `保存済み · ${formatFetchedAt(list.snapshot?.fetchedAt)}` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="パイプラインとジョブを再取得"><span><IconButton aria-label="パイプラインを再取得" disabled={list.loading} onClick={refreshAll}><RefreshRoundedIcon /></IconButton></span></Tooltip>
      </Stack>
      {list.error && !pipelines.length ? <Alert severity="error">パイプラインを取得できませんでした: {list.error.message}</Alert> : null}
      {list.error && pipelines.length ? <Alert severity="warning">保存済みのパイプラインを表示中です。更新に失敗しました: {list.error.message}</Alert> : null}
      {list.loading ? <Typography color="textSecondary" role="status" variant="body2">パイプラインを読み込み中…</Typography> : null}
      {list.data && !pipelines.length && !list.error ? <Typography color="textSecondary" variant="body2">{page > 1 ? 'このページにパイプラインはありません。' : 'このMRのパイプラインはありません。'}</Typography> : null}
      {pipelines.length || page > 1 ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { lg: '240px minmax(0, 1fr)', xs: '1fr' } }}>
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <List aria-label="パイプライン一覧" dense disablePadding>
              {pipelines.map((item) => {
                const current = item.id === selected?.id
                return (
                  <ListItemButton aria-current={current ? 'true' : undefined} key={item.id} onClick={() => setSelectedId(item.id)} selected={current} sx={{ alignItems: 'flex-start', borderRadius: 1, flexDirection: 'column', gap: 0.25, px: 1, py: 0.5 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', maxWidth: '100%' }}>
                      <PipelineStatus status={item.status} />
                      <Typography color="textSecondary" variant="caption">#{item.id}</Typography>
                    </Stack>
                    <Typography noWrap sx={{ fontFamily: 'code.fontFamily', maxWidth: '100%' }} variant="caption">{item.ref} · {shortSha(item.sha)}</Typography>
                    {item.createdAt ? <RelativeTime prefix="作成" value={item.createdAt} /> : null}
                  </ListItemButton>
                )
              })}
            </List>
            <Pager hasNext={Boolean(list.snapshot?.nextPage)} hasPrevious={page > 1} onNext={() => { setPage(page + 1); setSelectedId(null) }} onPrevious={() => { setPage(Math.max(1, page - 1)); setSelectedId(null) }} page={page} />
          </Stack>
          {pipeline ? (
            <Stack component="section" aria-label={`パイプライン #${pipeline.id}`} spacing={1.5} sx={{ minWidth: 0 }}>
              <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography component="h3" variant="subtitle1">パイプライン #{pipeline.id}</Typography>
                <PipelineStatus status={pipeline.status} />
                <Box sx={{ flex: 1 }} />
                {canRetryPipeline(pipeline.status) ? <Button disabled={writesDisabled} onClick={() => void run('retry-pipeline', pipelineAction('retryPipeline', pipeline), { confirmLabel: '再実行する', message: '失敗・キャンセルされたジョブをもう一度実行します。', title: `パイプライン #${pipeline.id} の失敗したジョブを再実行しますか？` })} size="small" startIcon={<ReplayRoundedIcon />} variant="outlined">{busy === 'retry-pipeline' ? '再実行中…' : '失敗したジョブを再実行'}</Button> : null}
                {canCancel(pipeline.status) ? <Button color="error" disabled={writesDisabled} onClick={() => void run('cancel-pipeline', pipelineAction('cancelPipeline', pipeline), { cancelLabel: '続行させる', confirmLabel: 'キャンセルする', destructive: true, message: '実行中と待機中のジョブがすべて止まります。', title: `パイプライン #${pipeline.id} をキャンセルしますか？` })} size="small" startIcon={<DoNotDisturbAltRoundedIcon />} variant="outlined">{busy === 'cancel-pipeline' ? 'キャンセル中…' : 'キャンセル'}</Button> : null}
                {pipeline.webUrl ? <Tooltip title="GitLabでパイプラインを開く"><IconButton aria-label="GitLabでパイプラインを開く" onClick={() => onOpenUrl(pipeline.webUrl)}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
              </Stack>
              <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Tooltip title={pipeline.ref}><Typography color="textSecondary" noWrap sx={{ fontFamily: 'code.fontFamily', maxWidth: '100%', minWidth: 0 }} variant="caption">{pipeline.ref}</Typography></Tooltip>
                <Tooltip title={pipeline.sha}><Typography color="textSecondary" sx={{ fontFamily: 'code.fontFamily' }} variant="caption">{shortSha(pipeline.sha)}</Typography></Tooltip>
                {pipeline.createdAt ? <RelativeTime prefix="作成" value={pipeline.createdAt} /> : null}
                {formatDuration(pipeline.duration) ? <Typography color="textSecondary" variant="caption">所要時間 {formatDuration(pipeline.duration)}</Typography> : null}
              </Stack>
              {active ? <Typography color="textSecondary" variant="caption">{autoRefresh ? '実行中のため、表示している間は15秒ごとに更新します。' : '自動更新はオフです。更新ボタンで最新の状態を取得してください。'}</Typography> : null}
              {detail.error ? <Alert severity="warning">パイプラインの詳細を取得できませんでした: {detail.error.message}</Alert> : null}
              {jobsResult.error && !jobs.length ? <Alert severity="error">ジョブを取得できませんでした: {jobsResult.error.message}</Alert> : null}
              {jobsResult.error && jobs.length ? <Alert severity="warning">保存済みのジョブを表示中です。更新に失敗しました: {jobsResult.error.message}</Alert> : null}
              {jobsResult.loading ? <Typography color="textSecondary" role="status" variant="body2">ジョブを読み込み中…</Typography> : null}
              {jobsResult.snapshot?.completeness === 'truncated' ? <Alert severity="info">ジョブが多いため一部だけを表示しています。すべてはGitLabで確認してください。</Alert> : null}
              {jobsResult.data && !jobs.length && !jobsResult.error ? <Typography color="textSecondary" variant="body2">このパイプラインにジョブはありません。</Typography> : null}
              {stages.map((group) => (
                <Box component="section" aria-label={`ステージ ${group.stage || '不明'}`} key={group.stage}>
                  <Typography color="textSecondary" component="h4" variant="overline">{group.stage || 'ステージ不明'}</Typography>
                  <List disablePadding dense>
                    {group.jobs.map((job) => (
                      <JobRow
                        disabled={writesDisabled}
                        job={job}
                        key={job.id}
                        onCancel={() => void run(`cancel-${job.id}`, jobAction('cancelJob', job), { cancelLabel: '続行させる', confirmLabel: 'キャンセルする', destructive: true, title: `ジョブ「${job.name}」をキャンセルしますか？` })}
                        onOpenUrl={onOpenUrl}
                        onPlay={() => void run(`play-${job.id}`, jobAction('playJob', job), { confirmLabel: '実行する', message: '手動ジョブを開始します。デプロイなどの操作を伴う場合があります。', title: `ジョブ「${job.name}」を実行しますか？` })}
                        onRetry={() => void run(`retry-${job.id}`, jobAction('retryJob', job), { confirmLabel: '再実行する', message: '新しいジョブとしてもう一度実行します。デプロイなどの操作を伴う場合があります。', title: `ジョブ「${job.name}」を再実行しますか？` })}
                        onSelect={() => setSelectedJob({ jobId: job.id, pipelineId: pipeline.id })}
                        selected={shownJob?.id === job.id}
                      />
                    ))}
                  </List>
                </Box>
              ))}
              {shownJob ? <JobLog job={shownJob} key={shownJob.id} onOpenUrl={onOpenUrl} projectId={pipelineProjectId} sessionId={sessionId} />
                : jobs.some((job) => job.kind === 'job') ? <Typography color="textSecondary" variant="caption">ジョブを選ぶとログを表示します。</Typography> : null}
            </Stack>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  )
}

function JobRow({ disabled, job, onCancel, onOpenUrl, onPlay, onRetry, onSelect, selected }: { disabled: boolean; job: PipelineJob; onCancel: () => void; onOpenUrl: (url: string) => void; onPlay: () => void; onRetry: () => void; onSelect: () => void; selected: boolean }) {
  const duration = formatDuration(job.duration)
  const bridge = job.kind === 'bridge'
  const summary = (
    <>
      <PipelineStatus prefix="" status={job.status} />
      <Typography noWrap sx={{ flex: 1, fontFamily: 'code.fontFamily', minWidth: 0 }} variant="body2">{job.name}</Typography>
      {job.allowFailure && job.status === 'failed' ? <Chip label="失敗を許容" size="small" variant="outlined" /> : null}
      {bridge ? <Chip label="下流パイプライン" size="small" variant="outlined" /> : null}
      {duration ? <Typography color="textSecondary" sx={{ flexShrink: 0 }} variant="caption">{duration}</Typography> : null}
    </>
  )
  return (
    <Box component="li" sx={{ alignItems: 'center', display: 'flex', gap: 0.5, listStyle: 'none' }}>
      {bridge
        ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1, minHeight: 32, minWidth: 0, px: 1 }}>{summary}</Stack>
        : <ListItemButton aria-label={`${job.name}のログを表示`} aria-pressed={selected} onClick={onSelect} selected={selected} sx={{ borderRadius: 1, flex: 1, gap: 1, minHeight: 32, minWidth: 0, px: 1, py: 0.25 }}>{summary}</ListItemButton>}
      <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0 }}>
        {bridge && job.downstreamPipeline ? <>
          <PipelineStatus prefix="下流" status={job.downstreamPipeline.status} />
          {job.downstreamPipeline.webUrl ? <Tooltip title="GitLabで下流パイプラインを開く"><IconButton aria-label={`${job.name}の下流パイプラインをGitLabで開く`} onClick={() => onOpenUrl(job.downstreamPipeline!.webUrl)} size="small"><LaunchRoundedIcon fontSize="small" /></IconButton></Tooltip> : null}
        </> : null}
        {canPlayJob(job) ? <Tooltip title="手動ジョブを実行"><span><IconButton aria-label={`${job.name}を実行`} disabled={disabled} onClick={onPlay} size="small"><PlayArrowRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
        {canRetryJob(job) ? <Tooltip title="ジョブを再実行"><span><IconButton aria-label={`${job.name}を再実行`} disabled={disabled} onClick={onRetry} size="small"><ReplayRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
        {canCancel(job.status) ? <Tooltip title="ジョブをキャンセル"><span><IconButton aria-label={`${job.name}をキャンセル`} disabled={disabled} onClick={onCancel} size="small"><DoNotDisturbAltRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Stack>
    </Box>
  )
}
