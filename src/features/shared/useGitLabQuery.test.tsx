import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSnapshot, Project, ProjectQuery } from '../../types/gitlab'
import { useGitLabQuery } from './useGitLabQuery'

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

function QueryProbe() {
  const result = useGitLabQuery('session-1', query)
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
