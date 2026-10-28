import { translate } from '../../i18n/i18n'
import type { PipelineJob } from '../../types/gitlab'

/** How often a running pipeline, its jobs and a running job's log are read again while shown. */
export const PIPELINE_REFRESH_MS = 15_000

/** States that can still change by themselves; anything else is finished or waits for a person. */
const ACTIVE_STATUSES = new Set(['created', 'waiting_for_resource', 'waiting_for_callback', 'preparing', 'pending', 'running', 'scheduled', 'canceling'])
/** States GitLab can cancel; Rust checks the current state again before sending. */
const CANCELABLE_STATUSES = new Set(['created', 'waiting_for_resource', 'waiting_for_callback', 'preparing', 'pending', 'running', 'scheduled'])

export function isActiveStatus(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_STATUSES.has(status))
}

export function canCancel(status: string): boolean {
  return CANCELABLE_STATUSES.has(status)
}

export function canRetryJob(job: PipelineJob): boolean {
  return job.status === 'success' || job.status === 'failed' || job.status === 'canceled'
}

export function canPlayJob(job: PipelineJob): boolean {
  return job.kind === 'job' && job.status === 'manual'
}

/** GitLab retries a pipeline's failed and canceled jobs. */
export function canRetryPipeline(status: string): boolean {
  return status === 'failed' || status === 'canceled'
}

export interface StageGroup {
  stage: string
  jobs: PipelineJob[]
}

/**
 * Jobs grouped by stage, stages in the order they ran. GitLab lists jobs
 * newest first, and a stage's jobs are created before the next stage's, so a
 * stage's oldest job ID orders it.
 */
export function groupByStage(jobs: PipelineJob[]): StageGroup[] {
  const groups = new Map<string, { first: number; jobs: PipelineJob[] }>()
  for (const job of jobs) {
    const id = Number(job.id)
    const group = groups.get(job.stage) ?? { first: id, jobs: [] }
    group.first = Math.min(group.first, id)
    group.jobs.push(job)
    groups.set(job.stage, group)
  }
  return [...groups.entries()]
    .sort(([, left], [, right]) => left.first - right.first)
    .map(([stage, group]) => ({ jobs: [...group.jobs].sort((left, right) => left.name.localeCompare(right.name) || Number(left.id) - Number(right.id)), stage }))
}

/** A duration in seconds as 「1時間2分」「3分4秒」「12秒」. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours) return translate('mergeRequest.duration.hoursMinutes', { hours, minutes })
  if (minutes) return translate('mergeRequest.duration.minutesSeconds', { minutes, seconds: rest })
  return translate('mergeRequest.duration.seconds', { seconds: rest })
}
