import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSession } from '../../types/gitlab'
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

  it('opens persisted pinned and recent ids without fabricating project data', () => {
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:pinned', JSON.stringify(['9001']))
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:recent', JSON.stringify(['9002']))
    const onOpenProjectId = vi.fn()
    render(<ProjectView onOpenProject={vi.fn()} onOpenProjectId={onOpenProjectId} />)

    expect(screen.getByRole('button', { name: 'Project 9001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project 9002' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Project 9001' }))
    expect(onOpenProjectId).toHaveBeenCalledWith('9001')
  })
})
