import { expect, it } from 'vitest'
import { gitLabUrlFromDeepLink } from './deepLink'

const instance = 'https://gitlab.example/gitlab'
const link = (url: string) => `gitlab-desktop://open?url=${encodeURIComponent(url)}`

it('reads the GitLab page on the connected instance from a gitlab-desktop link', () => {
  expect(gitLabUrlFromDeepLink(link('https://gitlab.example/gitlab/team/app/-/merge_requests/12'), instance)).toBe('https://gitlab.example/gitlab/team/app/-/merge_requests/12')
  expect(gitLabUrlFromDeepLink(link('https://gitlab.example/gitlab/team/app/-/blob/main/README.md#L3'), instance)).toBe('https://gitlab.example/gitlab/team/app/-/blob/main/README.md#L3')
})

it('ignores other hosts, other schemes and malformed links', () => {
  expect(gitLabUrlFromDeepLink(link('https://evil.example/gitlab/team/app'), instance)).toBeNull()
  expect(gitLabUrlFromDeepLink(link('http://gitlab.example/gitlab/team/app'), instance)).toBeNull()
  expect(gitLabUrlFromDeepLink(link('https://gitlab.example/other/team/app'), instance)).toBeNull()
  expect(gitLabUrlFromDeepLink(link('https://user:secret@gitlab.example/gitlab/team/app'), instance)).toBeNull()
  expect(gitLabUrlFromDeepLink(link('javascript:alert(1)'), instance)).toBeNull()
  expect(gitLabUrlFromDeepLink('gitlab-desktop://other?url=https%3A%2F%2Fgitlab.example%2Fgitlab%2Fteam%2Fapp', instance)).toBeNull()
  expect(gitLabUrlFromDeepLink('https://gitlab.example/gitlab/team/app', instance)).toBeNull()
  expect(gitLabUrlFromDeepLink('gitlab-desktop://open', instance)).toBeNull()
})
