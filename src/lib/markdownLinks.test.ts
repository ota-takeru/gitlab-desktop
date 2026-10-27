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

describe('Markdown images in repository files', () => {
  const file = { ...base, repository: { projectId: '42', path: 'docs/guide/intro.md', ref: 'feature/x' } }
  const raw = (path: string, ref = 'feature%2Fx') => `https://gitlab.example/gitlab/api/v4/projects/42/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`

  it('reads relative and root images from the file version', () => {
    expect(resolveMarkdownUrl('img/a b.png', file, 'src')).toBe(raw('docs/guide/img/a b.png'))
    expect(resolveMarkdownUrl('./a.png?raw=true', file, 'src')).toBe(raw('docs/guide/a.png'))
    expect(resolveMarkdownUrl('../../logo%20x.png', file, 'src')).toBe(raw('logo x.png'))
    expect(resolveMarkdownUrl('/assets/logo.png', file, 'src')).toBe(raw('assets/logo.png'))
    expect(resolveMarkdownUrl('a.png', { ...base, repository: { projectId: '42', path: 'README.md' } }, 'src')).toBe(raw('a.png', 'HEAD'))
  })

  it('opens relative links as the linked file on GitLab at the same version', () => {
    const blob = 'https://gitlab.example/gitlab/team/desktop/-/blob/feature/x'
    expect(resolveMarkdownUrl('../setup.md#install', file, 'href')).toBe(`${blob}/docs/setup.md#install`)
    expect(resolveMarkdownUrl('/LICENSE', file, 'href')).toBe(`${blob}/LICENSE`)
    expect(resolveMarkdownUrl('a b.md', file, 'href')).toBe(`${blob}/docs/guide/a%20b.md`)
    expect(resolveMarkdownUrl('CHANGELOG.md', { ...base, repository: { projectId: '42', path: 'README.md' } }, 'href')).toBe('https://gitlab.example/gitlab/team/desktop/-/blob/HEAD/CHANGELOG.md')
    expect(resolveMarkdownUrl('#usage', file, 'href')).toBe('')
    expect(resolveMarkdownUrl('../../../a.md', file, 'href')).toBe('')
    expect(resolveMarkdownUrl('a.md', { instanceUrl: base.instanceUrl, repository: file.repository }, 'href')).toBe('')
  })

  it('keeps uploads and links as before and reads nothing outside the repository', () => {
    expect(resolveMarkdownUrl('/uploads/abc/a.png', file, 'src')).toBe('https://gitlab.example/gitlab/team/desktop/uploads/abc/a.png')
    expect(resolveMarkdownUrl('/uploads/abc/a.png', file, 'href')).toBe('https://gitlab.example/gitlab/team/desktop/uploads/abc/a.png')
    expect(resolveMarkdownUrl('img/a.png', base, 'src')).toBe('')
    expect(resolveMarkdownUrl('../../../a.png', file, 'src')).toBe('')
    expect(resolveMarkdownUrl('data:image/png;base64,AA', file, 'src')).toBe('')
    expect(resolveMarkdownUrl('//evil.example/a.png', file, 'src')).toBe('')
  })
})
