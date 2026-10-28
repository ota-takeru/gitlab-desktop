import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocalePreference } from '../i18n/i18n'
import type { GitLabAction } from '../types/gitlab'

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn(() => true) }))

vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')
  return { ...actual, invoke: invokeMock, isTauri: isTauriMock }
})

import { cancelGitLabRequest, clearGitLabCache, connectGitLab, connectGitLabFromGlab, createRequestId, disconnectGitLab, getGitLabAvatar, getGitLabImage, listGlabConnections, mutateGitLab, normalizeGitLabError, openExternalUrl, openGitLabUrl, openTokenCreationPage, queryCacheFirst, restoreGitLabSession } from './gitlab'
import { GitLabCommandError } from '../types/gitlab'

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

describe('desktop commands', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue('result')
    isTauriMock.mockReturnValue(true)
  })

  it('sends each command with its own arguments', async () => {
    await connectGitLab({ token: 't', url: 'https://gitlab.example' })
    await connectGitLabFromGlab('https://gitlab.example')
    await restoreGitLabSession()
    await disconnectGitLab('s')
    await clearGitLabCache('s')
    await openGitLabUrl('s', 'https://gitlab.example/a')
    await openExternalUrl('https://docs.example')
    await openTokenCreationPage('https://gitlab.example')
    await getGitLabAvatar('s', 'https://gitlab.example/uploads/a.png')
    await getGitLabImage('s', 'https://gitlab.example/uploads/b.png')
    expect(invokeMock.mock.calls).toEqual([
      ['connect_gitlab', { input: { token: 't', url: 'https://gitlab.example' } }],
      ['connect_gitlab_from_glab', { url: 'https://gitlab.example' }],
      ['restore_session'],
      ['disconnect_gitlab', { sessionId: 's' }],
      ['clear_gitlab_cache', { sessionId: 's' }],
      ['open_gitlab_url', { sessionId: 's', url: 'https://gitlab.example/a' }],
      ['open_external_url', { url: 'https://docs.example' }],
      ['open_token_creation_page', { instanceUrl: 'https://gitlab.example' }],
      ['get_gitlab_avatar', { sessionId: 's', url: 'https://gitlab.example/uploads/a.png' }],
      ['get_gitlab_image', { sessionId: 's', url: 'https://gitlab.example/uploads/b.png' }],
    ])
  })

  it('turns a refusal from Rust into a typed error, and refuses in the browser preview', async () => {
    invokeMock.mockRejectedValueOnce({ code: 'FORBIDDEN', message: '権限がありません。' })
    await expect(openGitLabUrl('s', 'https://gitlab.example')).rejects.toMatchObject({ code: 'FORBIDDEN', message: '権限がありません。' })
    isTauriMock.mockReturnValue(false)
    await expect(connectGitLab({ token: 't', url: 'https://gitlab.example' })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(getGitLabAvatar('s', 'x')).resolves.toBeNull()
    await expect(getGitLabImage('s', 'x')).resolves.toBeNull()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('cancels at best effort, never surfacing a failure', async () => {
    invokeMock.mockRejectedValueOnce(new Error('already finished'))
    await expect(cancelGitLabRequest('s', 'r')).resolves.toBeUndefined()
    isTauriMock.mockReturnValue(false)
    await cancelGitLabRequest('s', 'r')
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})

describe('queryCacheFirst', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    isTauriMock.mockReturnValue(true)
  })

  const snapshot = (source: string) => ({ completeness: 'page', data: [], fetchedAt: 1, nextPage: null, source })

  it('shows the saved page, then the network one, under one request id', async () => {
    invokeMock.mockResolvedValueOnce(snapshot('cache')).mockResolvedValueOnce(snapshot('network'))
    const onSnapshot = vi.fn()
    const onError = vi.fn()
    await queryCacheFirst({ query: { kind: 'todos', page: 1 }, requestId: 'r', sessionId: 's' }, { onError, onSnapshot })
    expect(onSnapshot.mock.calls.map(([value]) => value.source)).toEqual(['cache', 'network'])
    expect(invokeMock.mock.calls.map(([, args]) => [args.input.mode, args.input.requestId])).toEqual([['cache', 'r'], ['network', 'r']])
    expect(onError).not.toHaveBeenCalled()
  })

  it('still asks the network after a storage failure, and reports both failures except a cache miss', async () => {
    invokeMock.mockRejectedValueOnce({ code: 'STORAGE', message: '保存領域を読めません。' }).mockRejectedValueOnce({ code: 'NETWORK', message: '接続できません。' })
    const onError = vi.fn()
    await queryCacheFirst({ query: { kind: 'todos', page: 1 }, sessionId: 's' }, { onError, onSnapshot: vi.fn() })
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual(['STORAGE', 'NETWORK'])

    invokeMock.mockReset().mockRejectedValueOnce({ code: 'NOT_FOUND', message: 'なし' }).mockResolvedValueOnce(null)
    const quiet = vi.fn()
    await queryCacheFirst({ query: { kind: 'todos', page: 1 }, sessionId: 's' }, { onError: quiet, onSnapshot: vi.fn() })
    expect(quiet).not.toHaveBeenCalled()
  })
})

describe('normalizeGitLabError', () => {
  it('keeps known codes, maps unknown ones, and words anything else as UNKNOWN', () => {
    const typed = new GitLabCommandError({ code: 'TIMEOUT', message: 'm' })
    expect(normalizeGitLabError(typed)).toBe(typed)
    expect(normalizeGitLabError({ code: 'RATE_LIMITED', message: 'wait', retryAfterMs: 500 })).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 500 })
    expect(normalizeGitLabError({ code: 'SOMETHING_NEW', message: 'm' }).code).toBe('UNKNOWN')
    expect(normalizeGitLabError(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', message: 'boom' })
    expect(normalizeGitLabError('plain')).toMatchObject({ code: 'UNKNOWN', message: 'plain' })
    expect(normalizeGitLabError(undefined).message).toBe('GitLabコマンドに失敗しました。')
  })

  describe('a native error with a message key', () => {
    const rateLimited = {
      code: 'RATE_LIMITED',
      message: 'GitLabのリクエスト制限に達しました。5秒後に再試行してください。',
      messageKey: 'native.request.rateLimited',
      messageValues: { seconds: '5' },
    }

    afterEach(async () => {
      await setLocalePreference('ja')
    })

    it('reads the same as the native Japanese text in Japanese', () => {
      expect(normalizeGitLabError(rateLimited).message).toBe(rateLimited.message)
      expect(normalizeGitLabError({ code: 'FORBIDDEN', message: 'このMRをマージする権限がありません。', messageKey: 'native.merge.forbidden' }).message).toBe('このMRをマージする権限がありません。')
    })

    it('is translated into the interface language with its values', async () => {
      await setLocalePreference('en')
      expect(normalizeGitLabError(rateLimited)).toMatchObject({ code: 'RATE_LIMITED', message: "GitLab's request limit was reached. Try again in 5 seconds." })
      expect(normalizeGitLabError({ ...rateLimited, messageValues: { seconds: '1' } }).message).toBe("GitLab's request limit was reached. Try again in 1 second.")
    })

    it('keeps the native text when the key is unknown', async () => {
      await setLocalePreference('en')
      expect(normalizeGitLabError({ code: 'NETWORK', message: '新しいメッセージ', messageKey: 'native.notYetKnown' }).message).toBe('新しいメッセージ')
    })
  })

  it('creates request ids with the given prefix', () => {
    expect(createRequestId('query')).toMatch(/^query-/u)
    expect(createRequestId()).not.toBe(createRequestId())
  })
})
