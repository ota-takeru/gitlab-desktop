import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { JobTrace, Pipeline, PipelineJob } from '../../types/gitlab'
import { PipelinesTab } from './PipelinesTab'

const mocks = vi.hoisted(() => ({
  calls: [] as { kind: string; interval: number | false | undefined }[],
  pipelines: [] as unknown[],
  detail: null as unknown,
  jobs: [] as unknown[],
  jobsCompleteness: 'complete',
  trace: null as unknown,
  refreshes: [] as string[],
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: { kind: string } | null, options: { refreshIntervalMs?: number | false } = {}) => {
    if (query) mocks.calls.push({ interval: options.refreshIntervalMs, kind: query.kind })
    const data = query?.kind === 'mrPipelines' ? mocks.pipelines
      : query?.kind === 'pipeline' ? mocks.detail
        : query?.kind === 'pipelineJobs' ? mocks.jobs
          : query?.kind === 'jobTrace' ? mocks.trace
            : null
    return {
      data,
      error: null,
      loading: false,
      refresh: () => { if (query) mocks.refreshes.push(query.kind) },
      refreshing: false,
      snapshot: query ? { completeness: query.kind === 'pipelineJobs' ? mocks.jobsCompleteness : 'complete', data, fetchedAt: 1, nextPage: null, source: 'network' } : null,
      stale: false,
    }
  },
}))

function pipeline(id: string, status: string, extra: Partial<Pipeline> = {}): Pipeline {
  return { createdAt: '2026-10-01T09:00:00.000Z', id, projectId: '8', ref: 'refs/merge-requests/9/head', sha: '959e04d7c7a30600c894bd3c0cd0e1ce7f42c11d', status, webUrl: `https://gitlab.example/g/p/-/pipelines/${id}`, ...extra }
}

function job(id: string, stage: string, name: string, status: string, extra: Partial<PipelineJob> = {}): PipelineJob {
  return { allowFailure: false, createdAt: null, downstreamPipeline: null, duration: null, failureReason: null, finishedAt: null, id, kind: 'job', name, stage, startedAt: null, status, webUrl: `https://gitlab.example/g/p/-/jobs/${id}`, ...extra }
}

function renderTab(props: { disabled?: boolean; onRunAction?: (action: unknown) => Promise<boolean> } = {}) {
  const onRunAction = vi.fn(props.onRunAction ?? (async () => true))
  const onOpenUrl = vi.fn()
  render(<ThemeProvider theme={createAppTheme('light')}><PipelinesTab disabled={props.disabled ?? false} iid="9" onOpenUrl={onOpenUrl} onRunAction={onRunAction} projectId="7" sessionId="session" /></ThemeProvider>)
  return { onOpenUrl, onRunAction }
}

describe('PipelinesTab', () => {
  beforeEach(() => {
    mocks.calls.length = 0
    mocks.refreshes.length = 0
    mocks.pipelines = [pipeline('70', 'failed'), pipeline('77', 'failed')]
    mocks.detail = pipeline('77', 'failed', { duration: 184 })
    mocks.jobs = [
      job('903', 'deploy', 'review', 'manual'),
      job('902', 'test', 'unit', 'failed', { duration: 65 }),
      job('904', 'test', 'lint', 'failed', { allowFailure: true }),
      job('901', 'build', 'compile', 'success'),
      job('905', 'deploy', 'docs', 'success', { downstreamPipeline: { id: '88', status: 'success', webUrl: 'https://gitlab.example/other/-/pipelines/88' }, kind: 'bridge' }),
    ]
    mocks.jobsCompleteness = 'complete'
    mocks.trace = null
    globalThis.confirm = vi.fn(() => true)
  })

  it('shows the newest pipeline with its jobs by stage, in the order the stages ran', () => {
    renderTab()
    const detail = screen.getByRole('region', { name: 'パイプライン #77' })
    expect(within(detail).getByText('所要時間 3分4秒')).toBeInTheDocument()
    const stages = within(detail).getAllByRole('region', { name: /^ステージ/u }).map((stage) => stage.getAttribute('aria-label'))
    expect(stages).toEqual(['ステージ build', 'ステージ test', 'ステージ deploy'])
    expect(within(detail).getByText('失敗を許容')).toBeInTheDocument()
    // Nothing runs, so nothing is polled.
    expect(mocks.calls.filter((call) => call.kind !== 'jobTrace').every((call) => call.interval === false)).toBe(true)
  })

  it('reads a running pipeline again every 15 seconds while it is shown', () => {
    mocks.pipelines = [pipeline('77', 'running')]
    mocks.detail = pipeline('77', 'running')
    mocks.jobs = [job('902', 'test', 'unit', 'running')]
    mocks.trace = { headOmitted: false, lines: [[{ text: 'still running' }]] } satisfies JobTrace
    renderTab()
    for (const kind of ['mrPipelines', 'pipeline', 'pipelineJobs']) expect(mocks.calls.filter((call) => call.kind === kind).at(-1)?.interval).toBe(15_000)
    fireEvent.click(screen.getByRole('button', { name: 'unitのログを表示' }))
    expect(mocks.calls.filter((call) => call.kind === 'jobTrace').at(-1)?.interval).toBe(15_000)
    expect(screen.getByText('still running')).toBeInTheDocument()
    expect(screen.getAllByText('実行中のため、表示している間は15秒ごとに更新します。')).toHaveLength(1)
  })

  it('shows a long log from its end, page by page, and says when its start was left out', () => {
    mocks.trace = { headOmitted: true, lines: Array.from({ length: 1200 }, (_, index) => [{ text: `line ${index + 1}` }]) } satisfies JobTrace
    const { onOpenUrl } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'unitのログを表示' }))
    const log = screen.getByRole('region', { name: 'unitのログ' })
    expect(within(log).getByText('ログが長いため先頭を省略し、末尾だけを表示しています。全体はGitLabで確認してください。')).toBeInTheDocument()
    expect(within(log).getByText('表示 701–1200 / 1200行')).toBeInTheDocument()
    expect(within(log).getByText('line 1200')).toBeInTheDocument()
    expect(within(log).queryByText('line 700')).not.toBeInTheDocument()
    fireEvent.click(within(log).getByRole('button', { name: '前の500行' }))
    fireEvent.click(within(log).getByRole('button', { name: '前の500行' }))
    expect(within(log).getByText('表示 1–200 / 1200行')).toBeInTheDocument()
    expect(within(log).getByRole('button', { name: '前の500行' })).toBeDisabled()
    fireEvent.click(within(log).getByRole('button', { name: '末尾へ' }))
    expect(within(log).getByText('line 1200')).toBeInTheDocument()
    fireEvent.click(within(log).getAllByRole('button', { name: 'GitLabで開く' })[0])
    expect(onOpenUrl).toHaveBeenCalledWith('https://gitlab.example/g/p/-/jobs/902')
  })

  it('retries a failed job after confirmation and records it against the MR it was started from', async () => {
    const { onRunAction } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'unitを再実行' }))
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith({ iid: '9', jobId: '902', kind: 'retryJob', pipelineProjectId: '8', projectId: '7' }))
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('ジョブ「unit」を再実行しますか？'))
    await waitFor(() => expect(mocks.refreshes).toEqual(expect.arrayContaining(['mrPipelines', 'pipeline', 'pipelineJobs'])))
  })

  it('sends no retry when the confirmation is declined', async () => {
    globalThis.confirm = vi.fn(() => false)
    const { onRunAction } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'unitを再実行' }))
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalled())
    expect(onRunAction).not.toHaveBeenCalled()
  })

  it('asks before running a manual job and sends nothing when declined', async () => {
    globalThis.confirm = vi.fn(() => false)
    const { onRunAction } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'reviewを実行' }))
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('ジョブ「review」を実行しますか？')))
    expect(onRunAction).not.toHaveBeenCalled()
  })

  it('asks before cancelling a running pipeline', async () => {
    mocks.pipelines = [pipeline('77', 'running')]
    mocks.detail = pipeline('77', 'running')
    const { onRunAction } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith({ iid: '9', kind: 'cancelPipeline', pipelineId: '77', pipelineProjectId: '8', projectId: '7' }))
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('パイプライン #77 をキャンセルしますか？'))
    // A finished pipeline offers retry, not cancel.
    expect(screen.queryByRole('button', { name: '失敗したジョブを再実行' })).not.toBeInTheDocument()
  })

  it('offers no operation while writes to the MR are locked, and says when jobs were left out', () => {
    mocks.jobsCompleteness = 'truncated'
    renderTab({ disabled: true })
    expect(screen.getByRole('button', { name: '失敗したジョブを再実行' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'unitを再実行' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'reviewを実行' })).toBeDisabled()
    expect(screen.getByText('ジョブが多いため一部だけを表示しています。すべてはGitLabで確認してください。')).toBeInTheDocument()
  })

  it('switches to an older pipeline and opens a downstream pipeline on GitLab', () => {
    const { onOpenUrl } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: /#70/u }))
    expect(screen.getByRole('region', { name: 'パイプライン #70' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'docsの下流パイプラインをGitLabで開く' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://gitlab.example/other/-/pipelines/88')
  })
})
