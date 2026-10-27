import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

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
    reviewers: [currentUser],
  }
  const diff = { oldPath: 'src/example.ts', newPath: 'src/example.ts', diff: '@@ -1,3 +1,3 @@\n line one\n line two\n line three\n', newFile: false, deletedFile: false, renamedFile: false, tooLarge: false, collapsed: false }
  const session = { id: 'session-42', instanceUrl: 'https://gitlab.com', user: currentUser, serverVersion: '18.0' }
  return {
    commits: [] as { id: string; title: string }[],
    diff,
    fileContent: null as string | null,
    /** Diff pages by page number, when a test needs more than the one file. */
    diffPages: null as Record<number, typeof diff[]> | null,
    discussion,
    drafts: [] as { id: string; body: string; discussionId: string | null; position: null }[],
    mutationState: { error: null as Error | null, status: 'idle', unknownAction: null as { kind: string } | null },
    openUrlMock: vi.fn(async () => undefined),
    queryGitLabMock: vi.fn(),
    refreshKinds: [] as unknown[],
    applyConfirmedMock: vi.fn(),
    discussions: { 1: [discussion] } as Record<number, typeof discussion[]>,
    flushComposerBuffersMock: vi.fn(),
    markReadMock: vi.fn(),
    mergeRequest,
    mutationRunMock: vi.fn(async () => false),
    uploadMock: vi.fn(async () => '[test.txt](https://gitlab.com/-/project/7/uploads/abc/test.txt)'),
    mutationDetailedMock: vi.fn(async (_action: unknown, _key?: string, execute?: () => Promise<void>) => {
      await execute?.()
      return { ok: true, status: 'success' }
    }),
    notifyWorkspaceMock: vi.fn(async () => undefined),
    position,
    queryCalls: [] as unknown[],
    recordRecentMock: vi.fn(),
    session,
    togglePinnedMock: vi.fn(),
    unreadIds: ['1001'],
    useComposerBufferMock: vi.fn(),
    versions: [
      { id: '3', headCommitSha: 'head-abc', baseCommitSha: 'base-abc', startCommitSha: 'start-abc', createdAt: '2026-04-03T00:00:00.000Z', state: 'collected', realSize: '1' },
      { id: '2', headCommitSha: 'b'.repeat(40), baseCommitSha: 'base-abc', startCommitSha: 'start-abc', createdAt: '2026-04-02T00:00:00.000Z', state: 'collected', realSize: '1' },
      { id: '1', headCommitSha: 'a'.repeat(40), baseCommitSha: 'base-abc', startCommitSha: 'start-abc', createdAt: '2026-04-01T00:00:00.000Z', state: 'collected', realSize: '1' },
    ],
    workspaceObserveMock: vi.fn(),
    users: [{ id: '50', name: 'Alice Example', username: 'alice' }],
    mrAwards: [] as unknown[],
    noteAwards: [] as unknown[],
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
    rememberTab: vi.fn(),
    settings: { autoRefresh: false, notifyComments: false, notifyTodos: false },
    togglePinned: detailMocks.togglePinnedMock,
    unreadIds: () => detailMocks.unreadIds,
  }),
}))

const localMocks = vi.hoisted(() => ({
  getLocalChanges: vi.fn(),
  getLocalRepository: vi.fn(),
}))
vi.mock('../../lib/localRepository', () => ({
  getLocalChanges: localMocks.getLocalChanges,
  getLocalFile: vi.fn(() => new Promise(() => undefined)),
  getLocalRepository: localMocks.getLocalRepository,
  pickLocalRepositoryFolder: vi.fn(),
  linkLocalRepository: vi.fn(),
  unlinkLocalRepository: vi.fn(),
}))

vi.mock('../../lib/notifications', () => ({ notifyWorkspace: detailMocks.notifyWorkspaceMock }))
vi.mock('../../lib/attachments', async () => ({
  ...await vi.importActual<typeof import('../../lib/attachments')>('../../lib/attachments'),
  uploadGitLabAttachment: detailMocks.uploadMock,
}))

vi.mock('../shared/useGitLabQuery', () => ({
  applyConfirmedGitLabChange: detailMocks.applyConfirmedMock,
  useGitLabQuery: (_sessionId: string | null, query: { kind: string; page?: number; search?: string } | null) => {
    detailMocks.queryCalls.push(query)
    let data: unknown = null
    if (query?.kind === 'mr') data = detailMocks.mergeRequest
    else if (query?.kind === 'discussions') data = detailMocks.discussions[query.page ?? 1] ?? []
    else if (query?.kind === 'diffs') data = detailMocks.diffPages?.[query.page ?? 1] ?? [detailMocks.diff]
    else if (query?.kind === 'file') data = detailMocks.fileContent === null ? null : { content: detailMocks.fileContent }
    else if (query?.kind === 'users') data = query.search === 'al' ? detailMocks.users : []
    else if (query?.kind === 'drafts') data = detailMocks.drafts
    else if (query?.kind === 'commits') data = detailMocks.commits
    else if (query?.kind === 'approvals') data = []
    else if (query?.kind === 'mrAwards') data = detailMocks.mrAwards
    else if (query?.kind === 'noteAwards') data = detailMocks.noteAwards
    else if (query?.kind === 'mrPipelines') data = []
    else if (query?.kind === 'mrVersions') data = detailMocks.versions
    else if (query?.kind === 'versionCompare') data = [detailMocks.diff]
    return {
      data,
      error: null,
      loading: false,
      refreshing: false,
      refresh: () => { if (query) detailMocks.refreshKinds.push(query.kind) },
      snapshot: query ? { data, source: 'network', nextPage: query.kind === 'diffs' && detailMocks.diffPages?.[(query.page ?? 1) + 1] ? (query.page ?? 1) + 1 : null, completeness: 'complete', fetchedAt: 1 } : null,
      stale: false,
    }
  },
}))

vi.mock('../shared/useGitLabMutation', () => ({
  clearGitLabMutationStates: vi.fn(),
  runGitLabMutation: (_sessionId: string, _key: string, action: unknown) => detailMocks.mutationDetailedMock(action),
  useGitLabMutation: () => ({
    ...detailMocks.mutationState,
    isLocked: detailMocks.mutationState.status === 'unknown',
    isPending: false,
    reset: vi.fn(async () => true),
    retryLookup: vi.fn(async () => false),
    run: detailMocks.mutationRunMock,
    runDetailed: detailMocks.mutationDetailedMock,
  }),
}))

vi.mock('../../lib/gitlab', async () => ({
  ...await vi.importActual<typeof import('../../lib/gitlab')>('../../lib/gitlab'),
  openGitLabUrl: detailMocks.openUrlMock,
  queryGitLab: detailMocks.queryGitLabMock,
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
    detailMocks.uploadMock.mockClear()
    detailMocks.mutationDetailedMock.mockClear()
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

  it('wires read-only MR discussion, unread marking, position navigation, and mention lookup', async () => {
    detailMocks.useComposerBufferMock.mockImplementation(() => {
      const [body, setBody] = useState('**保持する本文**\n\n@al')
      return { body, change: setBody, discard: vi.fn(), error: null, persistenceStatus: 'saved' }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('dark')}>
          <MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('位置コメント')).toBeInTheDocument()
    expect(screen.queryByText('system-only history')).not.toBeInTheDocument()
    expect(screen.getByText('未読')).toBeInTheDocument()
    expect(screen.getByText(/!120/u)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '読み込み済みを既読' }))
    expect(detailMocks.markReadMock).toHaveBeenCalledWith({ projectId: '7', iid: '120' }, [
      expect.objectContaining({ id: '1001' }),
      expect.objectContaining({ id: '1002' }),
    ])
    expect(detailMocks.markReadMock.mock.calls[0][1]).toHaveLength(2)
    expect(detailMocks.markReadMock.mock.calls[0][1].some((note: Note) => note.system)).toBe(false)

    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    textbox.setSelectionRange(textbox.value.length, textbox.value.length)
    fireEvent.click(textbox)
    await waitFor(() => expect(screen.getByRole('option', { name: /@alice$/u })).toBeInTheDocument(), { timeout: 2_000 })
    fireEvent.click(screen.getByRole('option', { name: /@alice$/u }))
    expect(screen.getByRole('textbox', { name: 'コメント本文' })).toHaveValue('**保持する本文**\n\n@alice ')
    expect(detailMocks.queryCalls).toContainEqual({ kind: 'users', page: 1, search: 'al' })

    fireEvent.click(screen.getByRole('button', { name: '差分へ移動: src/example.ts:2' }))
    const diffComment = await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' })
    await waitFor(() => expect(diffComment.closest('[data-testid="diff-line"]')).toHaveFocus())
    expect(detailMocks.queryCalls).toContainEqual(expect.objectContaining({ kind: 'diffs', iid: '120', projectId: '7' }))

    // The line comment editor opens right under the line, staying on the changes tab.
    fireEvent.click(diffComment)
    const editor = await screen.findByRole('region', { name: 'レビューコメント入力' })
    expect(within(editor).getByText('src/example.ts:2 にコメント')).toBeInTheDocument()
    expect(editor.closest('.diff-threads')?.previousElementSibling?.textContent).toContain('line two')
    expect(screen.getByRole('tab', { name: '変更' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(editor).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('region', { name: 'レビューコメント入力' })).not.toBeInTheDocument()
    expect(detailMocks.mutationRunMock).not.toHaveBeenCalled()
    expect(detailMocks.notifyWorkspaceMock).not.toHaveBeenCalled()
  })

  it('replaces the reviewers with the selected users and the reviewers it last saw', async () => {
    detailMocks.useComposerBufferMock.mockReturnValue({ body: '', change: vi.fn(), discard: vi.fn(), error: null, persistenceStatus: 'saved' })
    detailMocks.mutationRunMock.mockResolvedValue(true)
    // Assigned rather than reviewing, so adding yourself as a reviewer is offered.
    const involved = detailMocks.mergeRequest
    detailMocks.mergeRequest = { ...involved, assignees: [detailMocks.session.user], reviewers: [] } as typeof involved
    onTestFinished(() => { detailMocks.mergeRequest = involved })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('dark')}>
          <MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /^レビュアーを変更/u }))
    const dialog = await screen.findByRole('dialog', { name: 'レビュアーを変更' })
    expect(within(dialog).getByRole('button', { name: '変更する' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '自分を追加' }))
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'レビュアー' }), { target: { value: 'al' } })
    fireEvent.click(await screen.findByRole('option', { name: /Alice Example/u }, { timeout: 2_000 }))
    fireEvent.click(within(dialog).getByRole('button', { name: '変更する' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ expectedUserIds: [], iid: '120', kind: 'setReviewers', projectId: '7', userIds: ['42', '50'] }, undefined)
  })

  it.each([true, false])('uploads to the current MR only after input is saved (flush=%s)', async (saved) => {
    detailMocks.useComposerBufferMock.mockImplementation(() => {
      const [body, change] = useState('keep text')
      return { body, change, discard: vi.fn(), error: null, persistenceStatus: 'saved' }
    })
    detailMocks.flushComposerBuffersMock.mockResolvedValue(saved)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} /></ThemeProvider></QueryClientProvider>)
    const input = await screen.findByLabelText('添付ファイルを選択')
    const file = new File(['test'], 'test.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    if (saved) {
      await waitFor(() => expect(detailMocks.uploadMock).toHaveBeenCalledWith({ file, iid: '120', projectId: '7', sessionId: 'session-42' }))
      expect(detailMocks.mutationDetailedMock).toHaveBeenCalledWith({ kind: 'uploadAttachment', projectId: '7', iid: '120', fileName: 'test.txt' }, undefined, expect.any(Function))
      await waitFor(() => expect((screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement).value).toContain('[test.txt]'))
      expect((screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement).value).toContain('keep text')
    } else {
      await screen.findByText('入力の保存を確認できないため、添付を停止しました。')
      expect(detailMocks.uploadMock).not.toHaveBeenCalled()
      expect(detailMocks.mutationDetailedMock).not.toHaveBeenCalled()
    }
  })

  it('opens the reply editor inside the thread and sends a reply to that thread', async () => {
    detailMocks.useComposerBufferMock.mockImplementation((key: string) => {
      const [body, setBody] = useState(key.includes('discussion-120') ? '返信本文' : '新規コメント本文')
      return { body, change: setBody, discard: vi.fn(), error: null, persistenceStatus: 'saved' }
    })
    detailMocks.flushComposerBuffersMock.mockResolvedValue(true)
    detailMocks.mutationRunMock.mockResolvedValue(true)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('dark')}>
          <MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '返信' }))
    const thread = screen.getByText('位置コメント').closest('article') as HTMLElement
    const reply = within(thread).getByRole('textbox', { name: 'コメント本文' })
    expect(reply).toHaveValue('返信本文')
    await waitFor(() => expect(reply).toHaveFocus())
    expect(screen.getAllByRole('textbox', { name: 'コメント本文' }).find((box) => !thread.contains(box))).toHaveValue('新規コメント本文')

    fireEvent.click(within(thread).getByRole('button', { name: '返信' }))
    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ body: '返信本文', discussionId: 'discussion-120', iid: '120', kind: 'reply', projectId: '7' }, expect.any(String)))
    await waitFor(() => expect(within(thread).queryByRole('textbox', { name: 'コメント本文' })).not.toBeInTheDocument())
  })
})

describe('MergeRequestDetail tabs and description', () => {
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReset().mockReturnValue({ body: '', change: vi.fn(), discard: vi.fn(), error: null, persistenceStatus: 'saved' })
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(true)
  })

  function renderDetail(initialTab: 'discussion' | 'changes' | 'overview' | 'pipelines', onTabChange = vi.fn()) {
    function Harness() {
      const [tab, setTab] = useState(initialTab)
      return <MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} onTabChange={(next) => { onTabChange(next); setTab(next) }} tab={tab} />
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><Harness /></ThemeProvider></QueryClientProvider>)
    return onTabChange
  }

  it('renders changed Markdown files on opening, while keeping the raw diff accessible', async () => {
    const originalDiff = detailMocks.diff
    detailMocks.diff = {
      ...originalDiff,
      oldPath: 'docs/guide.md',
      newPath: 'docs/guide.md',
      diff: '@@ -1,1 +1,1 @@\n-# Previous\n+# Rendered MR Markdown\n',
    }
    detailMocks.fileContent = '# Rendered MR Markdown\n\n**Important**'
    onTestFinished(() => { detailMocks.diff = originalDiff; detailMocks.fileContent = null })
    renderDetail('changes')
    const preview = await screen.findByRole('region', { name: 'Markdown差分プレビュー' })
    expect(within(preview).getByRole('heading', { name: 'Rendered MR Markdown' })).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'Previous' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '差分' })).toHaveAttribute('aria-pressed', 'true')
    expect(detailMocks.queryCalls).not.toContainEqual(expect.objectContaining({ kind: 'file' }))
    expect(screen.queryByText('Important')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Markdown差分のソースを表示' }))
    expect(screen.queryByRole('region', { name: 'Markdown差分プレビュー' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Markdown差分をプレビュー表示' }))
    expect(screen.getByRole('region', { name: 'Markdown差分プレビュー' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))
    expect(screen.getByRole('button', { name: 'ファイル全体' })).toHaveAttribute('aria-pressed', 'true')
    expect(detailMocks.queryCalls).toContainEqual(expect.objectContaining({ kind: 'file', path: 'docs/guide.md', projectId: '7' }))
    expect(screen.getByText('Important')).toBeInTheDocument()
  })

  it('shows line comments under their diff line and opens the thread in the discussion tab', async () => {
    const onTabChange = renderDetail('changes')

    const thread = await screen.findByRole('article', { name: 'Colleagueのスレッド' })
    expect(within(thread).getByText('位置コメント')).toBeInTheDocument()
    // The thread sits right after the commented line (line two).
    expect(thread.closest('.diff-threads')?.previousElementSibling?.textContent).toContain('line two')

    fireEvent.click(within(thread).getByRole('button', { name: '議論タブで表示' }))
    expect(onTabChange).toHaveBeenCalledWith('discussion')
    expect(await screen.findByRole('textbox', { name: 'コメント本文' })).toBeInTheDocument()
  })

  it('reports tab changes to the caller so they can be kept in history', async () => {
    const onTabChange = renderDetail('discussion')
    fireEvent.click(await screen.findByRole('tab', { name: '変更' }))
    expect(onTabChange).toHaveBeenLastCalledWith('changes')
    expect(screen.getByRole('tab', { name: '変更' })).toHaveAttribute('aria-selected', 'true')
  })

  it('saves the edited description together with the description it replaced', async () => {
    renderDetail('overview')
    fireEvent.click(await screen.findByRole('button', { name: '説明を編集' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '説明を編集' }), { target: { value: '## 変更点\n\n説明を追加' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ description: '## 変更点\n\n説明を追加', expectedDescription: '', iid: '120', kind: 'setDescription', projectId: '7' }, undefined))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '説明を編集' })).not.toBeInTheDocument())
  })

  it('asks a reviewer for a new review from the overview and shows the merge state in the header', async () => {
    const original = detailMocks.mergeRequest
    detailMocks.mergeRequest = { ...original, canMerge: true, detailedMergeStatus: 'discussions_not_resolved', milestone: { dueDate: null, id: '4', state: 'active', title: 'v0.9', webUrl: null }, projectPath: 'group/project', reviewers: [{ id: '50', name: 'Alice Example', username: 'alice' }, detailMocks.session.user] } as typeof original
    globalThis.confirm = vi.fn(() => true)
    try {
      renderDetail('overview')
      expect(await screen.findByLabelText('未解決のスレッドがあります')).toBeInTheDocument()
      expect(screen.getByText('v0.9')).toBeInTheDocument()
      // Only other reviewers can be asked again.
      expect(screen.queryByRole('button', { name: 'Reviewerさんにレビューを再依頼' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Alice Exampleさんにレビューを再依頼' }))
      await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ iid: '120', kind: 'rerequestReview', projectId: '7', projectPath: 'group/project', userId: '50' }, undefined))
    } finally {
      detailMocks.mergeRequest = original
    }
  })
})

describe('line comments from the diff', () => {
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReset().mockImplementation(() => {
      const [body, change] = useState('行への指摘')
      return { body, change, discard: vi.fn(), error: null, persistenceStatus: 'saved' }
    })
    detailMocks.flushComposerBuffersMock.mockReset().mockResolvedValue(true)
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(true)
  })

  it.each([
    ['コメントを投稿', 'comment'],
    ['レビューに追加', 'saveDraft'],
  ] as const)('sends the line comment with %s and then closes the editor so the next comment is not on that line', async (button, kind) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} tab="changes" onTabChange={vi.fn()} /></ThemeProvider></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' }))
    const editor = await screen.findByRole('region', { name: 'レビューコメント入力' })
    fireEvent.click(within(editor).getByRole('button', { name: button }))

    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith(expect.objectContaining({ body: '行への指摘', kind, position: expect.objectContaining({ newLine: 2, newPath: 'src/example.ts', headSha: 'head-abc' }) }), expect.any(String)))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'レビューコメント入力' })).not.toBeInTheDocument())
  })

  it.each(['コメントを投稿', 'レビューに追加'])('sends a comment on lines chosen with Shift+click with their range (%s)', async (button) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} tab="changes" onTabChange={vi.fn()} /></ThemeProvider></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'src/example.tsの1行にコメント' }))
    fireEvent.click(screen.getByRole('button', { name: 'src/example.tsの3行にコメント' }), { shiftKey: true })
    const editor = await screen.findByRole('region', { name: 'レビューコメント入力' })
    expect(within(editor).getByText('src/example.ts:1〜3 にコメント')).toBeInTheDocument()
    expect(screen.getAllByTestId('diff-line').filter((row) => row.dataset.range === 'true')).toHaveLength(3)
    fireEvent.click(within(editor).getByRole('button', { name: button }))

    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith(expect.objectContaining({
      position: expect.objectContaining({
        headSha: 'head-abc',
        lineRange: { end: { newLine: 3, newPosition: 3, oldLine: 3, oldPosition: 3 }, hunk: { newCount: 3, newStart: 1, oldCount: 3, oldStart: 1 }, start: { newLine: 1, newPosition: 1, oldLine: 1, oldPosition: 1 } },
        newLine: 3,
        oldLine: 3,
      }),
    }), expect.any(String)))
  })
})

describe('suggestions and versions', () => {
  const original = { discussions: detailMocks.discussions[1] }
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReset().mockReturnValue({ body: '', change: vi.fn(), discard: vi.fn(), error: null, persistenceStatus: 'saved' })
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(true)
    detailMocks.queryCalls.length = 0
    detailMocks.discussions[1] = original.discussions
  })

  function renderDetail(tab: 'discussion' | 'changes') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} tab={tab} onTabChange={vi.fn()} /></ThemeProvider></QueryClientProvider>)
  }

  it('applies a suggestion by someone else on the head it was shown on, with the commit message', async () => {
    const note = { ...original.discussions[0].notes[2], body: '提案です\n\n```suggestion\nline 2\n```', id: '1003', suggestions: [{ appliable: true, applied: false, fromContent: 'line two\n', fromLine: 2, id: '77', toContent: 'line 2\n', toLine: 2 }] }
    detailMocks.discussions[1] = [{ ...original.discussions[0], notes: [note] }]
    renderDetail('discussion')

    const suggestion = await screen.findByRole('figure', { name: '変更提案' })
    expect(within(suggestion).getByText('line two')).toBeInTheDocument()
    expect(within(suggestion).getByText('line 2')).toBeInTheDocument()
    fireEvent.click(within(suggestion).getByRole('button', { name: '提案を適用' }))
    const dialog = await screen.findByRole('dialog', { name: '提案を適用しますか？' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'コミットメッセージ（任意）' }), { target: { value: 'Apply review suggestion' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '適用する' }))

    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ commitMessage: 'Apply review suggestion', headSha: 'head-abc', iid: '120', kind: 'applySuggestions', projectId: '7', suggestionIds: ['77'] }, undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows the changes since an earlier version read-only, with the rebase note', async () => {
    renderDetail('changes')

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '比較元バージョン' }))
    fireEvent.click(await screen.findByRole('option', { name: /^バージョン2 · bbbbbbbb/u }))

    await waitFor(() => expect(detailMocks.queryCalls).toContainEqual({ fromSha: 'b'.repeat(40), iid: '120', kind: 'versionCompare', page: 1, projectId: '7', toSha: 'head-abc' }))
    expect(screen.getByText(/ターゲットブランチ由来の変更も含まれます/u)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'src/example.tsの2行にコメント' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Colleagueのスレッド' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '確認済みにする' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'MR全体' }))
    expect(await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' })).toBeInTheDocument()
  })

  it('shows the linked clone against the MR head read-only, without loading the MR diff', async () => {
    localMocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/project', projectPath: 'group/project' })
    localMocks.getLocalChanges.mockResolvedValue({ aheadCount: 1, branch: 'feature', comparedSha: 'head-abc', containsMrHead: true, diffs: [{ ...detailMocks.diff, diff: '@@ -1,2 +1,3 @@\n line one\n line two\n+local line\n' }], localHead: 'c'.repeat(40), repositoryPath: 'C:/repos/project', truncated: false, untrackedCount: 2, untrackedIncluded: 0, untrackedMore: false })
    renderDetail('changes')
    await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' })
    detailMocks.queryCalls.length = 0

    fireEvent.click(screen.getByRole('button', { name: 'ローカルの変更' }))

    expect(await screen.findByText('local line')).toBeInTheDocument()
    expect(localMocks.getLocalChanges).toHaveBeenCalledWith('session-42', '7', 'head-abc')
    expect(screen.getByRole('button', { name: 'ローカルの変更' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('ローカルの作業ツリー')).toBeInTheDocument()
    expect(screen.getByText(/MRの最新より1コミット先（未push）/u)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/ローカルの作業ツリーまでの変更です/u)
    expect(screen.getByText(/未追跡のファイルのうち2件は/u)).toBeInTheDocument()
    expect(detailMocks.queryCalls.filter((query) => (query as { kind?: string } | null)?.kind === 'diffs')).toEqual([])
    expect(screen.queryByRole('button', { name: 'src/example.tsの2行にコメント' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Colleagueのスレッド' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '確認済みにする' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'MR全体' }))
    expect(await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' })).toBeInTheDocument()

    // The button toggles: pressing it again returns to the whole MR.
    fireEvent.click(screen.getByRole('button', { name: 'ローカルの変更' }))
    expect(await screen.findByText('local line')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ローカルの変更' }))
    expect(await screen.findByRole('button', { name: 'src/example.tsの2行にコメント' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ローカルの変更' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'MR全体' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('replying and resolving in the diff', () => {
  const original = detailMocks.discussions[1]
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReset().mockImplementation((key: string) => {
      const [body, change] = useState(key.includes('discussion-120') ? '差分からの返信' : '')
      return { body, change, discard: vi.fn(), error: null, persistenceStatus: 'saved' }
    })
    detailMocks.flushComposerBuffersMock.mockReset().mockResolvedValue(true)
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(true)
    // The line thread can be resolved.
    detailMocks.discussions[1] = [{ ...detailMocks.discussion, notes: detailMocks.discussion.notes.map((note) => note.position ? { ...note, resolvable: true } : note) }]
    return () => { detailMocks.discussions[1] = original }
  })

  function renderChanges() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} tab="changes" onTabChange={vi.fn()} /></ThemeProvider></QueryClientProvider>)
  }

  it('opens the reply editor inside the diff thread and sends the reply to that thread', async () => {
    renderChanges()
    const thread = await screen.findByRole('article', { name: 'Colleagueのスレッド' })
    fireEvent.click(within(thread).getByRole('button', { name: '返信' }))

    const editor = within(thread).getByRole('region', { name: 'レビューコメント入力' })
    fireEvent.click(within(editor).getByRole('button', { name: '返信' }))
    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ body: '差分からの返信', discussionId: 'discussion-120', iid: '120', kind: 'reply', projectId: '7' }, expect.any(String)))
    await waitFor(() => expect(within(thread).queryByRole('region', { name: 'レビューコメント入力' })).not.toBeInTheDocument())
  })

  it('resolves the diff thread', async () => {
    renderChanges()
    const thread = await screen.findByRole('article', { name: 'Colleagueのスレッド' })
    fireEvent.click(within(thread).getByRole('button', { name: '解決する' }))
    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ discussionId: 'discussion-120', iid: '120', kind: 'resolve', projectId: '7', resolved: true }, undefined))
  })

  describe('on an MR you neither wrote, are assigned to nor review', () => {
    const involved = detailMocks.mergeRequest
    beforeEach(() => {
      detailMocks.mergeRequest = { ...involved, reviewers: [] }
      return () => { detailMocks.mergeRequest = involved }
    })

    it('asks before a write and sends nothing when declined', async () => {
      globalThis.confirm = vi.fn(() => false)
      renderChanges()
      const thread = await screen.findByRole('article', { name: 'Colleagueのスレッド' })
      fireEvent.click(within(thread).getByRole('button', { name: '解決する' }))
      await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('担当外のMRです')))
      expect(detailMocks.mutationRunMock).not.toHaveBeenCalled()
    })

    it('sends the write once the warning is accepted', async () => {
      globalThis.confirm = vi.fn(() => true)
      renderChanges()
      const thread = await screen.findByRole('article', { name: 'Colleagueのスレッド' })
      fireEvent.click(within(thread).getByRole('button', { name: '解決する' }))
      await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resolve' }), undefined))
    })
  })
})

describe('MergeRequestDetail header, results and pending review', () => {
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReset().mockReturnValue({ body: '', change: vi.fn(), discard: vi.fn(), error: null, persistenceStatus: 'saved' })
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(true)
    detailMocks.mutationDetailedMock.mockClear()
    detailMocks.refreshKinds.length = 0
    globalThis.confirm = vi.fn(() => true)
    return () => {
      detailMocks.drafts = []
      detailMocks.commits = []
      detailMocks.mutationState = { error: null, status: 'idle', unknownAction: null }
    }
  })

  function renderDetail(tab: 'discussion' | 'changes' | 'overview' | 'pipelines' = 'discussion') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} onTabChange={vi.fn()} tab={tab} /></ThemeProvider></QueryClientProvider>)
  }

  it('refreshes what the visible tab shows, not only the overview', async () => {
    renderDetail('discussion')
    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    expect(detailMocks.refreshKinds).toEqual(expect.arrayContaining(['mr', 'approvals', 'drafts', 'discussions']))
  })

  it('copies the MR link from the header', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderDetail('discussion')
    fireEvent.click(await screen.findByRole('button', { name: 'リンクをコピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(detailMocks.mergeRequest.webUrl))
  })

  it('names the write whose result is unknown, in the header', async () => {
    detailMocks.mutationState = { error: new Error('unknown'), status: 'unknown', unknownAction: { kind: 'approve' } }
    renderDetail('discussion')
    const header = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement
    expect(within(header).getByText('承認の結果を確認できないため、このMRへの再送を停止しています。')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'サーバーから再取得' })).toBeInTheDocument()
  })

  it('shows the pipelines tab and names an unknown pipeline write in the header', async () => {
    detailMocks.mutationState = { error: new Error('unknown'), status: 'unknown', unknownAction: { kind: 'cancelPipeline' } }
    renderDetail('pipelines')
    const header = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement
    expect(within(header).getByRole('tab', { name: 'パイプライン' })).toHaveAttribute('aria-selected', 'true')
    expect(within(header).getByText('パイプラインのキャンセルの結果を確認できないため、このMRへの再送を停止しています。')).toBeInTheDocument()
    expect(await screen.findByText('このMRのパイプラインはありません。')).toBeInTheDocument()
  })

  it('shows a failed write in the header until it is dismissed', async () => {
    detailMocks.mutationState = { error: new Error('GitLabが拒否しました。'), status: 'error', unknownAction: null }
    renderDetail('discussion')
    const header = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement
    expect(within(header).getByText('GitLabが拒否しました。')).toBeInTheDocument()
    fireEvent.click(within(header).getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('GitLabが拒否しました。')).not.toBeInTheDocument()
  })

  it('keeps the approve button busy until the write and the approvals read finish', async () => {
    let finish: (value: boolean) => void = () => undefined
    detailMocks.mutationRunMock.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve }))
    renderDetail('overview')
    fireEvent.click(await screen.findByRole('button', { name: '承認する' }))
    expect(await screen.findByRole('button', { name: '承認中…' })).toBeDisabled()
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('!120 を承認しますか？'))
    finish(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '承認する' })).toBeEnabled())
    expect(detailMocks.mutationRunMock).toHaveBeenCalledTimes(1)
  })

  it('asks only once before approving an MR you are not part of', async () => {
    const involved = detailMocks.mergeRequest
    detailMocks.mergeRequest = { ...involved, reviewers: [] }
    try {
      renderDetail('overview')
      fireEvent.click(await screen.findByRole('button', { name: '承認する' }))
      await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledTimes(1))
      expect(globalThis.confirm).toHaveBeenCalledTimes(1)
      expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('!120 を承認しますか？'))
    } finally {
      detailMocks.mergeRequest = involved
    }
  })

  it('asks before approving and sends nothing when declined', async () => {
    globalThis.confirm = vi.fn(() => false)
    renderDetail('overview')
    fireEvent.click(await screen.findByRole('button', { name: '承認する' }))
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('!120 を承認しますか？')))
    expect(detailMocks.mutationRunMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '承認する' })).toBeEnabled()
  })

  it('asks before publishing one draft and sends nothing when declined', async () => {
    detailMocks.drafts = [{ body: '一件目', discussionId: null, id: 'draft-1', position: null }]
    globalThis.confirm = vi.fn(() => false)
    renderDetail('discussion')
    fireEvent.click(await screen.findByRole('button', { name: '下書き「一件目」を公開' }))
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('この下書きを公開しますか？')))
    expect(detailMocks.mutationDetailedMock).not.toHaveBeenCalled()
    globalThis.confirm = vi.fn(() => true)
    fireEvent.click(screen.getByRole('button', { name: '下書き「一件目」を公開' }))
    await waitFor(() => expect(detailMocks.mutationDetailedMock).toHaveBeenCalledWith({ draftId: 'draft-1', iid: '120', kind: 'publishDraft', projectId: '7' }))
  })

  it('reads every page of the pending review before publishing all of it, one by one', async () => {
    const first = { body: '一件目', discussionId: null, id: 'draft-1', position: null }
    const second = { body: '二件目', discussionId: null, id: 'draft-2', position: null }
    detailMocks.drafts = [first]
    detailMocks.queryGitLabMock.mockReset().mockImplementation(async ({ query }: { query: { page: number } }) => query.page === 1 ? { data: [first], nextPage: 2 } : { data: [second], nextPage: null })
    renderDetail('discussion')

    fireEvent.click(await screen.findByRole('button', { name: 'すべて公開' }))
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('未公開レビュー2件をすべて公開しますか？')))
    await waitFor(() => expect(detailMocks.mutationDetailedMock).toHaveBeenCalledTimes(2))
    expect(detailMocks.mutationDetailedMock.mock.calls.map(([action]) => (action as { draftId: string }).draftId)).toEqual(['draft-1', 'draft-2'])
  })

  it('keeps an edited draft across tab changes and Esc, and asks before cancelling it', async () => {
    const actual = await vi.importActual<typeof import('./useComposerBuffer')>('./useComposerBuffer')
    detailMocks.useComposerBufferMock.mockImplementation(actual.useComposerBuffer)
    detailMocks.drafts = [{ body: '下書きの本文', discussionId: null, id: 'draft-1', position: null }]
    globalThis.confirm = vi.fn(() => false)
    function Harness() {
      const [tab, setTab] = useState<'discussion' | 'changes' | 'overview' | 'pipelines'>('discussion')
      return <MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} onTabChange={setTab} tab={tab} />
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><Harness /></ThemeProvider></QueryClientProvider>)
    try {
      const editButton = await screen.findByRole('button', { name: '下書き「下書きの本文」を編集' })
      fireEvent.click(editButton)
      expect(await screen.findByRole('textbox', { name: '下書きを編集' })).toHaveValue('下書きの本文')
      fireEvent.change(screen.getByRole('textbox', { name: '下書きを編集' }), { target: { value: '直した下書き' } })

      // Another tab and back: the edit is still open with its text.
      fireEvent.click(screen.getByRole('tab', { name: '変更' }))
      expect(screen.queryByRole('textbox', { name: '下書きを編集' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: /議論/u }))
      expect(await screen.findByRole('textbox', { name: '下書きを編集' })).toHaveValue('直した下書き')

      // Esc closes without asking and keeps the text for the next edit.
      fireEvent.keyDown(screen.getByRole('textbox', { name: '下書きを編集' }), { key: 'Escape' })
      expect(screen.queryByRole('textbox', { name: '下書きを編集' })).not.toBeInTheDocument()
      expect(globalThis.confirm).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '下書き「下書きの本文」を編集' }))
      expect(await screen.findByRole('textbox', { name: '下書きを編集' })).toHaveValue('直した下書き')

      // 取消 asks first; declining keeps editing.
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('下書きの編集を破棄しますか？')))
      expect(screen.getByRole('textbox', { name: '下書きを編集' })).toHaveValue('直した下書き')

      // A saved edit closes and leaves nothing kept.
      fireEvent.keyDown(screen.getByRole('textbox', { name: '下書きを編集' }), { ctrlKey: true, key: 'Enter' })
      await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ body: '直した下書き', draftId: 'draft-1', iid: '120', kind: 'editDraft', projectId: '7' }, undefined))
      await waitFor(() => expect(screen.queryByRole('textbox', { name: '下書きを編集' })).not.toBeInTheDocument())
      expect(actual.listUnsafeComposerTargets()).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: '下書き「下書きの本文」を編集' }))
      expect(await screen.findByRole('textbox', { name: '下書きを編集' })).toHaveValue('下書きの本文')
    } finally {
      actual.clearComposerBufferStore()
    }
  })

  it('drops a cancelled draft edit once confirmed', async () => {
    const actual = await vi.importActual<typeof import('./useComposerBuffer')>('./useComposerBuffer')
    detailMocks.useComposerBufferMock.mockImplementation(actual.useComposerBuffer)
    detailMocks.drafts = [{ body: '下書きの本文', discussionId: null, id: 'draft-1', position: null }]
    globalThis.confirm = vi.fn(() => true)
    renderDetail('discussion')
    try {
      fireEvent.click(await screen.findByRole('button', { name: '下書き「下書きの本文」を編集' }))
      fireEvent.change(await screen.findByRole('textbox', { name: '下書きを編集' }), { target: { value: '直した下書き' } })
      expect(actual.listUnsafeComposerTargets()).toEqual([{ iid: '120', inputs: ['未公開レビューの編集'], projectId: '7', projectPath: '', title: 'Read-only integration sample' }])
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      await waitFor(() => expect(screen.queryByRole('textbox', { name: '下書きを編集' })).not.toBeInTheDocument())
      expect(actual.listUnsafeComposerTargets()).toEqual([])
      expect(detailMocks.mutationRunMock).not.toHaveBeenCalled()
    } finally {
      actual.clearComposerBufferStore()
    }
  })

  it('moves between commits with the arrow keys and says why a commit cannot be commented', async () => {
    detailMocks.commits = [{ id: 'aaaaaaaa1', title: '最初のコミット' }, { id: 'bbbbbbbb2', title: '次のコミット内容' }]
    renderDetail('changes')
    const whole = await screen.findByRole('button', { name: 'MR全体' })
    whole.focus()
    fireEvent.keyDown(whole, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: /最初のコミット/u })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' })
    expect(screen.getByRole('button', { name: /次のコミット内容/u })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: /次のコミット内容/u }))
    expect(screen.getByText('コミット単位の表示では行コメントできません。MR全体で表示するとコメントできます。')).toBeInTheDocument()
  })
})

describe('stepping through unresolved threads', () => {
  const original = detailMocks.discussions[1]
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReset().mockReturnValue({ body: '', change: vi.fn(), discard: vi.fn(), error: null, persistenceStatus: 'saved' })
    detailMocks.discussions[1] = [{ ...detailMocks.discussion, notes: detailMocks.discussion.notes.map((note) => note.position ? { ...note, resolvable: true } : note) }]
    HTMLElement.prototype.scrollIntoView = vi.fn()
    return () => { detailMocks.discussions[1] = original }
  })

  function renderDetail(tab: 'discussion' | 'changes') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} onTabChange={vi.fn()} tab={tab} /></ThemeProvider></QueryClientProvider>)
  }

  it('moves to the next unresolved thread with N in the discussion tab', async () => {
    renderDetail('discussion')
    await screen.findByText('位置コメント')
    fireEvent.keyDown(document.body, { key: 'n' })
    expect(document.activeElement?.getAttribute('data-note-id')).toBe('1001')
  })

  it('moves to the unresolved thread under the diff line with the header control', async () => {
    renderDetail('changes')
    const thread = await screen.findByRole('article', { name: 'Colleagueのスレッド' })
    fireEvent.click(screen.getByRole('button', { name: '次の未解決スレッド' }))
    expect(thread).toHaveFocus()
  })

  describe('across files in the changes tab', () => {
    const thread = (id: string, path: string, line: number, body: string) => ({ id, individualNote: false, notes: [{ author: { id: '99', name: `${body}の人`, username: 'colleague' }, body, createdAt: '2026-04-03T00:00:00.000Z', id: `note-${id}`, position: { ...detailMocks.position, newLine: line, newPath: path, oldLine: line, oldPath: path }, resolvable: true, resolved: false, system: false }] })
    const file = (path: string) => ({ ...detailMocks.diff, diff: '@@ -1,2 +1,2 @@\n first\n second\n', newPath: path, oldPath: path })
    beforeEach(() => {
      // Every thread sits just below the header, where a reached thread lands.
      // (The header's lower edge is 0; every size the tabs read stays a number.)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 0, height: 0, left: 0, right: 0, toJSON: () => ({}), top: 8, width: 0, x: 0, y: 8 })
      return () => {
        detailMocks.diffPages = null
        vi.restoreAllMocks()
      }
    })
    const focusedThread = () => document.activeElement?.closest('[data-diff-thread]')?.getAttribute('data-diff-thread')

    it('continues to the next file with unresolved threads in file tree order, wrapping around', async () => {
      // GitLab returns README.md first; the tree lists folders first: lib/z.ts, src/example.ts, README.md.
      detailMocks.diffPages = { 1: [file('README.md'), file('src/example.ts'), file('lib/z.ts')] }
      detailMocks.discussions[1] = [thread('readme', 'README.md', 1, 'りーどみー'), thread('example', 'src/example.ts', 2, 'えぐざんぷる'), thread('z', 'lib/z.ts', 1, 'ぜっと')]
      renderDetail('changes')
      // README.md opens a changed-section preview; a thread shortcut opens its source line.
      expect((await screen.findByRole('button', { name: '差分' }))).toHaveAttribute('aria-pressed', 'true')

      fireEvent.keyDown(document.body, { key: 'n' })
      await waitFor(() => expect(focusedThread()).toBe('z'))
      fireEvent.keyDown(document.body, { key: 'n' })
      await waitFor(() => expect(focusedThread()).toBe('example'))
      fireEvent.keyDown(document.body, { key: 'p' })
      await waitFor(() => expect(focusedThread()).toBe('z'))
      fireEvent.keyDown(document.body, { key: 'p' })
      await waitFor(() => expect(focusedThread()).toBe('readme'))
    })

    it('opens a file on a later diff page and focuses its thread', async () => {
      detailMocks.diffPages = { 1: [file('README.md')], 2: [file('src/example.ts')] }
      detailMocks.discussions[1] = [thread('example', 'src/example.ts', 2, 'えぐざんぷる')]
      renderDetail('changes')
      await screen.findByRole('button', { name: '差分の次のページ' })
      expect(screen.queryByText('えぐざんぷる')).not.toBeInTheDocument()

      fireEvent.keyDown(document.body, { key: 'n' })
      await waitFor(() => expect(focusedThread()).toBe('example'))
      expect(screen.getByText('差分のページ 2')).toBeInTheDocument()
    })
  })

  it('ignores N while typing', async () => {
    renderDetail('discussion')
    const input = await screen.findByRole('textbox', { name: 'コメント本文' })
    input.focus()
    fireEvent.keyDown(input, { key: 'n' })
    expect(input).toHaveFocus()
  })
})

describe('reactions and To-Dos', () => {
  const colleague = { id: '99', name: 'Colleague', username: 'colleague' }
  beforeEach(() => {
    detailMocks.useComposerBufferMock.mockReturnValue({ body: '', change: vi.fn(), discard: vi.fn(), error: null, persistenceStatus: 'saved' })
    detailMocks.mutationRunMock.mockReset().mockResolvedValue(true)
    detailMocks.mutationDetailedMock.mockClear()
    detailMocks.queryCalls.length = 0
    detailMocks.refreshKinds.length = 0
    detailMocks.discussions = { 1: [detailMocks.discussion] }
    detailMocks.noteAwards = [{ awards: [{ name: 'thumbsup', user: colleague }, { name: 'thumbsup', user: detailMocks.session.user }], noteId: '1002' }]
    detailMocks.mrAwards = [{ name: 'tada', user: colleague }]
    // GraphQL addresses the project by its path.
    Object.assign(detailMocks.mergeRequest, { projectPath: 'group/project' })
  })
  afterEach(() => {
    delete (detailMocks.mergeRequest as { projectPath?: string }).projectPath
  })

  function renderDetail(tab: 'discussion' | 'overview', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('dark')}><MergeRequestDetail initialMergeRequest={detailMocks.mergeRequest as MergeRequest} onBack={() => undefined} onTabChange={vi.fn()} tab={tab} /></ThemeProvider></QueryClientProvider>)
  }

  it('reads the shown comments\' reactions in one query and toggles the own reaction on a comment', async () => {
    renderDetail('discussion')
    const own = await screen.findByRole('button', { name: '👍 2人' })
    expect(own).toHaveAttribute('aria-pressed', 'true')
    // One query reaches back to the oldest comment on screen (system notes excluded).
    expect(detailMocks.queryCalls.filter((query) => (query as { kind?: string } | null)?.kind === 'noteAwards')).toContainEqual({ iid: '120', kind: 'noteAwards', projectPath: 'group/project', sinceNoteId: '1001' })

    fireEvent.click(own)
    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ iid: '120', kind: 'removeAward', name: 'thumbsup', noteId: '1002', projectId: '7' }, undefined))
    expect(detailMocks.refreshKinds).toContain('noteAwards')
    // The accepted change is shown at once on the comment's reactions, then read back.
    const [, sessionId, awardsQuery, change] = detailMocks.applyConfirmedMock.mock.calls.at(-1) as [unknown, string, { kind: string }, (entries: Array<{ noteId: string; awards: Array<{ name: string; user: { id: string } }> }>) => Array<{ noteId: string; awards: unknown[] }>]
    expect(sessionId).toBe('session-42')
    expect(awardsQuery).toMatchObject({ kind: 'noteAwards', sinceNoteId: '1001' })
    expect(change([{ awards: [{ name: 'thumbsup', user: { id: '42' } }, { name: 'thumbsup', user: { id: '99' } }], noteId: '1002' }])).toEqual([{ awards: [{ name: 'thumbsup', user: { id: '99' } }], noteId: '1002' }])

    // Each comment by Colleague has its own add button; the first is the oldest.
    fireEvent.click(screen.getAllByRole('button', { name: 'Colleagueのコメントにリアクションを追加' })[0])
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /:rocket:/u }))
    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'addAward', name: 'rocket' }), undefined))
  })

  it('shows the MR\'s own reactions under its description', async () => {
    renderDetail('overview')
    fireEvent.click(await screen.findByRole('button', { name: '🎉 1人' }))
    await waitFor(() => expect(detailMocks.mutationRunMock).toHaveBeenCalledWith({ iid: '120', kind: 'addAward', name: 'tada', projectId: '7' }, undefined))
    expect(detailMocks.refreshKinds).toContain('mrAwards')
  })

  it('offers to mark the MR\'s notification read from the loaded To-Do pages only', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const todo = { actionName: 'mentioned', author: colleague, body: '', createdAt: '2026-10-09T00:00:00.000Z', id: '501', iid: '120', projectId: '7', projectName: 'Project', title: 'Read-only integration sample', webUrl: '' }
    const other = { ...todo, id: '502', iid: '121' }
    // Being asked to review is not a notification, so it offers nothing.
    const requested = { ...todo, actionName: 'review_requested', id: '503' }
    client.setQueryData(['gitlab', 'session-42', JSON.stringify({ kind: 'todos', page: 1 })], { error: null, snapshot: { completeness: 'complete', data: [other, requested, todo], fetchedAt: 1, nextPage: null, source: 'network' } })
    renderDetail('discussion', client)

    fireEvent.click(await screen.findByRole('button', { name: '通知を既読にする' }))
    await waitFor(() => expect(detailMocks.mutationDetailedMock).toHaveBeenCalledWith({ iid: '120', kind: 'markTodoDone', projectId: '7', todoId: '501' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '通知を既読にする' })).not.toBeInTheDocument())
    expect(detailMocks.queryCalls).not.toContainEqual(expect.objectContaining({ kind: 'todos' }))
  })
})
