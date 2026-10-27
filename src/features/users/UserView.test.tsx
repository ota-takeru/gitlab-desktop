import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSession, GitLabSnapshot, GitLabUser } from '../../types/gitlab'
import { UserView } from './UserView'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../connections/connectionContext', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))

vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

vi.mock('../mergeRequests/MergeRequestList', () => ({
  MergeRequestList: ({ author }: { author?: GitLabUser }) => <div data-author-id={author?.id} data-testid="user-mr-list" />,
}))

vi.mock('../projects/ProjectView', () => ({
  ProjectView: ({ user }: { user?: GitLabUser }) => <div data-testid="user-project-list" data-user-id={user?.id} />,
}))

vi.mock('../shared/GitLabUserAvatar', () => ({ GitLabUserAvatar: () => <span aria-hidden="true" /> }))

const sessionFixture: GitLabSession = {
  id: 'session-user-view',
  instanceUrl: 'https://gitlab.example',
  serverVersion: null,
  user: { id: '42', name: 'Reviewer', username: 'reviewer' },
}

const alice: GitLabUser = { id: '9', name: 'Alice Example', username: 'alice' }
const bob: GitLabUser = { id: '10', name: 'Bob Example', username: 'bob' }

interface UserViewQueryResult {
  data: GitLabUser | null
  error: Error | null
  loading: boolean
  previous: boolean
  refreshing: boolean
  refresh: () => void
  snapshot: GitLabSnapshot<GitLabUser | null> | null
  stale: boolean
}

function emptyResult(): UserViewQueryResult {
  return { data: null, error: null, loading: false, previous: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false }
}

function snapshot<T>(data: T): GitLabSnapshot<T> {
  return { completeness: 'complete', data, fetchedAt: Date.now(), nextPage: null, source: 'network' }
}

function props(username: string, initialParams: Record<string, string> = {}) {
  return {
    initialParams,
    onOpenMergeRequest: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenProjectId: vi.fn(),
    onSearchStateChange: vi.fn(),
    onTabChange: vi.fn(),
    recentMrId: null,
    selected: null,
    username,
  }
}

describe('UserView query states', () => {
  beforeEach(() => {
    queryMock.mockReset().mockReturnValue(emptyResult())
  })

  it('moves from initial loading to not found when the snapshot contains no user', () => {
    queryMock.mockReturnValueOnce({ ...emptyResult(), loading: true })
    const view = render(<UserView {...props('missing')} />)

    expect(screen.getAllByText('ユーザーを読み込み中…').length).toBeGreaterThan(0)
    expect(screen.queryByText('ユーザーが見つかりません')).not.toBeInTheDocument()

    queryMock.mockReturnValue({ ...emptyResult(), snapshot: snapshot<GitLabUser | null>(null) })
    view.rerender(<UserView {...props('missing')} />)

    expect(screen.getByText('ユーザーが見つかりません')).toBeInTheDocument()
    expect(screen.getByText('ユーザー名が変更されたか、この接続では参照できない可能性があります。')).toBeInTheDocument()
    expect(queryMock).toHaveBeenLastCalledWith('session-user-view', { kind: 'user', username: 'missing' })
    expect(screen.queryByTestId('user-mr-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('user-project-list')).not.toBeInTheDocument()
  })

  it('shows a query error with a retry action', () => {
    const refresh = vi.fn()
    queryMock.mockReturnValue({ ...emptyResult(), error: new Error('offline'), refresh })
    render(<UserView {...props('alice')} />)

    expect(screen.getByRole('alert')).toHaveTextContent('offline')
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('user-mr-list')).not.toBeInTheDocument()
  })

  it('keeps stale user lists visible and warns when refreshing the user failed', () => {
    queryMock.mockReturnValue({
      ...emptyResult(),
      data: alice,
      error: new Error('offline'),
      snapshot: snapshot(alice),
      stale: true,
    })
    render(<UserView {...props('alice')} />)

    expect(screen.getByRole('alert')).toHaveTextContent('保存済みのユーザー情報を表示中です。更新に失敗しました: offline')
    expect(screen.getByTestId('user-mr-list')).toHaveAttribute('data-author-id', '9')
  })

  it('does not show the previous username list while the next user is loading', () => {
    const byUsername = new Map<string, UserViewQueryResult>([
      ['alice', { ...emptyResult(), data: alice, snapshot: snapshot(alice) }],
      ['bob', { ...emptyResult(), loading: true }],
    ])
    queryMock.mockImplementation((_sessionId: string | null, query: { kind: 'user'; username: string }) => byUsername.get(query.username) ?? emptyResult())
    const view = render(<UserView {...props('alice')} />)

    expect(screen.getByTestId('user-mr-list')).toHaveAttribute('data-author-id', '9')
    view.rerender(<UserView {...props('bob')} />)

    expect(queryMock).toHaveBeenLastCalledWith('session-user-view', { kind: 'user', username: 'bob' })
    expect(screen.getByText('@bob')).toBeInTheDocument()
    expect(screen.getAllByText('ユーザーを読み込み中…').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('user-mr-list')).not.toBeInTheDocument()

    byUsername.set('bob', { ...emptyResult(), data: bob, snapshot: snapshot(bob) })
    view.rerender(<UserView {...props('bob')} />)
    expect(screen.getByTestId('user-mr-list')).toHaveAttribute('data-author-id', '10')
  })
})
