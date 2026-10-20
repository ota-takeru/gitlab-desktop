import { describe, expect, it } from 'vitest'
import { projectUrlOf, resolveMarkdownUrl } from './markdownLinks'

const base = { instanceUrl: 'https://gitlab.example/gitlab/', projectUrl: 'https://gitlab.example/gitlab/team/desktop' }

describe('Markdown links', () => {
  it('keeps web links and resolves GitLab root-relative links on the instance', () => {
    expect(resolveMarkdownUrl('https://docs.gitlab.com/', base)).toBe('https://docs.gitlab.com/')
    expect(resolveMarkdownUrl('mailto:a@example.com', base)).toBe('mailto:a@example.com')
    expect(resolveMarkdownUrl('/team/other/-/issues/3', base)).toBe('https://gitlab.example/gitlab/team/other/-/issues/3')
    expect(resolveMarkdownUrl('/uploads/abc/log.txt', base)).toBe('https://gitlab.example/gitlab/team/desktop/uploads/abc/log.txt')
  })

  it('opens nothing for scripts, protocol-relative or unknown relative links', () => {
    expect(resolveMarkdownUrl('javascript:alert(1)', base)).toBe('')
    expect(resolveMarkdownUrl('//evil.example/x', base)).toBe('')
    expect(resolveMarkdownUrl('docs/readme.md', base)).toBe('')
    expect(resolveMarkdownUrl('/team/other', {})).toBe('')
  })

  it('finds the project of an MR URL', () => {
    expect(projectUrlOf('https://gitlab.example/team/desktop/-/merge_requests/12')).toBe('https://gitlab.example/team/desktop')
    expect(projectUrlOf('')).toBeUndefined()
  })
})
