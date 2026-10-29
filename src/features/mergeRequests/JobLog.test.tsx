import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { JobTrace, PipelineJob } from '../../types/gitlab'
import { JobLog } from './JobLog'

const mocks = vi.hoisted(() => ({ trace: null as unknown }))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: () => ({ data: mocks.trace, error: null, loading: false, refresh: () => undefined, refreshing: false, snapshot: null, stale: false }),
}))

const job: PipelineJob = { allowFailure: false, createdAt: null, downstreamPipeline: null, duration: null, failureReason: null, finishedAt: null, id: '902', kind: 'job', name: 'unit', stage: 'test', startedAt: null, status: 'running', webUrl: 'https://gitlab.example/g/p/-/jobs/902' }
const trace = (length: number): JobTrace => ({ headOmitted: false, lines: Array.from({ length }, (_, index) => [{ text: `line ${index + 1}` }]) })
const view = () => <ThemeProvider theme={createAppTheme('light')}><JobLog job={job} onOpenUrl={vi.fn()} projectId="7" sessionId="session" /></ThemeProvider>

it('keeps an older page on the same lines while the log grows, and follows the end on the latest page', () => {
  mocks.trace = trace(1200)
  const { rerender } = render(view())
  expect(screen.getByText('表示 701–1200 / 1200行')).toBeInTheDocument()

  mocks.trace = trace(1300)
  rerender(view())
  expect(screen.getByText('表示 801–1300 / 1300行')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '前の500行' }))
  expect(screen.getByText('表示 301–800 / 1300行')).toBeInTheDocument()
  mocks.trace = trace(1400)
  rerender(view())
  expect(screen.getByText('表示 301–800 / 1400行')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '次の500行' }))
  expect(screen.getByText('表示 801–1300 / 1400行')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '次の500行' }))
  expect(screen.getByText('表示 901–1400 / 1400行')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '次の500行' })).toBeDisabled()
  mocks.trace = trace(1500)
  rerender(view())
  expect(screen.getByText('表示 1001–1500 / 1500行')).toBeInTheDocument()
})

it('keeps an older page on the same lines when the start of a growing log is left out', () => {
  // The kept end of a log whose first `omitted` lines were left out.
  const tail = (omitted: number, length: number): JobTrace => ({ headOmitted: true, lines: Array.from({ length }, (_, index) => [{ text: `line ${omitted + index + 1}` }]), omittedLines: omitted })
  mocks.trace = tail(200, 1500)
  const { rerender } = render(view())
  expect(screen.getByText('表示 1201–1700 / 1700行')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '前の500行' }))
  expect(screen.getByText('表示 701–1200 / 1700行')).toBeInTheDocument()
  mocks.trace = tail(300, 1500)
  rerender(view())
  expect(screen.getByText('表示 701–1200 / 1800行')).toBeInTheDocument()
  expect(screen.getByText('line 701')).toBeInTheDocument()
  expect(screen.getByText('line 1200')).toBeInTheDocument()

  // What is still kept of the page stays; a page no longer kept at all gives way to the earliest kept lines.
  mocks.trace = tail(1000, 1500)
  rerender(view())
  expect(screen.getByText('表示 1001–1200 / 2500行')).toBeInTheDocument()
  mocks.trace = tail(1300, 1500)
  rerender(view())
  expect(screen.getByText('表示 1301–1800 / 2800行')).toBeInTheDocument()
})
