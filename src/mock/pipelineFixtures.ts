/**
 * Development-only pipelines, jobs and logs for the fixture MRs. Nothing here
 * is GitLab data; the operations change only this in-memory state.
 */
import type { GitLabErrorShape, JobAction, JobTrace, MergeRequest, Pipeline, PipelineAction, PipelineJob, TraceSpan } from '../types/gitlab'

interface FixturePipeline { pipeline: Pipeline; jobs: PipelineJob[] }

const ACTIVE = new Set(['created', 'waiting_for_resource', 'waiting_for_callback', 'preparing', 'pending', 'running', 'scheduled'])

export function createPipelineFixtures() {
  const byMergeRequest = new Map<string, FixturePipeline[]>()

  function pipelinesOf(mergeRequest: MergeRequest): FixturePipeline[] {
    const key = `${mergeRequest.projectId}-${mergeRequest.iid}`
    const existing = byMergeRequest.get(key)
    if (existing) return existing
    const base = 5000 + Number(mergeRequest.iid) * 10
    const created = Date.parse(mergeRequest.updatedAt)
    const make = (offset: number, status: string, minutesAgo: number): FixturePipeline => {
      const id = String(base + offset)
      const webUrl = `${mergeRequest.webUrl.replace(/\/-\/merge_requests\/\d+$/u, '')}/-/pipelines/${id}`
      const pipeline: Pipeline = {
        createdAt: new Date(created - minutesAgo * 60_000).toISOString(),
        duration: ACTIVE.has(status) ? null : 312 + offset * 7,
        finishedAt: null,
        id,
        projectId: mergeRequest.projectId,
        ref: `refs/merge-requests/${mergeRequest.iid}/head`,
        sha: offset === 2 ? mergeRequest.headSha ?? '' : `${(mergeRequest.headSha ?? '').slice(0, 30)}0000000000`,
        source: 'merge_request_event',
        startedAt: null,
        status,
        updatedAt: mergeRequest.updatedAt,
        webUrl,
      }
      return { jobs: jobsFor(pipeline), pipeline }
    }
    const latest = mergeRequest.pipeline?.status ?? 'success'
    const list = [make(2, latest, 0), make(1, 'failed', 90)]
    byMergeRequest.set(key, list)
    return list
  }

  function all(): FixturePipeline[] {
    return [...byMergeRequest.values()].flat()
  }

  function pipeline(pipelineId: string): FixturePipeline {
    return all().find((item) => item.pipeline.id === pipelineId) ?? notFound()
  }

  function job(jobId: string): { owner: FixturePipeline; job: PipelineJob } {
    for (const owner of all()) {
      const found = owner.jobs.find((item) => item.id === jobId)
      if (found) return { job: found, owner }
    }
    return notFound()
  }

  function trace(jobId: string): JobTrace {
    const { job: target } = job(jobId)
    return { headOmitted: false, lines: traceLines(target) }
  }

  function mutate(action: JobAction | PipelineAction): void {
    if ('pipelineId' in action) {
      const target = pipeline(action.pipelineId)
      if (action.kind === 'retryPipeline') {
        if (!['failed', 'canceled'].includes(target.pipeline.status)) refuse(target.pipeline.status)
        for (const item of target.jobs) if (item.status === 'failed' || item.status === 'canceled') item.status = 'pending'
        target.pipeline.status = 'running'
      } else {
        if (!ACTIVE.has(target.pipeline.status)) refuse(target.pipeline.status)
        for (const item of target.jobs) if (ACTIVE.has(item.status)) item.status = 'canceled'
        target.pipeline.status = 'canceled'
      }
      return
    }
    const { job: target, owner } = job(action.jobId)
    if (action.kind === 'retryJob' && ['success', 'failed', 'canceled'].includes(target.status)) target.status = 'pending'
    else if (action.kind === 'cancelJob' && ACTIVE.has(target.status)) target.status = 'canceled'
    else if (action.kind === 'playJob' && target.status === 'manual') target.status = 'pending'
    else refuse(target.status)
    if (target.status === 'pending') owner.pipeline.status = 'running'
  }

  return { job, mutate, pipeline, pipelinesOf, trace }
}

function jobsFor(pipeline: Pipeline): PipelineJob[] {
  const base = Number(pipeline.id) * 10
  const failed = pipeline.status === 'failed'
  const running = pipeline.status === 'running'
  const job = (offset: number, stage: string, name: string, status: string, extra: Partial<PipelineJob> = {}): PipelineJob => ({
    allowFailure: false,
    createdAt: pipeline.createdAt ?? null,
    downstreamPipeline: null,
    duration: ACTIVE.has(status) || status === 'manual' ? null : 40 + offset * 13,
    failureReason: status === 'failed' ? 'script_failure' : null,
    finishedAt: null,
    id: String(base + offset),
    kind: 'job',
    name,
    stage,
    startedAt: null,
    status,
    webUrl: `${pipeline.webUrl.replace(/\/pipelines\/\d+$/u, '')}/jobs/${base + offset}`,
    ...extra,
  })
  return [
    job(6, 'deploy', 'docs:trigger', running ? 'created' : 'success', { downstreamPipeline: { id: String(Number(pipeline.id) + 900), status: running ? 'created' : 'success', webUrl: `${pipeline.webUrl}-downstream` }, kind: 'bridge' }),
    job(5, 'deploy', 'review:deploy', 'manual'),
    job(4, 'test', 'test:e2e', running ? 'running' : 'success'),
    job(3, 'test', 'test:lint', failed ? 'failed' : 'success', { allowFailure: true }),
    job(2, 'test', 'test:unit', failed ? 'failed' : 'success'),
    job(1, 'build', 'build', 'success'),
  ]
}

function traceLines(job: PipelineJob): TraceSpan[][] {
  const command = (text: string): TraceSpan[] => [{ bold: true, fg: 'green', text: `$ ${text}` }]
  const lines: TraceSpan[][] = [
    [{ fg: 'gray', text: '固定データのジョブログです。GitLabから取得した内容ではありません。' }],
    [{ bold: true, fg: 'cyan', text: 'Preparing the "docker" executor' }],
    [{ text: 'Using docker image node:22 ...' }],
    command('npm ci'),
    [{ text: 'added 812 packages in 21s' }],
    command(`npm run ${job.name}`),
  ]
  if (job.name === 'test:unit') {
    for (let index = 1; index <= 640; index += 1) lines.push([{ fg: index % 97 === 0 ? 'yellow' : undefined, text: `  ✓ case ${index} (${index % 7}ms)` }])
  }
  if (job.status === 'failed') {
    lines.push([{ fg: 'red', text: '  ✗ 1 test failed' }], [{ bold: true, fg: 'red', text: 'ERROR: Job failed: exit code 1' }])
  } else if (ACTIVE.has(job.status)) {
    lines.push([{ text: 'running…' }])
  } else if (job.status === 'success') {
    lines.push([{ bold: true, fg: 'green', text: 'Job succeeded' }])
  }
  return job.status === 'manual' || job.status === 'created' ? [] : lines
}

function refuse(status: string): never {
  throw { code: 'INVALID_INPUT', message: `固定データ: 状態が変わったため、この操作はできません（現在: ${status}）。` } satisfies GitLabErrorShape
}

function notFound(): never {
  throw { code: 'NOT_FOUND', message: '固定データにありません。' } satisfies GitLabErrorShape
}
