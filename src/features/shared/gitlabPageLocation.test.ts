import { beforeEach, expect, it, vi } from 'vitest'

import { resolveGitLabPage } from './gitlabPageLocation'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../../lib/gitlab', () => ({ queryGitLab: queryMock }))

const project = { id: '42', name: 'Desktop', webUrl: 'https://gitlab.example/team/desktop' }
const always = () => true

beforeEach(() => {
  queryMock.mockReset().mockImplementation(async ({ query }: { query: { kind: string; ref?: string; path?: string } }) => {
    if (query.kind === 'project') return { data: project, nextPage: null }
    // Only the branch `feature/x` exists, with `src/a.ts` in it.
    if (query.kind === 'tree' && query.ref === 'feature/x' && (query.path === 'src' || query.path === '')) {
      return { data: query.path === 'src' ? [{ id: 'b'.repeat(40), name: 'a.ts', path: 'src/a.ts', type: 'blob' }] : [], nextPage: null }
    }
    throw new Error('404')
  })
})

it('opens a project on its overview, branches and MR list', async () => {
  expect(await resolveGitLabPage('s', { kind: 'project', path: 'team/desktop' }, always)).toEqual({ route: 'overview', params: { projectId: '42', projectName: 'Desktop', projectUrl: project.webUrl } })
  expect(await resolveGitLabPage('s', { kind: 'branches', path: 'team/desktop' }, always)).toEqual({ route: 'branches', params: { projectId: '42', projectName: 'Desktop' } })
  expect(await resolveGitLabPage('s', { kind: 'mrs', path: 'team/desktop' }, always)).toEqual({ route: 'mrs', params: { projectId: '42', projectName: 'Desktop', state: 'opened' } })
})

it('finds where a ref with a slash ends for folders and files', async () => {
  expect(await resolveGitLabPage('s', { kind: 'tree', path: 'team/desktop', rest: ['feature', 'x', 'src'] }, always))
    .toEqual({ route: 'code', params: { projectId: '42', projectName: 'Desktop', ref: 'feature/x', path: 'src' } })
  expect(await resolveGitLabPage('s', { kind: 'blob', path: 'team/desktop', rest: ['feature', 'x', 'src', 'a.ts'] }, always))
    .toEqual({ route: 'code', params: { projectId: '42', projectName: 'Desktop', ref: 'feature/x', path: 'src', blob: 'b'.repeat(40), file: 'src/a.ts' } })
})

it('gives up on an unknown project or file, and on a superseded click', async () => {
  expect(await resolveGitLabPage('s', { kind: 'blob', path: 'team/desktop', rest: ['main', 'missing.ts'] }, always)).toBeNull()
  queryMock.mockRejectedValueOnce(new Error('404'))
  expect(await resolveGitLabPage('s', { kind: 'project', path: 'team/sub' }, always)).toBeNull()
  expect(await resolveGitLabPage('s', { kind: 'project', path: 'team/desktop' }, () => false)).toBeNull()
})
