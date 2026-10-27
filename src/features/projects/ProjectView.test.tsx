import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSession, GitLabUser, Project } from '../../types/gitlab'
import { forgetRememberedListStates } from './listState'
import { ProjectView } from './ProjectView'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: queryMock,
}))

const sessionFixture: GitLabSession = {
  id: 'session-projects',
  instanceUrl: 'https://gitlab.example/GitLab',
  serverVersion: null,
  user: { id: '42', name: 'Reviewer', username: 'reviewer' },
}

const emptyResult = {
  data: [],
  error: null,
  loading: false,
  refreshing: false,
  refresh: vi.fn(),
  snapshot: { completeness: 'page' as const, data: [], fetchedAt: Date.now(), nextPage: null, source: 'network' as const },
  stale: false,
}

describe('ProjectView', () => {
  beforeEach(() => {
    localStorage.clear()
    forgetRememberedListStates()
    queryMock.mockReset()
    queryMock.mockReturnValue(emptyResult)
  })

  it('stages project search until Enter/search is submitted', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<ProjectView onOpenProject={vi.fn()} />)
    const search = screen.getByRole('textbox', { name: 'プロジェクトを検索' })

    fireEvent.change(search, { target: { value: 'platform' } })
    expect(seen.at(-1)).toMatchObject({ search: '' })
    fireEvent.submit(screen.getByRole('button', { name: '検索' }).closest('form') as HTMLFormElement)
    expect(seen.at(-1)).toMatchObject({ search: 'platform' })
  })

  it('queries a selected user without membership filtering, hides shortcuts, and keeps row favourites', () => {
    const user: GitLabUser = { id: '9', name: 'Target User', username: 'target' }
    const project: Project = { archived: false, description: '', id: '77', name: 'Desktop', pathWithNamespace: 'target/desktop', webUrl: '' }
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:pinned', JSON.stringify(['77']))
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:recent', JSON.stringify(['9002']))
    queryMock.mockReturnValue({ ...emptyResult, data: [project], snapshot: { ...emptyResult.snapshot, nextPage: 2 } })

    render(<ProjectView navigation={<div>Users</div>} onOpenProject={vi.fn()} user={user} />)

    expect(queryMock).toHaveBeenLastCalledWith('session-projects', { includeArchived: false, kind: 'userProjects', page: 1, search: '', userId: '9' }, { keepPrevious: true })
    expect(screen.getByText('@target の個人領域（グループ内は含みません）')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '参加中のプロジェクトだけ' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('プロジェクトへのショートカット')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desktopをお気に入りから外す' })).toBeInTheDocument()
    expect(screen.queryByText(/プロフィールが非公開/u)).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'プロジェクトを検索' }), { target: { value: 'platform' } })
    fireEvent.submit(screen.getByRole('button', { name: '検索' }).closest('form') as HTMLFormElement)
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', { includeArchived: false, kind: 'userProjects', page: 1, search: 'platform', userId: '9' }, { keepPrevious: true })
    fireEvent.click(screen.getByRole('switch', { name: 'アーカイブ済みを含める' }))
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', expect.objectContaining({ includeArchived: true, kind: 'userProjects', page: 1, search: 'platform', userId: '9' }), { keepPrevious: true })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', expect.objectContaining({ includeArchived: true, kind: 'userProjects', page: 2, search: 'platform', userId: '9' }), { keepPrevious: true })
  })

  it('keeps each selected user project list state separate', () => {
    const alice: GitLabUser = { id: '9', name: 'Alice', username: 'alice' }
    const bob: GitLabUser = { id: '10', name: 'Bob', username: 'bob' }
    const view = render(<ProjectView onOpenProject={vi.fn()} user={alice} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'プロジェクトを検索' }), { target: { value: 'platform' } })
    fireEvent.submit(screen.getByRole('button', { name: '検索' }).closest('form') as HTMLFormElement)

    view.rerender(<ProjectView onOpenProject={vi.fn()} user={bob} />)
    expect(screen.getByRole('textbox', { name: 'プロジェクトを検索' })).toHaveValue('')
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', expect.objectContaining({ kind: 'userProjects', search: '', userId: '10' }), { keepPrevious: true })

    view.rerender(<ProjectView onOpenProject={vi.fn()} user={alice} />)
    expect(screen.getByRole('textbox', { name: 'プロジェクトを検索' })).toHaveValue('platform')
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', expect.objectContaining({ kind: 'userProjects', search: 'platform', userId: '9' }), { keepPrevious: true })
  })

  it('explains that a user project can be hidden by profile visibility or permissions', () => {
    render(<ProjectView onOpenProject={vi.fn()} user={{ id: '9', name: 'Target User', username: 'target' }} />)

    expect(screen.getByText(/プロフィールが非公開、または閲覧権限がないプロジェクトは表示されない場合があります/u)).toBeInTheDocument()
  })

  it('opens persisted pinned and recent ids without fabricating project data', () => {
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:pinned', JSON.stringify(['9001']))
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:recent', JSON.stringify(['9002']))
    const onOpenProjectId = vi.fn()
    render(<ProjectView onOpenProject={vi.fn()} onOpenProjectId={onOpenProjectId} />)

    expect(screen.getByRole('button', { name: 'プロジェクト 9001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プロジェクト 9002' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクト 9001' }))
    expect(onOpenProjectId).toHaveBeenCalledWith('9001')
  })

  it('keeps the name of a pinned project, and learns it for ids pinned before names were kept', () => {
    const desktop: Project = { archived: false, description: '', id: '77', name: 'Desktop', pathWithNamespace: 'team/desktop', webUrl: 'https://gitlab.example/team/desktop' }
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:pinned', JSON.stringify(['77']))
    queryMock.mockReturnValue({ ...emptyResult, data: [desktop] })
    const view = render(<ProjectView onOpenProject={vi.fn()} />)
    expect(within(screen.getByLabelText('プロジェクトへのショートカット')).getByRole('button', { name: 'Desktop（team/desktop）' })).toBeInTheDocument()

    // The next visit shows the name although the project is not on the page.
    view.unmount()
    queryMock.mockReturnValue(emptyResult)
    render(<ProjectView onOpenProject={vi.fn()} />)
    expect(within(screen.getByLabelText('プロジェクトへのショートカット')).getByRole('button', { name: 'Desktop（team/desktop）' })).toBeInTheDocument()
  })

  it('keeps its conditions when it is left and opened again, and clears them back to the defaults', () => {
    const view = render(<ProjectView onOpenProject={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'プロジェクトを検索' }), { target: { value: 'platform' } })
    fireEvent.submit(screen.getByRole('button', { name: '検索' }).closest('form') as HTMLFormElement)
    fireEvent.click(screen.getByRole('switch', { name: 'アーカイブ済みを含める' }))
    view.unmount()

    render(<ProjectView onOpenProject={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'プロジェクトを検索' })).toHaveValue('platform')
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', expect.objectContaining({ includeArchived: true, search: 'platform' }), { keepPrevious: true })
    expect(screen.getByText(/適用中の条件: 検索語「platform」 · 参加中のみ · アーカイブ済みを含む/u)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '条件をクリア' })[0])
    expect(queryMock).toHaveBeenLastCalledWith('session-projects', expect.objectContaining({ includeArchived: false, membership: true, page: 1, search: '' }), { keepPrevious: true })
    expect(screen.queryByRole('button', { name: '条件をクリア' })).not.toBeInTheDocument()
  })

  it('names rows with their path, moves between them by keyboard, and retries a failed refresh', () => {
    const refresh = vi.fn()
    const projects: Project[] = [
      { archived: false, description: '', id: '1', lastActivityAt: '2026-10-09T00:00:00.000Z', name: 'Web', pathWithNamespace: 'team/web', webUrl: '' },
      { archived: false, description: '', id: '2', name: 'Web', pathWithNamespace: 'other/web', webUrl: '' },
    ]
    queryMock.mockReturnValue({ ...emptyResult, data: projects, error: new Error('offline'), refresh, stale: true })
    render(<ProjectView onOpenProject={vi.fn()} />)

    const first = screen.getByRole('button', { name: 'Web（team/web）' })
    const second = screen.getByRole('button', { name: 'Web（other/web）' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Home' })
    expect(document.activeElement).toBe(first)

    expect(within(first).getByText(/^活動 /u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(refresh).toHaveBeenCalled()
  })
})
