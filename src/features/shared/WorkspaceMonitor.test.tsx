import { act, render, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabQuery, GitLabSession, GitLabTodo, MergeRequest, Note, Position } from '../../types/gitlab'
import { useLoadedActivity } from '../mergeRequests/activityStore'
import { WorkspaceMonitor } from './WorkspaceMonitor'

const mocks = vi.hoisted(() => ({
  session: null as GitLabSession | null,
  settings: { notifyComments: false, notifyTodos: false, showActivity: false },
  results: new Map<string, { data: unknown; source: 'cache' | 'network' | null; error: unknown }>(),
  queryCalls: [] as Array<{ sessionId: string | null; query: GitLabQuery | null }>,
  notifyWorkspace: vi.fn(),
  observe: vi.fn(),
  refresh: vi.fn(),
  startActivity: vi.fn(),
}))

vi.mock('../connections/connectionContext', () => ({
  useConnection: () => ({ session: mocks.session }),
}))

vi.mock('./personalWorkspace', () => ({
  mrRefKey: (ref: { projectId: string; iid: string }) => `${ref.projectId}:${ref.iid}`,
  usePersonalWorkspace: () => ({ settings: mocks.settings, observe: mocks.observe, startActivity: mocks.startActivity }),
}))

vi.mock('./useGitLabQuery', () => ({
  useGitLabQuery: (sessionId: string | null, query: GitLabQuery | null) => {
    mocks.queryCalls.push({ sessionId, query })
    const result = query ? mocks.results.get(JSON.stringify(query)) : undefined
    return {
      data: result?.data ?? null,
      error: result?.error ?? null,
      snapshot: result?.source ? { source: result.source } : null,
      refresh: mocks.refresh,
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

function mrQuery(role: 'authorId' | 'assigneeId' | 'reviewerId'): GitLabQuery {
  const updatedAfter = `${new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString().slice(0, 10)}T00:00:00Z`
  return { kind: 'mrs', search: '', state: 'all', [role]: '42', updatedAfter, orderBy: 'updated_at', sort: 'desc', page: 1 }
}

function setMergeRequests(authored: MergeRequest[], assigned: MergeRequest[] = [], reviewing: MergeRequest[] = []) {
  setResult(mrQuery('authorId'), authored)
  setResult(mrQuery('assigneeId'), assigned)
  setResult(mrQuery('reviewerId'), reviewing)
}

function noteQuery(iid: string): GitLabQuery {
  return { kind: 'notes', projectId: '7', iid, page: 1 }
}

function todo(id: string, body = `todo ${id}`, actionName = 'mentioned'): GitLabTodo {
  return {
    id,
    actionName,
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
    mocks.settings.showActivity = false
    mocks.results.clear()
    mocks.queryCalls.length = 0
    mocks.notifyWorkspace.mockReset().mockResolvedValue(undefined)
    mocks.observe.mockReset()
    mocks.refresh.mockReset()
    mocks.startActivity.mockReset()
    window.location.hash = ''
  })

  it('disables queries when activity and notifications are off and follows the twenty most recently updated MRs without notifying', () => {
    const view = render(<WorkspaceMonitor />)

    expect(mocks.queryCalls).toHaveLength(4)
    expect(mocks.queryCalls.every((call) => call.query === null)).toBe(true)
    expect(mocks.startActivity).not.toHaveBeenCalled()

    mocks.settings.showActivity = true
    mocks.settings.notifyTodos = true
    setResult({ kind: 'todos', page: 1 }, [todo('todo-1')])
    setMergeRequests(Array.from({ length: 10 }, (_, index) => mr(index + 1)), Array.from({ length: 10 }, (_, index) => mr(index + 8)), Array.from({ length: 8 }, (_, index) => mr(index + 15)))
    for (let id = 1; id <= 22; id++) setResult(noteQuery(String(id)), [])

    view.rerender(<WorkspaceMonitor />)

    const noteQueries = mocks.queryCalls.flatMap(({ query }) => query?.kind === 'notes' ? [query] : [])
    expect(new Set(noteQueries.map(({ iid }) => iid)).size).toBe(20)
    expect(noteQueries.map(({ iid }) => iid)).toContain('22')
    expect(noteQueries.map(({ iid }) => iid)).not.toContain('2')
    expect(mocks.startActivity).toHaveBeenCalled()
    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()
  })

  it('shares the events it finds, also from saved notes, and reads the notes again when the MR is updated', () => {
    mocks.settings.showActivity = true
    setMergeRequests([mr(120)])
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000).toISOString()
    // A comment older than fourteen days is left out as well as the system note that is no event.
    setResult(noteQuery('120'), [note('note-1', '9', hoursAgo(2)), note('note-2', '9', hoursAgo(1), undefined, true), note('note-old', '9', hoursAgo(15 * 24))], 'cache')
    const view = render(<WorkspaceMonitor />)
    const loaded = renderHook(() => useLoadedActivity('session-1'))

    expect(loaded.result.current.map((item) => item.id)).toEqual(['note-1'])
    expect(mocks.observe).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()

    setMergeRequests([{ ...mr(120), updatedAt: '2026-10-21T09:00:00Z' }])
    view.rerender(<WorkspaceMonitor />)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    view.unmount()
    loaded.rerender()
    expect(loaded.result.current).toEqual([])
  })

  it('notifies only after network changes for new todos and new comments and events by others', async () => {
    mocks.settings.notifyComments = true
    mocks.settings.notifyTodos = true
    const onlyMr = [mr(120)]
    const initialNotes = [note('note-1', '9', '2026-10-01T09:00:00Z')]
    const todosQuery: GitLabQuery = { kind: 'todos', page: 1 }
    setResult(todosQuery, [todo('todo-1')])
    setMergeRequests([], onlyMr)
    setResult(noteQuery('120'), initialNotes)
    const view = render(<WorkspaceMonitor />)

    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()

    const nextNotes = [
      note('note-1', '9', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
      note('note-2', '9', '2026-10-01T11:00:00Z'),
      { ...note('note-approved', '9', '2026-10-01T12:00:00Z', undefined, true), body: 'approved this merge request' },
      note('note-label', '9', '2026-10-01T12:30:00Z', undefined, true),
      note('note-own', '42', '2026-10-01T13:00:00Z'),
    ]
    setResult(todosQuery, [todo('todo-1', 'edited existing todo'), todo('todo-2')], 'cache')
    setResult(noteQuery('120'), nextNotes, 'cache')
    view.rerender(<WorkspaceMonitor />)
    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()

    // Being assigned is shown by the MR list's tabs, not as a notification.
    setResult(todosQuery, [todo('todo-1', 'edited existing todo'), todo('todo-2'), todo('todo-3', undefined, 'assigned')], 'network')
    setResult(noteQuery('120'), nextNotes, 'network')
    await act(async () => view.rerender(<WorkspaceMonitor />))

    expect(mocks.notifyWorkspace).toHaveBeenCalledTimes(2)
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith('新しい通知が1件あります。')
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith('自分のMRに新しい更新が2件あります。')
  })

  it('suppresses activity notifications for the MR already open in the window hash', async () => {
    mocks.settings.notifyComments = true
    setMergeRequests([], [], [mr(120)])
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
