import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSnapshot, Project, ProjectQuery } from '../../types/gitlab'
import { ScreenReadinessContext } from '../../components/screenReadinessContext'
import { applyConfirmedGitLabChange, prefetchGitLabQuery, useGitLabQuery } from './useGitLabQuery'
import { MemoryPressure } from './MemoryPressure'

const { cancelMock, queryGitLabMock } = vi.hoisted(() => ({ cancelMock: vi.fn(), queryGitLabMock: vi.fn() }))

vi.mock('../../lib/gitlab', () => ({
  cancelGitLabRequest: cancelMock,
  createRequestId: () => 'request-1',
  normalizeGitLabError: (error: unknown) => error,
  queryGitLab: queryGitLabMock,
}))

const query: ProjectQuery = { includeArchived: false, kind: 'projects', membership: true, page: 1, search: '' }
const snapshot = (source: 'cache' | 'network'): GitLabSnapshot<Project[]> => ({
  completeness: 'page',
  data: [{ archived: false, description: '', id: 'project-1', name: 'One', pathWithNamespace: 'team/one', webUrl: 'https://gitlab.example/team/one' }],
  fetchedAt: Date.now(),
  nextPage: null,
  source,
})

function QueryProbe({ sessionId = 'session-1' }: { sessionId?: string }) {
  const result = useGitLabQuery(sessionId, query)
  return <output data-testid="query-state">{`${result.snapshot?.source ?? 'none'}:${result.refreshing ? 'refreshing' : 'idle'}:${result.error?.code ?? 'ok'}`}</output>
}

function renderProbe(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })) {
  return render(<QueryClientProvider client={queryClient}><QueryProbe /></QueryClientProvider>)
}

describe('useGitLabQuery', () => {
  beforeEach(() => {
    queryGitLabMock.mockReset()
    cancelMock.mockReset()
  })

  it('does not run or report anything for a hook without a query, even when refreshed', async () => {
    function IdleProbes() {
      const refreshed = useGitLabQuery('session-1', null)
      const other = useGitLabQuery('session-1', null)
      return <><button onClick={refreshed.refresh} type="button">refresh</button><output data-testid="other">{other.error?.code ?? 'ok'}</output></>
    }
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IdleProbes /></QueryClientProvider>)

    act(() => screen.getByRole('button', { name: 'refresh' }).click())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByTestId('other')).toHaveTextContent('ok')
    expect(queryGitLabMock).not.toHaveBeenCalled()
  })

  it('shows a change GitLab confirmed on the data on screen at once', async () => {
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache' ? Promise.resolve(null) : Promise.resolve(snapshot('network')))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function NameProbe() {
      return <output data-testid="name">{useGitLabQuery('session-1', query).data?.[0]?.name ?? 'none'}</output>
    }
    render(<QueryClientProvider client={queryClient}><NameProbe /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('One'))

    act(() => applyConfirmedGitLabChange(queryClient, 'session-1', query, (projects) => projects.map((project) => ({ ...project, name: 'Renamed' }))))
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Renamed'))
    // Another session's or another query's data is not touched.
    act(() => applyConfirmedGitLabChange(queryClient, 'session-2', query, () => []))
    act(() => applyConfirmedGitLabChange(queryClient, 'session-1', { ...query, page: 2 }, () => []))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByTestId('name')).toHaveTextContent('Renamed')
  })

  it('opens a screen on a read made ahead of it, in the background, without reading again', async () => {
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache' ? Promise.resolve(null) : Promise.resolve(snapshot('network')))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    prefetchGitLabQuery(queryClient, 'session-1', query)
    await waitFor(() => expect(queryGitLabMock).toHaveBeenCalledWith(expect.objectContaining({ background: true, mode: 'network' })))

    renderProbe(queryClient)
    await waitFor(() => expect(screen.getByTestId('query-state')).toHaveTextContent('network:idle:ok'))
    expect(queryGitLabMock).toHaveBeenCalledTimes(2)
  })

  it('holds a screen waiting to show only until the saved data is checked, not for the network', async () => {
    let resolveCache: (value: GitLabSnapshot<Project[]> | null) => void = () => undefined
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache'
      ? new Promise((resolve) => { resolveCache = resolve })
      : new Promise(() => undefined))
    const release = vi.fn()
    const hold = vi.fn(() => release)
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ScreenReadinessContext.Provider value={hold}><QueryProbe /></ScreenReadinessContext.Provider></QueryClientProvider>)

    await waitFor(() => expect(queryGitLabMock).toHaveBeenCalledTimes(1))
    expect(hold).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()

    await act(async () => { resolveCache(null) })
    await waitFor(() => expect(queryGitLabMock).toHaveBeenCalledTimes(2))
    expect(release).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('query-state')).toHaveTextContent('none:idle:ok')
  })

  it('holds a screen waiting to show until saved data found has rendered', async () => {
    let resolveCache: (value: GitLabSnapshot<Project[]> | null) => void = () => undefined
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache'
      ? new Promise((resolve) => { resolveCache = resolve })
      : new Promise(() => undefined))
    let shownAtRelease = ''
    const release = vi.fn(() => { shownAtRelease = screen.getByTestId('query-state').textContent ?? '' })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ScreenReadinessContext.Provider value={() => release}>{/* Another session: the previous test's read never finishes. */}<QueryProbe sessionId="session-2" /></ScreenReadinessContext.Provider></QueryClientProvider>)

    await waitFor(() => expect(queryGitLabMock).toHaveBeenCalledTimes(1))
    await act(async () => { resolveCache(snapshot('cache')) })
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(shownAtRelease).toBe('cache:refreshing:ok')
  })

  it('hydrates a cache snapshot while the network refresh is in flight', async () => {
    let resolveNetwork: (value: GitLabSnapshot<Project[]>) => void = () => undefined
    const network = new Promise<GitLabSnapshot<Project[]>>((resolve) => { resolveNetwork = resolve })
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache' ? Promise.resolve(snapshot('cache')) : network)
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('query-state')).toHaveTextContent('cache:refreshing:ok'))
    expect(queryGitLabMock).toHaveBeenCalledTimes(2)

    resolveNetwork(snapshot('network'))
    await waitFor(() => expect(screen.getByTestId('query-state')).toHaveTextContent('network:idle:ok'))
  })

  it('reads the comments again whenever the window regains focus, but not other recent data', async () => {
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache' ? Promise.resolve(null) : Promise.resolve(snapshot('network')))
    const discussionsQuery = { iid: '2', kind: 'discussions' as const, page: 1, projectId: '1' }
    const mrQuery = { iid: '2', kind: 'mr' as const, projectId: '1' }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    function ReviewProbe() {
      const discussions = useGitLabQuery('session-1', discussionsQuery)
      const mr = useGitLabQuery('session-1', mrQuery)
      return <output data-testid="review-state">{`${discussions.snapshot ? 'loaded' : 'none'}:${mr.snapshot ? 'loaded' : 'none'}`}</output>
    }
    render(<QueryClientProvider client={queryClient}><ReviewProbe /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByTestId('review-state')).toHaveTextContent('loaded:loaded'))
    const networkReads = (kind: string) => queryGitLabMock.mock.calls.filter(([request]) => request.mode === 'network' && request.query.kind === kind).length
    expect(networkReads('discussions')).toBe(1)

    act(() => focusManager.onFocus())
    await waitFor(() => expect(networkReads('discussions')).toBe(2))
    expect(networkReads('mr')).toBe(1)
  })

  it('keeps polling more slowly after a failed read, but not after a denied one', async () => {
    queryGitLabMock.mockRejectedValue({ code: 'NETWORK', message: 'offline' })
    const mrQuery = { iid: '2', kind: 'mr' as const, projectId: '1' }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function MrProbe() {
      return <output data-testid="mr-state">{useGitLabQuery('session-1', mrQuery).error?.code ?? 'ok'}</output>
    }
    render(<QueryClientProvider client={queryClient}><MrProbe /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByTestId('mr-state')).toHaveTextContent('NETWORK'))

    const cached = queryClient.getQueryCache().find({ queryKey: ['gitlab', 'session-1', JSON.stringify(mrQuery)] })!
    const interval = cached.observers[0].options.refetchInterval as (current: unknown) => number | false
    expect(interval(cached)).toBe(5 * 60_000)
    expect(interval({ state: { data: undefined, error: { code: 'RATE_LIMITED', retryAfterMs: 10 * 60_000 } } })).toBe(10 * 60_000)
    expect(interval({ state: { data: undefined, error: { code: 'FORBIDDEN' } } })).toBe(false)
    expect(interval({ state: { data: { error: null, snapshot: null }, error: null } })).toBe(60_000)
  })

  it('refreshes data on screen three times less often while memory is short, leaving the slower polling after a failure as it is', async () => {
    queryGitLabMock.mockResolvedValue(snapshot('network'))
    const mrQuery = { iid: '3', kind: 'mr' as const, projectId: '1' }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function MrProbe() {
      return <output data-testid="mr-state">{useGitLabQuery('session-1', mrQuery).snapshot?.source ?? 'none'}</output>
    }
    const view = (constrained: boolean) => <QueryClientProvider client={queryClient}><MemoryPressure value={constrained}><MrProbe /></MemoryPressure></QueryClientProvider>
    const { rerender } = render(view(true))
    await waitFor(() => expect(screen.getByTestId('mr-state')).toHaveTextContent('network'))

    const cached = queryClient.getQueryCache().find({ queryKey: ['gitlab', 'session-1', JSON.stringify(mrQuery)] })!
    const interval = () => cached.observers[0].options.refetchInterval as (current: unknown) => number | false
    expect(interval()({ state: { data: { error: null, snapshot: null }, error: null } })).toBe(3 * 60_000)
    expect(interval()({ state: { data: undefined, error: { code: 'NETWORK' } } })).toBe(5 * 60_000)
    rerender(view(false))
    expect(interval()({ state: { data: { error: null, snapshot: null }, error: null } })).toBe(60_000)
  })

  it('keeps a denied resource empty without retrying it in a loop', async () => {
    queryGitLabMock.mockImplementation(({ mode }: { mode: string }) => mode === 'cache'
      ? Promise.resolve(snapshot('cache'))
      : Promise.reject({ code: 'FORBIDDEN', message: 'denied' }))
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('query-state')).toHaveTextContent('none:idle:FORBIDDEN'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(queryGitLabMock).toHaveBeenCalledTimes(2)
  })

  it('does not publish a late cache response or start a network request after unmount', async () => {
    let resolveCache!: (value: GitLabSnapshot<Project[]>) => void
    queryGitLabMock.mockImplementation(() => new Promise<GitLabSnapshot<Project[]>>((resolve) => { resolveCache = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = renderProbe(client)
    await waitFor(() => expect(queryGitLabMock).toHaveBeenCalledTimes(1))
    view.unmount()
    await act(async () => resolveCache(snapshot('cache')))
    expect(queryGitLabMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith('session-1', 'request-1')
    expect(client.getQueryData(['gitlab', 'session-1', JSON.stringify(query)])).toBeUndefined()
  })
})
