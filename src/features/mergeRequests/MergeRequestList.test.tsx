import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabSession } from '../../types/gitlab'
import { buildQuery, MergeRequestList } from './MergeRequestList'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: sessionFixture }),
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: queryMock,
}))

const sessionFixture: GitLabSession = {
  id: 'session-1',
  instanceUrl: 'https://gitlab.example/GitLab',
  serverVersion: null,
  user: { id: '42', name: 'Reviewer', username: 'reviewer' },
}

const emptyResult = {
  data: null,
  error: null,
  loading: false,
  refreshing: false,
  refresh: vi.fn(),
  snapshot: null,
  stale: false,
}

describe('MergeRequestList search filters', () => {
  beforeEach(() => {
    localStorage.clear()
    queryMock.mockReset()
    queryMock.mockReturnValue(emptyResult)
  })

  it('passes all applied filters to the typed query and maps self/date values', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })

    render(<MergeRequestList initialParams={{ authorId: '7', projectId: '9', reviewer: 'self', search: 'release', state: 'all', updatedAfter: '2026-01-01', updatedBefore: '2026-01-31', page: '3' }} onOpenMergeRequest={vi.fn()} />)

    expect(seen.at(-1)).toEqual({
      authorId: '7',
      kind: 'mrs',
      page: 3,
      projectId: '9',
      reviewerId: '42',
      search: 'release',
      state: 'all',
      updatedAfter: '2026-01-01T00:00:00.000Z',
      updatedBefore: '2026-01-31T23:59:59.999Z',
    })
  })

  it('stages search text until Enter/search is submitted', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    const search = screen.getByRole('textbox', { name: 'MRをタイトル・説明で検索' })

    fireEvent.change(search, { target: { value: 'without-submit' } })
    expect(seen.at(-1)).toMatchObject({ search: '' })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    fireEvent.submit(screen.getByRole('button', { name: '検索' }).closest('form') as HTMLFormElement)
    expect(seen.at(-1)).toMatchObject({ search: 'without-submit', state: 'all' })
  })

  it('applies a saved search including its project id', () => {
    localStorage.setItem('gitlab-desktop:preferences:https%3A%2F%2Fgitlab.example%2FGitLab:42:saved-searches', JSON.stringify([{ id: 'saved-1', label: 'Project history', projectId: '77', query: 'history', state: 'merged' }]))
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Project history' }))
    expect(seen.at(-1)).toMatchObject({ projectId: '77', search: 'history', state: 'merged' })
  })

  it('rejects invalid ids before a network query is changed', () => {
    const seen: unknown[] = []
    queryMock.mockImplementation((_sessionId: string, query: unknown) => {
      seen.push(query)
      return emptyResult
    })
    render(<MergeRequestList onOpenMergeRequest={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('MRのプロジェクトID'), { target: { value: 'project-slug' } })
    fireEvent.click(screen.getByRole('button', { name: '検索' }))

    expect(screen.getByText('プロジェクトIDは1以上の数字で入力してください。')).toBeInTheDocument()
    expect(seen.at(-1)).toMatchObject({ state: 'all' })
    expect(seen.at(-1)).not.toHaveProperty('projectId')
  })
})

describe('buildQuery', () => {
  it('keeps the default state explicit for project history', () => {
    expect(buildQuery({ authorId: '', page: 1, projectId: '12', reviewer: '', search: '', state: 'all', updatedAfter: '', updatedBefore: '' }, '42')).toEqual({ kind: 'mrs', page: 1, projectId: '12', search: '', state: 'all' })
  })
})
