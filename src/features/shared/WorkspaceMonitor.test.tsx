import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabQuery, GitLabSession, GitLabTodo, MergeRequest, Note, Position } from '../../types/gitlab'
import { WorkspaceMonitor } from './WorkspaceMonitor'

const mocks = vi.hoisted(() => ({
  session: null as GitLabSession | null,
  settings: { notifyComments: false, notifyTodos: false },
  results: new Map<string, { data: unknown; source: 'cache' | 'network' | null; error: unknown }>(),
  queryCalls: [] as Array<{ sessionId: string | null; query: GitLabQuery | null }>,
  notifyWorkspace: vi.fn(),
  observe: vi.fn(),
}))

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: mocks.session }),
}))

vi.mock('./personalWorkspace', () => ({
  usePersonalWorkspace: () => ({ settings: mocks.settings, observe: mocks.observe }),
}))

vi.mock('./useGitLabQuery', () => ({
  useGitLabQuery: (sessionId: string | null, query: GitLabQuery | null) => {
    mocks.queryCalls.push({ sessionId, query })
    const result = query ? mocks.results.get(JSON.stringify(query)) : undefined
    return {
      data: result?.data ?? null,
      error: result?.error ?? null,
      snapshot: result?.source ? { source: result.source } : null,
    }
  },
}))

vi.mock('../../lib/notifications', () => ({
  notifyWorkspace: mocks.notifyWorkspace,
}))

const session: GitLabSession = {
  id: 'session-1',
  instanceUrl: 'https://gitlab.example',
  user: { id: '42', username: 'reviewer', name: 'Reviewer' },
  serverVersion: null,
}

function setResult(query: GitLabQuery, data: unknown, source: 'cache' | 'network' = 'network') {
  mocks.results.set(JSON.stringify(query), { data, source, error: null })
}

function mr(id: number): MergeRequest {
  return {
    id: `mr-${id}`,
    iid: String(id),
    projectId: '7',
    title: `MR ${id}`,
    description: '',
    state: 'opened',
    webUrl: `https://gitlab.example/project/-/merge_requests/${id}`,
    author: { id: '9', username: 'author', name: 'Author' },
    sourceBranch: 'feature',
    targetBranch: 'main',
    updatedAt: `2026-10-${String(id).padStart(2, '0')}T09:00:00Z`,
    headSha: null,
    diffRefs: null,
  }
}

function note(id: string, authorId: string, createdAt: string, updatedAt?: string, system = false): Note {
  return {
    id,
    body: `note ${id}`,
    author: { id: authorId, username: authorId === '42' ? 'reviewer' : 'other', name: 'Other' },
    createdAt,
    updatedAt,
    system,
    resolvable: false,
    resolved: false,
    position: null as Position | null,
  }
}

function mrQuery(role: 'assignee' | 'reviewer'): GitLabQuery {
  return role === 'assignee'
    ? { kind: 'mrs', search: '', state: 'opened', assigneeId: '42', orderBy: 'updated_at', sort: 'desc', page: 1 }
    : { kind: 'mrs', search: '', state: 'opened', reviewerId: '42', orderBy: 'updated_at', sort: 'desc', page: 1 }
}

function noteQuery(iid: string): GitLabQuery {
  return { kind: 'notes', projectId: '7', iid, page: 1 }
}

function todo(id: string, body = `todo ${id}`): GitLabTodo {
  return {
    id,
    actionName: 'assigned',
    body,
    createdAt: '2026-10-01T09:00:00Z',
    projectId: '7',
    projectName: 'Project',
    iid: '120',
    title: 'MR 120',
    webUrl: 'https://gitlab.example/project/-/merge_requests/120',
    author: { id: '9', username: 'author', name: 'Author' },
  }
}

describe('WorkspaceMonitor', () => {
  beforeEach(() => {
    mocks.session = session
    mocks.settings.notifyComments = false
    mocks.settings.notifyTodos = false
    mocks.results.clear()
    mocks.queryCalls.length = 0
    mocks.notifyWorkspace.mockReset().mockResolvedValue(undefined)
    mocks.observe.mockReset()
    window.location.hash = ''
  })

  it('disables queries when notifications are off and bounds the initial MR snapshot to ten without notifying', () => {
    const view = render(<WorkspaceMonitor />)

    expect(mocks.queryCalls).toHaveLength(3)
    expect(mocks.queryCalls.every((call) => call.query === null)).toBe(true)

    const assigned = Array.from({ length: 7 }, (_, index) => mr(index + 1))
    const reviewers = Array.from({ length: 7 }, (_, index) => mr(index + 5))
    mocks.settings.notifyComments = true
    mocks.settings.notifyTodos = true
    setResult({ kind: 'todos', page: 1 }, [todo('todo-1')])
    setResult(mrQuery('assignee'), assigned)
    setResult(mrQuery('reviewer'), reviewers)
    for (let id = 2; id <= 11; id++) setResult(noteQuery(String(id)), [])

    view.rerender(<WorkspaceMonitor />)

    const noteQueries = mocks.queryCalls.flatMap(({ query }) => query?.kind === 'notes' ? [query] : [])
    expect(noteQueries).toHaveLength(10)
    expect(new Set(noteQueries.map(({ iid }) => iid)).size).toBe(10)
    expect(noteQueries.map(({ iid }) => iid)).toContain('11')
    expect(noteQueries.map(({ iid }) => iid)).not.toContain('1')
    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()
  })

  it('notifies only after network changes for new todos and edited or added non-system comments', async () => {
    mocks.settings.notifyComments = true
    mocks.settings.notifyTodos = true
    const onlyMr = [mr(120)]
    const initialNotes = [note('note-1', '9', '2026-10-01T09:00:00Z')]
    const todosQuery: GitLabQuery = { kind: 'todos', page: 1 }
    setResult(todosQuery, [todo('todo-1')])
    setResult(mrQuery('assignee'), onlyMr)
    setResult(mrQuery('reviewer'), [])
    setResult(noteQuery('120'), initialNotes)
    const view = render(<WorkspaceMonitor />)

    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()

    const nextNotes = [
      note('note-1', '9', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
      note('note-2', '9', '2026-10-01T11:00:00Z'),
      note('note-system', '9', '2026-10-01T12:00:00Z', undefined, true),
      note('note-own', '42', '2026-10-01T13:00:00Z'),
    ]
    setResult(todosQuery, [todo('todo-1', 'edited existing todo'), todo('todo-2')], 'cache')
    setResult(noteQuery('120'), nextNotes, 'cache')
    view.rerender(<WorkspaceMonitor />)
    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()

    setResult(todosQuery, [todo('todo-1', 'edited existing todo'), todo('todo-2')], 'network')
    setResult(noteQuery('120'), nextNotes, 'network')
    await act(async () => view.rerender(<WorkspaceMonitor />))

    expect(mocks.notifyWorkspace).toHaveBeenCalledTimes(2)
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith('新しいMR To-Doが1件あります。')
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith('担当・レビューMRに新着コメントが2件あります。')
  })

  it('suppresses comment notifications for the MR already open in the window hash', async () => {
    mocks.settings.notifyComments = true
    const onlyMr = [mr(120)]
    setResult(mrQuery('assignee'), onlyMr)
    setResult(mrQuery('reviewer'), [])
    setResult(noteQuery('120'), [note('note-1', '9', '2026-10-01T09:00:00Z')])
    const view = render(<WorkspaceMonitor />)

    window.location.hash = '#client/mr?projectId=7&iid=120'
    setResult(noteQuery('120'), [
      note('note-1', '9', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
      note('note-2', '9', '2026-10-01T11:00:00Z'),
    ])
    await act(async () => view.rerender(<WorkspaceMonitor />))

    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()
  })
})
