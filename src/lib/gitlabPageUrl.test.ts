import { describe, expect, it } from 'vitest'
import { parseGitLabPageUrl } from './gitlabPageUrl'

const instance = 'https://gitlab.example/gitlab'
const page = (path: string) => parseGitLabPageUrl(`${instance}${path}`, instance)

describe('GitLab page URLs', () => {
  it('reads a project, its branches, MR list, folders and files', () => {
    expect(page('/team/desktop')).toEqual({ kind: 'project', path: 'team/desktop' })
    expect(page('/team/sub/desktop/')).toEqual({ kind: 'project', path: 'team/sub/desktop' })
    expect(page('/team/desktop/-/branches')).toEqual({ kind: 'branches', path: 'team/desktop' })
    expect(page('/team/desktop/-/merge_requests')).toEqual({ kind: 'mrs', path: 'team/desktop' })
    expect(page('/team/desktop/-/tree/main')).toEqual({ kind: 'tree', path: 'team/desktop', rest: ['main'] })
    expect(page('/team/desktop/-/blob/feature/x/src/a%20b.ts?ref_type=heads#L3')).toEqual({ kind: 'blob', path: 'team/desktop', rest: ['feature', 'x', 'src', 'a b.ts'] })
  })

  it('leaves users, groups, other pages, MRs and other hosts to the caller', () => {
    expect(page('/alice')).toBeNull()
    expect(page('/groups/team/-/merge_requests')).toBeNull()
    expect(page('/dashboard/merge_requests')).toBeNull()
    expect(page('/team/desktop/-/merge_requests/12')).toBeNull()
    expect(page('/team/desktop/-/pipelines')).toBeNull()
    expect(page('/team/desktop/-/blob/main')).toBeNull()
    expect(page('/team/../desktop')).toBeNull()
    expect(parseGitLabPageUrl('https://other.example/gitlab/team/desktop', instance)).toBeNull()
    expect(parseGitLabPageUrl('http://gitlab.example/gitlab/team/desktop', instance)).toBeNull()
    expect(parseGitLabPageUrl('https://gitlab.example/team/desktop', instance)).toBeNull()
  })
})
