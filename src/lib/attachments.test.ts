import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn(() => true) }))

vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')
  return { ...actual, invoke: invokeMock, isTauri: isTauriMock }
})

import { GitLabCommandError } from '../types/gitlab'
import { MAX_GITLAB_ATTACHMENT_BYTES, uploadGitLabAttachment } from './attachments'

function fileFixture({ name = 'screenshot.png', size = 3, bytes = [97, 98, 99] }: { name?: string; size?: number; bytes?: number[] } = {}): File {
  return {
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    name,
    size,
  } as File
}

describe('uploadGitLabAttachment', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    isTauriMock.mockReturnValue(true)
  })

  it('sends base64 content and returns GitLab Markdown', async () => {
    invokeMock.mockResolvedValue('![screenshot.png](/uploads/screenshot.png)')

    await expect(uploadGitLabAttachment({ file: fileFixture(), iid: '42', projectId: 'group/project', sessionId: 'session-1' }))
      .resolves.toBe('![screenshot.png](/uploads/screenshot.png)')

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('upload_gitlab_attachment', {
      input: expect.objectContaining({
        dataBase64: 'YWJj',
        fileName: 'screenshot.png',
        iid: '42',
        projectId: 'group/project',
        requestId: expect.stringMatching(/^attachment-/),
        sessionId: 'session-1',
      }),
    })
  })

  it('rejects files larger than 10 MiB before sending them', async () => {
    const file = fileFixture({ size: MAX_GITLAB_ATTACHMENT_BYTES + 1 })

    await expect(uploadGitLabAttachment({ file, iid: '42', projectId: 'group/project', sessionId: 'session-1' }))
      .rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('does not try to upload in browser preview', async () => {
    isTauriMock.mockReturnValue(false)

    await expect(uploadGitLabAttachment({ file: fileFixture(), iid: '42', projectId: 'group/project', sessionId: 'session-1' }))
      .rejects.toBeInstanceOf(GitLabCommandError)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('normalizes native upload errors', async () => {
    invokeMock.mockRejectedValue({ code: 'FORBIDDEN', message: 'denied' })

    await expect(uploadGitLabAttachment({ file: fileFixture(), iid: '42', projectId: 'group/project', sessionId: 'session-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'denied' })
  })
})
