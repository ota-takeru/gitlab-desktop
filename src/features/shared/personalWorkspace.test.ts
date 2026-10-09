import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { GitLabSession, Note } from '../../types/gitlab'
import { clearPreferences, preferenceScope, scopedKey } from './preferences'
import { observeComments, readWorkspace, unreadComments, usePersonalWorkspace, workspaceUnreadCount } from './personalWorkspace'

const scope = preferenceScope('https://gitlab.example/GitLab', '42')
const ref = { iid: '3', projectId: '77' }
const session: GitLabSession = {
  id: 'session-1',
  instanceUrl: scope.instanceUrl,
  serverVersion: null,
  user: { id: scope.userId, name: 'Reviewer', username: 'reviewer' },
}

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    author: { id: '7', name: 'Other user', username: 'other' },
    body: `comment ${id}`,
    createdAt: '2026-10-08T10:00:00.000Z',
    id,
    position: null,
    resolvable: false,
    resolved: false,
    system: false,
    ...overrides,
  }
}

it('does not publish preference changes for unchanged comments from another watched MR', () => {
  localStorage.clear()
  let changes = 0
  const countChange = () => { changes += 1 }
  globalThis.addEventListener('gitlab-workspace-preferences-change', countChange)
  try {
    observeComments(scope, ref, [makeNote('1')], '42')
    observeComments(scope, { projectId: '77', iid: '4' }, [makeNote('2')], '42')
    observeComments(scope, ref, [makeNote('1')], '42')
    expect(changes).toBe(2)
  } finally { globalThis.removeEventListener('gitlab-workspace-preferences-change', countChange) }
})

it('evicts older MR reading markers when the shared marker budget fills', () => {
  localStorage.clear()
  for (let mr = 1; mr <= 5; mr += 1) {
    const notes = Array.from({ length: 2000 }, (_, index) => makeNote(String(mr * 2000 + index + 1)))
    observeComments(scope, { projectId: '77', iid: String(mr) }, notes, '42', true)
  }
  const data = readWorkspace(scope)
  expect(data.reading['77:1']).toBeUndefined()
  expect(Object.keys(data.reading)).toHaveLength(4)
  expect(workspaceUnreadCount(scope, { projectId: '77', iid: '5' })).toBe(0)
})

describe('personal workspace reading markers', () => {
  beforeEach(() => localStorage.clear())

  it('isolates unread markers by account and case-sensitive instance base path', () => {
    observeComments(scope, ref, [makeNote('1')], session.user.id)

    expect(workspaceUnreadCount(scope, ref)).toBe(1)
    expect(workspaceUnreadCount(preferenceScope(scope.instanceUrl, '43'), ref)).toBeUndefined()
    expect(workspaceUnreadCount(preferenceScope('https://gitlab.example/gitlab', scope.userId), ref)).toBeUndefined()
  })

  it('excludes system and own comments from unread counts', () => {
    const notes = [
      makeNote('10', { system: true }),
      makeNote('11', { author: session.user }),
      makeNote('12'),
    ]
    observeComments(scope, ref, notes, session.user.id)

    expect(unreadComments(scope, ref, notes, session.user.id)).toEqual(['12'])
    expect(workspaceUnreadCount(scope, ref)).toBe(1)
  })

  it('marks only displayed comments read', () => {
    const displayed = makeNote('21')
    const onAnotherPage = makeNote('22')
    observeComments(scope, ref, [displayed, onAnotherPage], session.user.id)
    observeComments(scope, ref, [displayed], session.user.id, true)

    expect(unreadComments(scope, ref, [displayed, onAnotherPage], session.user.id)).toEqual(['22'])
    expect(workspaceUnreadCount(scope, ref)).toBe(1)
  })

  it('treats a comment as unread again when its updatedAt changes', () => {
    const original = makeNote('31', { updatedAt: '2026-10-08T10:00:00.000Z' })
    observeComments(scope, ref, [original], session.user.id, true)
    expect(workspaceUnreadCount(scope, ref)).toBe(0)

    const edited = { ...original, updatedAt: '2026-10-08T11:00:00.000Z' }
    observeComments(scope, ref, [edited], session.user.id)

    expect(unreadComments(scope, ref, [edited], session.user.id)).toEqual(['31'])
    expect(workspaceUnreadCount(scope, ref)).toBe(1)
  })

  it('clears stored reading markers with preferences', () => {
    observeComments(scope, ref, [makeNote('41')], session.user.id)
    expect(workspaceUnreadCount(scope, ref)).toBe(1)

    clearPreferences(scope)

    expect(readWorkspace(scope).reading).toEqual({})
    expect(workspaceUnreadCount(scope, ref)).toBeUndefined()
  })
})

describe('personal workspace pins and recents', () => {
  beforeEach(() => localStorage.clear())

  it('deduplicates stored references and keeps pin and recent lists bounded', () => {
    const storageKey = scopedKey(scope, 'personal-workspace')
    const duplicateRef = { iid: '1', projectId: '77' }
    localStorage.setItem(storageKey, JSON.stringify({
      pinned: [duplicateRef, duplicateRef],
      recent: [duplicateRef, duplicateRef],
      reading: {},
      settings: { autoRefresh: true, notifyComments: false, notifyTodos: false },
    }))
    const { result } = renderHook(() => usePersonalWorkspace(session))

    expect(readWorkspace(scope).pinned).toEqual([duplicateRef])
    expect(readWorkspace(scope).recent).toEqual([duplicateRef])
    act(() => {
      for (let id = 2; id <= 102; id += 1) {
        const nextRef = { iid: String(id), projectId: '77' }
        result.current.togglePinned(nextRef)
        result.current.recordRecent(nextRef)
      }
      result.current.recordRecent(duplicateRef)
    })

    const data = readWorkspace(scope)
    expect(data.pinned).toHaveLength(100)
    expect(new Set(data.pinned.map(({ projectId, iid }) => `${projectId}:${iid}`)).size).toBe(100)
    expect(data.pinned[0]).toEqual({ iid: '102', projectId: '77' })
    expect(data.recent).toHaveLength(30)
    expect(new Set(data.recent.map(({ projectId, iid }) => `${projectId}:${iid}`)).size).toBe(30)
    expect(data.recent[0]).toEqual(duplicateRef)
  })
})
