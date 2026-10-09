import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitLabAction } from '../types/gitlab'

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn(() => true) }))

vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')
  return { ...actual, invoke: invokeMock, isTauri: isTauriMock }
})

import { listGlabConnections, mutateGitLab } from './gitlab'

const action: GitLabAction = { body: '本文', iid: '1', kind: 'comment', projectId: 'project-1', thread: false }

describe('mutateGitLab', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(undefined)
    isTauriMock.mockReturnValue(true)
  })

  it('preserves the existing mutation input shape without a local draft key', async () => {
    await mutateGitLab({ action, requestId: 'request-1', sessionId: 'session-1' })

    expect(invokeMock).toHaveBeenCalledWith('mutate_gitlab', {
      input: { action, requestId: 'request-1', sessionId: 'session-1' },
    })
  })

  it('includes the local draft key only when supplied', async () => {
    await mutateGitLab({ action, localDraftKey: 'project-1:draft', requestId: 'request-2', sessionId: 'session-1' })

    expect(invokeMock).toHaveBeenCalledWith('mutate_gitlab', {
      input: { action, localDraftKey: 'project-1:draft', requestId: 'request-2', sessionId: 'session-1' },
    })
  })
})

describe('listGlabConnections', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    isTauriMock.mockReturnValue(true)
  })

  it('reads saved connection URLs only through the native command', async () => {
    invokeMock.mockResolvedValue(['https://gitlab.com', 'https://gitlab.example.com'])

    await expect(listGlabConnections()).resolves.toEqual(['https://gitlab.com', 'https://gitlab.example.com'])
    expect(invokeMock).toHaveBeenCalledWith('list_glab_connections')
  })

  it('normalizes native errors and refuses browser preview', async () => {
    invokeMock.mockRejectedValue({ code: 'STORAGE', message: '設定を読み取れません。' })
    await expect(listGlabConnections()).rejects.toMatchObject({ code: 'STORAGE', message: '設定を読み取れません。' })

    invokeMock.mockClear()
    isTauriMock.mockReturnValue(false)
    await expect(listGlabConnections()).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
