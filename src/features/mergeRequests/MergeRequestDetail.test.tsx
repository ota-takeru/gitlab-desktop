import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { MergeRequest, Note } from '../../types/gitlab'

const detailMocks = vi.hoisted(() => {
  const currentUser = { id: '42', name: 'Reviewer', username: 'reviewer' }
  const position = { baseSha: 'base-abc', headSha: 'head-abc', newLine: 2, newPath: 'src/example.ts', oldLine: 2, oldPath: 'src/example.ts', positionType: 'text', startSha: 'start-abc' }
  const notes = [
    { id: '900', body: 'system-only history', author: { id: '99', name: 'Bot', username: 'bot' }, createdAt: '2026-01-01T00:00:00.000Z', system: true, resolvable: false, resolved: false, position: null },
    { id: '1001', body: '未読コメント', author: { id: '99', name: 'Colleague', username: 'colleague' }, createdAt: '2026-04-02T00:00:00.000Z', system: false, resolvable: false, resolved: false, position: null },
    { id: '1002', body: '位置コメント', author: { id: '99', name: 'Colleague', username: 'colleague' }, createdAt: '2026-04-03T00:00:00.000Z', system: false, resolvable: false, resolved: false, position },
  ]
  const discussion = { id: 'discussion-120', individualNote: false, notes }
  const mergeRequest = {
    id: '120', iid: '120', projectId: '7', title: 'Read-only integration sample', description: '', state: 'opened', webUrl: 'https://gitlab.com/group/project/-/merge_requests/120', author: { id: '99', name: 'Author', username: 'author' }, sourceBranch: 'feature', targetBranch: 'main', updatedAt: '2026-04-03T00:00:00.000Z', headSha: 'head-abc', diffRefs: { baseSha: 'base-abc', startSha: 'start-abc', headSha: 'head-abc' },
  }
  const diff = { oldPath: 'src/example.ts', newPath: 'src/example.ts', diff: '@@ -1,3 +1,3 @@\n line one\n line two\n line three\n', newFile: false, deletedFile: false, renamedFile: false, tooLarge: false, collapsed: false }
  const session = { id: 'session-42', instanceUrl: 'https://gitlab.com', user: currentUser, serverVersion: '18.0' }
  return {
    diff,
    discussion,
    discussions: { 1: [discussion] } as Record<number, typeof discussion[]>,
    flushComposerBuffersMock: vi.fn(),
    markReadMock: vi.fn(),
    mergeRequest,
    mutationRunMock: vi.fn(async () => false),
    notifyWorkspaceMock: vi.fn(async () => undefined),
    position,
    queryCalls: [] as unknown[],
    recordRecentMock: vi.fn(),
    session,
    togglePinnedMock: vi.fn(),
    unreadIds: ['1001'],
    useComposerBufferMock: vi.fn(),
    workspaceObserveMock: vi.fn(),
    users: [{ id: '50', name: 'Alice Example', username: 'alice' }],
  }
})

vi.mock('../connections/ConnectionProvider', () => ({
  useConnection: () => ({ session: detailMocks.session }),
}))

vi.mock('../shared/personalWorkspace', () => ({
  usePersonalWorkspace: () => ({
    isPinned: () => false,
    markRead: detailMocks.markReadMock,
    observe: detailMocks.workspaceObserveMock,
    recordRecent: detailMocks.recordRecentMock,
    settings: { autoRefresh: false, notifyComments: false, notifyTodos: false },
    togglePinned: detailMocks.togglePinnedMock,
    unreadIds: () => detailMocks.unreadIds,
  }),
}))

vi.mock('../../lib/notifications', () => ({ notifyWorkspace: detailMocks.notifyWorkspaceMock }))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: { kind: string; page?: number; search?: string } | null) => {
    detailMocks.queryCalls.push(query)
    let data: unknown = null
    if (query?.kind === 'mr') data = detailMocks.mergeRequest
    else if (query?.kind === 'discussions') data = detailMocks.discussions[query.page ?? 1] ?? []
    else if (query?.kind === 'diffs') data = [detailMocks.diff]
    else if (query?.kind === 'users') data = query.search === 'al' ? detailMocks.users : []
    else if (query?.kind === 'drafts' || query?.kind === 'commits' || query?.kind === 'approvals') data = []
    return {
      data,
      error: null,
      loading: false,
      refreshing: false,
      refresh: vi.fn(),
      snapshot: query ? { data, source: 'network', nextPage: null, completeness: 'complete', fetchedAt: 1 } : null,
      stale: false,
    }
  },
}))

vi.mock('../shared/useGitLabMutation', () => ({
  clearGitLabMutationStates: vi.fn(),
  useGitLabMutation: () => ({
    error: null,
    isLocked: false,
    isPending: false,
    reset: vi.fn(async () => true),
    retryLookup: vi.fn(async () => false),
    run: detailMocks.mutationRunMock,
    runDetailed: vi.fn(async () => ({ ok: false, status: 'error' })),
    status: 'idle',
    unknownAction: null,
  }),
}))

/*
 * Detail tests keep the native composer store isolated while retaining its
 * hook shape. The workspace and notification boundary above are no-op mocks.
 */
vi.mock('./useComposerBuffer', async () => {
  const actual = await vi.importActual<typeof import('./useComposerBuffer')>('./useComposerBuffer')
  return { ...actual, flushComposerBuffers: detailMocks.flushComposerBuffersMock, useComposerBuffer: detailMocks.useComposerBufferMock }
})

import { BufferedReviewComposer, MergeRequestDetail } from './MergeRequestDetail'

describe('BufferedReviewComposer', () => {
  beforeEach(() => {
    detailMocks.flushComposerBuffersMock.mockReset()
    detailMocks.useComposerBufferMock.mockReset().mockReturnValue({
      body: '保持する本文',
      change: vi.fn(),
      discard: vi.fn(),
      error: null,
      persistenceStatus: 'saved',
    })
    detailMocks.markReadMock.mockReset()
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(false)
    detailMocks.notifyWorkspaceMock.mockReset()
    detailMocks.queryCalls.length = 0
    detailMocks.recordRecentMock.mockReset()
    detailMocks.workspaceObserveMock.mockReset()
  })

  it('keeps the body and avoids a mutation when flushing the buffer fails', async () => {
    detailMocks.flushComposerBuffersMock.mockResolvedValue(false)
    const onSubmitComment = vi.fn(async () => true)
    render(<BufferedReviewComposer bufferKey="composer-key" onCancelReply={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={onSubmitComment} />)

    fireEvent.click(screen.getByRole('button', { name: 'コメントを投稿' }))
    await waitFor(() => expect(detailMocks.flushComposerBuffersMock).toHaveBeenCalledTimes(1))

    expect(onSubmitComment).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('保持する本文')
    expect(screen.getByRole('alert')).toHaveTextContent('入力の保存を確認できないため、投稿を停止しました。')
  })

  it('wires read-only MR discussion, unread marking, position navigation, Markdown preview, and mention lookup', async () => {
    detailMocks.useComposerBufferMock.mockImplementation(() => {
      const [body, setBody] = useState('**保持する本文**\n\n@al')
      return { body, change: setBody, discard: vi.fn(), error: null, persistenceStatus: 'saved' }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
          <MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('位置コメント')).toBeInTheDocument()
    expect(screen.queryByText('system-only history')).not.toBeInTheDocument()
    expect(screen.getByText('未読')).toBeInTheDocument()
    expect(screen.getByText(/!120/u)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '表示中を既読' }))
    expect(detailMocks.markReadMock).toHaveBeenCalledWith({ projectId: '7', iid: '120' }, [
      expect.objectContaining({ id: '1001' }),
      expect.objectContaining({ id: '1002' }),
    ])
    expect(detailMocks.markReadMock.mock.calls[0][1]).toHaveLength(2)
    expect(detailMocks.markReadMock.mock.calls[0][1].some((note: Note) => note.system)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'コメントをプレビュー' }))
    expect(screen.getByText('保持する本文').tagName).toBe('STRONG')
    fireEvent.click(screen.getByRole('button', { name: 'コメントを編集' }))
    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    textbox.setSelectionRange(textbox.value.length, textbox.value.length)
    fireEvent.click(textbox)
    await waitFor(() => expect(screen.getByRole('button', { name: '@aliceを挿入' })).toBeInTheDocument(), { timeout: 2_000 })
    fireEvent.click(screen.getByRole('button', { name: '@aliceを挿入' }))
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('**保持する本文**\n\n@alice ')
    expect(detailMocks.queryCalls).toContainEqual({ kind: 'users', page: 1, search: 'al' })

    fireEvent.click(screen.getByRole('button', { name: '差分へ移動: src/example.ts:2' }))
    const diffComment = await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' })
    await waitFor(() => expect(diffComment.closest('[data-testid="diff-line"]')).toHaveFocus())
    expect(detailMocks.queryCalls).toContainEqual(expect.objectContaining({ kind: 'diffs', iid: '120', projectId: '7' }))
    expect(detailMocks.mutationRunMock).not.toHaveBeenCalled()
    expect(detailMocks.notifyWorkspaceMock).not.toHaveBeenCalled()
  })
})
