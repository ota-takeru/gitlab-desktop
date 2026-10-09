import { describe, expect, it } from 'vitest'

import { parseMergeRequestUrl } from './mergeRequestUrl'

describe('parseMergeRequestUrl', () => {
  const instanceUrl = 'https://gitlab.example/GitLab/'

  it.each([
    ['regular MR URL', 'https://gitlab.example/GitLab/team/project/-/merge_requests/37', { path: 'team/project', iid: '37' }],
    ['diff suffix', 'https://gitlab.example/GitLab/team/project/-/merge_requests/37/diffs', { path: 'team/project', iid: '37' }],
    ['commit suffix', 'https://gitlab.example/GitLab/team/project/-/merge_requests/8/commits/', { path: 'team/project', iid: '8' }],
    ['unicode path', 'https://gitlab.example/GitLab/%E6%97%A5%E6%9C%AC/%E9%96%8B%E7%99%BA/-/merge_requests/12', { path: '日本/開発', iid: '12' }],
  ])('parses %s on the configured origin and base path', (_name, input, expected) => {
    expect(parseMergeRequestUrl(input, instanceUrl)).toEqual(expected)
  })

  it.each([
    'https://other.example/GitLab/team/project/-/merge_requests/3',
    'https://gitlab.example:8443/GitLab/team/project/-/merge_requests/3',
    'https://gitlab.example/Other/team/project/-/merge_requests/3',
    'https://user:password@gitlab.example/GitLab/team/project/-/merge_requests/3',
  ])('rejects an unrelated host, port, base path, or userinfo: %s', (input) => {
    expect(() => parseMergeRequestUrl(input, instanceUrl)).toThrow()
  })

  it.each([
    'https://gitlab.example/GitLab/team//project/-/merge_requests/3',
    'https://gitlab.example/GitLab/team/%5Cproject/-/merge_requests/3',
    'https://gitlab.example/GitLab/team/%3Fproject/-/merge_requests/3',
    'https://gitlab.example/GitLab/team/%2E%2E/project/-/merge_requests/3',
  ])('rejects an unsafe project path: %s', (input) => {
    expect(() => parseMergeRequestUrl(input, instanceUrl)).toThrow()
  })
})
