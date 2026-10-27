import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  notify: vi.fn(),
  openExternalUrl: vi.fn(),
  openGitLabUrl: vi.fn(),
  queryGitLab: vi.fn(),
  session: null as { id: string; instanceUrl: string } | null,
}))

vi.mock('../../components/feedbackContext', () => ({ useNotify: () => mocks.notify }))
vi.mock('../../lib/gitlab', () => ({
  normalizeGitLabError: (error: unknown) => error instanceof Error ? error : new Error('GitLab error'),
  openExternalUrl: mocks.openExternalUrl,
  openGitLabUrl: mocks.openGitLabUrl,
  queryGitLab: mocks.queryGitLab,
}))
vi.mock('../../lib/runtime', () => ({ isTauri: mocks.isTauri }))
vi.mock('../connections/connectionContext', () => ({ useConnection: () => ({ session: mocks.session }) }))

import { useOpenMarkdownLink } from './useOpenMarkdownLink'

const alice = { id: 'user-1', name: 'Alice', username: 'alice' }

function LinkProbe({ url, onOpenMergeRequest = vi.fn(), onOpenPage, onOpenUser = vi.fn() }: {
  url: string
  onOpenMergeRequest?: (ref: { projectId: string; iid: string }) => void
  onOpenPage?: (location: { route: string; params: Record<string, string> }) => void
  onOpenUser?: (user: typeof alice) => void
}) {
  const openLink = useOpenMarkdownLink(onOpenMergeRequest, onOpenUser, onOpenPage)
  return <button onClick={() => openLink?.(url)} type="button">open</button>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('useOpenMarkdownLink', () => {
  beforeEach(() => {
    mocks.session = { id: 'session-1', instanceUrl: 'https://gitlab.example/gitlab' }
    mocks.isTauri.mockReset().mockReturnValue(true)
    mocks.notify.mockReset()
    mocks.openExternalUrl.mockReset().mockResolvedValue(undefined)
    mocks.openGitLabUrl.mockReset().mockResolvedValue(undefined)
    mocks.queryGitLab.mockReset()
  })

  it('opens a project page in the app, and a group page in the browser', async () => {
    mocks.queryGitLab.mockImplementation(async ({ query }: { query: { path: string } }) => {
      if (query.path === 'team/desktop') return { data: { id: '42', name: 'Desktop', webUrl: 'https://gitlab.example/gitlab/team/desktop' } }
      throw new Error('404')
    })
    const onOpenPage = vi.fn()
    const { rerender } = render(<LinkProbe onOpenPage={onOpenPage} url="https://gitlab.example/gitlab/team/desktop/-/branches" />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(onOpenPage).toHaveBeenCalledWith({ route: 'branches', params: { projectId: '42', projectName: 'Desktop' } }))

    rerender(<LinkProbe onOpenPage={onOpenPage} url="https://gitlab.example/gitlab/team/sub" />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(mocks.openGitLabUrl).toHaveBeenCalledWith('session-1', 'https://gitlab.example/gitlab/team/sub'))
    expect(onOpenPage).toHaveBeenCalledTimes(1)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('opens an exact profile result in the app for a GitLab subpath URL', async () => {
    mocks.queryGitLab.mockResolvedValue({ data: alice })
    const onOpenUser = vi.fn()
    render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/alice/" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(onOpenUser).toHaveBeenCalledWith(alice))
    expect(mocks.queryGitLab).toHaveBeenCalledWith({
      sessionId: 'session-1',
      mode: 'network',
      query: { kind: 'user', username: 'alice' },
    })
    expect(mocks.openGitLabUrl).not.toHaveBeenCalled()
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })

  it('recognizes GitLab’s canonical profile route', async () => {
    mocks.queryGitLab.mockResolvedValue({ data: alice })
    const onOpenUser = vi.fn()
    render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/-/u/42" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(onOpenUser).toHaveBeenCalledWith(alice))
    expect(mocks.queryGitLab).toHaveBeenCalledWith(expect.objectContaining({ query: { kind: 'userById', userId: '42' } }))
  })

  it('decodes an ASCII-encoded username before looking it up', async () => {
    mocks.queryGitLab.mockResolvedValue({ data: alice })
    const onOpenUser = vi.fn()
    render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/%61lice" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(onOpenUser).toHaveBeenCalledWith(alice))
    expect(mocks.queryGitLab).toHaveBeenCalledWith(expect.objectContaining({ query: { kind: 'user', username: 'alice' } }))
  })

  it('checks usernames with repeated punctuation through the exact lookup', async () => {
    const user = { id: 'user-3', name: 'John Smith', username: 'john--smith' }
    mocks.queryGitLab.mockResolvedValue({ data: user })
    const onOpenUser = vi.fn()
    render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/john--smith" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(onOpenUser).toHaveBeenCalledWith(user))
  })

  it('opens unknown profiles as normal GitLab pages', async () => {
    mocks.queryGitLab.mockResolvedValue(null)
    render(<LinkProbe url="https://gitlab.example/gitlab/unknown-user" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(mocks.openGitLabUrl).toHaveBeenCalledWith('session-1', 'https://gitlab.example/gitlab/unknown-user'))
  })

  it('does not exclude a username merely because it starts with a reserved route name', async () => {
    const user = { ...alice, username: 'help.me' }
    mocks.queryGitLab.mockResolvedValue({ data: user })
    const onOpenUser = vi.fn()
    render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/help.me" />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(onOpenUser).toHaveBeenCalledWith(user))
  })

  it('keeps links outside the connected instance path in the browser', async () => {
    render(<><LinkProbe url="https://gitlab.example/group/project" /><LinkProbe url="https://other.gitlab.example/alice" /></>)

    const links = screen.getAllByRole('button', { name: 'open' })
    fireEvent.click(links[0])
    fireEvent.click(links[1])

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledTimes(2))
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://gitlab.example/group/project')
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://other.gitlab.example/alice')
    expect(mocks.queryGitLab).not.toHaveBeenCalled()
  })

  it('preserves merge request navigation', async () => {
    mocks.queryGitLab.mockResolvedValue({ data: { id: 'project-7' } })
    const onOpenMergeRequest = vi.fn()
    render(<LinkProbe onOpenMergeRequest={onOpenMergeRequest} url="https://gitlab.example/gitlab/team/project/-/merge_requests/42" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(onOpenMergeRequest).toHaveBeenCalledWith({ projectId: 'project-7', iid: '42' }))
    expect(mocks.queryGitLab).toHaveBeenCalledWith({
      sessionId: 'session-1', mode: 'network', query: { kind: 'project', path: 'team/project' },
    })
  })

  it('notifies when profile lookup fails and does not open the URL elsewhere', async () => {
    mocks.queryGitLab.mockRejectedValue(new Error('offline'))
    render(<LinkProbe url="https://gitlab.example/gitlab/alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ message: 'リンクを開けませんでした: offline', severity: 'error' }))
    expect(mocks.openGitLabUrl).not.toHaveBeenCalled()
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })

  it('ignores a lookup result after the connected session changes', async () => {
    const lookup = deferred<{ data: typeof alice }>()
    mocks.queryGitLab.mockReturnValue(lookup.promise)
    const onOpenUser = vi.fn()
    const view = render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(mocks.queryGitLab).toHaveBeenCalledTimes(1))
    mocks.session = { id: 'session-2', instanceUrl: 'https://other.example' }
    view.rerender(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/alice" />)
    await act(async () => lookup.resolve({ data: alice }))

    expect(onOpenUser).not.toHaveBeenCalled()
    expect(mocks.openGitLabUrl).not.toHaveBeenCalled()
  })

  it('does not treat reserved paths, invalid usernames, or credential URLs as user profiles', async () => {
    render(<>
      <LinkProbe url="https://gitlab.example/gitlab/users" />
      <LinkProbe url="https://gitlab.example/gitlab/_alice" />
      <LinkProbe url="https://gitlab.example/gitlab/alice%2Fgroup" />
      <LinkProbe url="https://reviewer:secret@gitlab.example/gitlab/alice" />
    </>)

    fireEvent.click(screen.getAllByRole('button', { name: 'open' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'open' })[1])
    fireEvent.click(screen.getAllByRole('button', { name: 'open' })[2])
    fireEvent.click(screen.getAllByRole('button', { name: 'open' })[3])

    await waitFor(() => expect(mocks.openGitLabUrl).toHaveBeenCalledTimes(4))
    expect(mocks.openGitLabUrl).toHaveBeenCalledWith('session-1', 'https://gitlab.example/gitlab/users')
    expect(mocks.openGitLabUrl).toHaveBeenCalledWith('session-1', 'https://gitlab.example/gitlab/_alice')
    expect(mocks.openGitLabUrl).toHaveBeenCalledWith('session-1', 'https://gitlab.example/gitlab/alice%2Fgroup')
    expect(mocks.openGitLabUrl).toHaveBeenCalledWith('session-1', 'https://reviewer:secret@gitlab.example/gitlab/alice')
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
    expect(mocks.queryGitLab).not.toHaveBeenCalled()
  })

  it('ignores an older lookup when a newer profile link is clicked', async () => {
    const firstLookup = deferred<{ data: typeof alice }>()
    mocks.queryGitLab.mockReturnValueOnce(firstLookup.promise).mockResolvedValueOnce({ data: { id: 'user-2', name: 'Bob', username: 'bob' } })
    const onOpenUser = vi.fn()
    const view = render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(mocks.queryGitLab).toHaveBeenCalledTimes(1))
    view.rerender(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/bob" />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(onOpenUser).toHaveBeenCalledWith({ id: 'user-2', name: 'Bob', username: 'bob' }))
    await act(async () => firstLookup.resolve({ data: alice }))

    expect(onOpenUser).toHaveBeenCalledTimes(1)
  })

  it('does not open an unknown profile after the hook unmounts', async () => {
    const lookup = deferred<null>()
    mocks.queryGitLab.mockReturnValue(lookup.promise)
    const view = render(<LinkProbe url="https://gitlab.example/gitlab/alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(mocks.queryGitLab).toHaveBeenCalledTimes(1))
    view.unmount()
    await act(async () => lookup.resolve(null))

    expect(mocks.openGitLabUrl).not.toHaveBeenCalled()
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })

  it('does not navigate to a profile after another in-app location change', async () => {
    const lookup = deferred<{ data: typeof alice }>()
    mocks.queryGitLab.mockReturnValue(lookup.promise)
    const onOpenUser = vi.fn()
    render(<LinkProbe onOpenUser={onOpenUser} url="https://gitlab.example/gitlab/alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await waitFor(() => expect(mocks.queryGitLab).toHaveBeenCalledTimes(1))
    act(() => globalThis.dispatchEvent(new Event('gitlab-client-location-change')))
    await act(async () => lookup.resolve({ data: alice }))

    expect(onOpenUser).not.toHaveBeenCalled()
    expect(mocks.openGitLabUrl).not.toHaveBeenCalled()
  })
})
