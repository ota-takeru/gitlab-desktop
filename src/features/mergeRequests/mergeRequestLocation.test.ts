import { afterEach, describe, expect, it, vi } from 'vitest'

import { diffFileAnchor, diffPageUrl, discussionPageUrl, pipelinesPageUrl } from './mergeRequestLocation'

const webUrl = 'https://gitlab.example/team/desktop/-/merge_requests/7'

describe('GitLab addresses of the MR review', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('names a file by the SHA-1 of its path', async () => {
    // The test DOM has no crypto.subtle, which the desktop webview has.
    const digest = vi.fn<(algorithm: string, data: Uint8Array) => Promise<ArrayBufferLike>>(() => Promise.resolve(Uint8Array.of(0x0a, 0xff).buffer))
    vi.stubGlobal('crypto', { subtle: { digest } })
    await expect(diffFileAnchor('src/é.ts')).resolves.toBe('0aff')
    expect(digest.mock.calls[0][0]).toBe('SHA-1')
    expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe('src/é.ts')
  })

  it('leaves the file out when it cannot be named', async () => {
    vi.stubGlobal('crypto', {})
    await expect(diffFileAnchor('abc')).resolves.toBeNull()
  })

  it('goes to the comment in view, or to the MR page without one', () => {
    expect(discussionPageUrl(webUrl, '12')).toBe(`${webUrl}#note_12`)
    expect(discussionPageUrl(webUrl, null)).toBe(webUrl)
  })

  it('goes to the diff page at the comment in view, otherwise at the file', () => {
    expect(diffPageUrl(webUrl, {})).toBe(`${webUrl}/diffs`)
    expect(diffPageUrl(webUrl, { fileAnchor: 'file1' })).toBe(`${webUrl}/diffs#file1`)
    expect(diffPageUrl(webUrl, { fileAnchor: 'file1', noteId: '12' })).toBe(`${webUrl}/diffs#note_12`)
  })

  it('keeps the commit or version shown', () => {
    expect(diffPageUrl(webUrl, { commit: 'c1', fileAnchor: 'file1' })).toBe(`${webUrl}/diffs?commit_id=c1#file1`)
    expect(diffPageUrl(webUrl, { compareFrom: 'v1', fileAnchor: 'file1' })).toBe(`${webUrl}/diffs?start_sha=v1#file1`)
  })

  it('goes to the pipeline or job shown, or to the MR pipelines', () => {
    expect(pipelinesPageUrl(webUrl, 'https://gitlab.example/team/desktop/-/jobs/9')).toBe('https://gitlab.example/team/desktop/-/jobs/9')
    expect(pipelinesPageUrl(webUrl, '')).toBe(`${webUrl}/pipelines`)
  })
})
