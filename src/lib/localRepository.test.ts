import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')
  return { ...actual, invoke: invokeMock, isTauri: () => true }
})

import { findOwnLocalRepositories } from './localRepository'

const mergeRequest = (projectId: string, projectPath: string | null) => ({ projectId, projectPath })
const page = (data: unknown[], nextPage: number | null = null) => ({ completeness: 'page', data, fetchedAt: 0, nextPage, source: 'network' })

describe('findOwnLocalRepositories', () => {
  beforeEach(() => invokeMock.mockReset())

  it('searches once for each project of the open MRs the user authored or is assigned to', async () => {
    invokeMock.mockImplementation(async (command: string, args: { input?: { query: { authorId?: string; page: number } }; projectId?: string }) => {
      if (command === 'query_gitlab') {
        const query = args.input!.query
        if (query.authorId) return query.page === 1 ? page([mergeRequest('8', 'group/api')], 2) : page([mergeRequest('9', 'group/web'), mergeRequest('8', 'group/api')])
        return page([mergeRequest('9', 'group/web'), mergeRequest('10', null)])
      }
      if (command !== 'find_local_repository') return null
      if (args.projectId === '9') throw { code: 'INVALID_INPUT', message: 'リモートが違います。' }
      return { declined: false, repository: { path: 'C:/src/api', projectPath: 'group/api' } }
    })

    const results = await findOwnLocalRepositories('s1', 'u1')

    const queries = invokeMock.mock.calls.filter(([command]) => command === 'query_gitlab').map(([, args]) => args.input.query)
    expect(queries).toEqual([
      expect.objectContaining({ authorId: 'u1', kind: 'mrs', page: 1, state: 'opened' }),
      expect.objectContaining({ authorId: 'u1', page: 2 }),
      expect.objectContaining({ assigneeId: 'u1', kind: 'mrs', page: 1, state: 'opened' }),
    ])
    expect(invokeMock).toHaveBeenCalledWith('find_local_repository', { explicit: false, projectId: '8', projectPath: 'group/api', sessionId: 's1' })
    expect(results).toEqual([
      { error: null, projectId: '8', projectPath: 'group/api', result: { declined: false, repository: { path: 'C:/src/api', projectPath: 'group/api' } } },
      { error: 'リモートが違います。', projectId: '9', projectPath: 'group/web', result: null },
    ])
  })
})
