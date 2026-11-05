import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { GitLabAction, MergeRequest } from '../../types/gitlab'

const mocks = vi.hoisted(() => ({
  labels: [
    { color: null, description: '不具合', id: '1', name: 'bug' },
    { color: null, description: '', id: '2', name: 'review' },
  ],
  milestones: [{ dueDate: '2026-11-30', id: '5', state: 'active', title: 'v1.0', webUrl: null }],
  project: { squashOption: 'default_off' } as { squashOption?: string },
  queries: [] as unknown[],
  refreshes: 0,
}))

vi.mock('../connections/connectionContext', () => ({
  useConnection: () => ({ session: { id: 'session-1', instanceUrl: 'https://gitlab.example', serverVersion: '18.9.0', user: { id: '42', name: 'Reviewer', username: 'reviewer' } } }),
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: { kind: string } | null) => {
    mocks.queries.push(query)
    const data = query?.kind === 'labels' ? mocks.labels : query?.kind === 'milestones' ? mocks.milestones : query?.kind === 'project' ? mocks.project : null
    return { data, error: null, loading: false, refresh: vi.fn(), refreshing: false, snapshot: null, stale: false }
  },
}))

import { MergeRequestActions, MergeStatusText, type MergeRequestActionsHandle } from './MergeRequestActions'

const head = 'a'.repeat(40)
const base: MergeRequest = {
  author: { id: '1', name: 'Author', username: 'author' },
  canMerge: true,
  description: '',
  detailedMergeStatus: 'mergeable',
  diffRefs: null,
  forceRemoveSourceBranch: true,
  headSha: head,
  id: '10',
  iid: '3',
  labels: ['bug', 'wip'],
  milestone: { dueDate: null, id: '4', state: 'active', title: 'v0.9', webUrl: null },
  projectId: '7',
  projectPath: 'group/app',
  reviewers: [{ id: '42', name: 'Reviewer', username: 'reviewer' }],
  sourceBranch: 'feature',
  squashOnMerge: false,
  state: 'opened',
  targetBranch: 'main',
  title: 'Add search',
  updatedAt: '2026-10-01T00:00:00Z',
  webUrl: 'https://gitlab.example/group/app/-/merge_requests/3',
}

function renderActions(mergeRequest: MergeRequest, onRun = vi.fn<(action: GitLabAction) => Promise<boolean>>(async () => true), isReviewer = true) {
  const onRefresh = vi.fn(() => { mocks.refreshes += 1 })
  const onOpenMerge = vi.fn()
  const handle = createRef<MergeRequestActionsHandle>()
  const element = (next: MergeRequest) => <ThemeProvider theme={createAppTheme('light')}><MergeRequestActions disabled={false} isReviewer={isReviewer} mergeRequest={next} onOpenMerge={onOpenMerge} onRefresh={onRefresh} onRun={onRun} ref={handle} /></ThemeProvider>
  const view = render(element(mergeRequest))
  return { handle, onOpenMerge, onRefresh, onRun, rerender: (next: MergeRequest) => view.rerender(element(next)) }
}

function openMenuItem(name: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name: 'その他の操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

describe('MergeRequestActions', () => {
  beforeEach(() => {
    mocks.queries = []
    mocks.refreshes = 0
    mocks.project = { squashOption: 'default_off' }
    globalThis.confirm = vi.fn(() => true)
  })

  it('leads to the merge panel from the menu and from the header status', () => {
    const { onOpenMerge } = renderActions({ ...base, detailedMergeStatus: 'draft_status' })
    openMenuItem(/マージ…/)
    expect(onOpenMerge).toHaveBeenCalledTimes(1)
    const onOpen = vi.fn()
    render(<ThemeProvider theme={createAppTheme('light')}><MergeStatusText mergeRequest={{ ...base, detailedMergeStatus: 'draft_status' }} onOpen={onOpen} /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Draftのためマージできません' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('merges after confirmation, showing what will be merged', async () => {
    const { handle, onRun } = renderActions(base)
    const options = { autoMerge: false, removeSourceBranch: true, sha: head, squash: true }
    await act(async () => { await handle.current?.merge(options) })
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('!3 をマージ'))
    expect(onRun).toHaveBeenCalledWith({ ...options, iid: '3', kind: 'merge', projectId: '7' })
  })

  it('does not merge when the confirmation is declined', async () => {
    globalThis.confirm = vi.fn(() => false)
    const { handle, onRun } = renderActions(base)
    await act(async () => { await handle.current?.merge({ autoMerge: false, removeSourceBranch: false, sha: head, squash: false }) })
    expect(onRun).not.toHaveBeenCalled()
  })

  it('does not merge a head that moved while the confirmation was open', async () => {
    const { handle, onRun, rerender } = renderActions(base)
    const moved = { ...base, headSha: 'b'.repeat(40) }
    globalThis.confirm = vi.fn(() => { rerender(moved); return true })
    // Not inside act: the re-render's own act has to finish while the merge waits on the confirmation.
    await expect(handle.current?.merge({ autoMerge: false, removeSourceBranch: false, sha: head, squash: false })).resolves.toBe(false)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('cancels auto-merge after confirmation', async () => {
    const { onRun } = renderActions({ ...base, autoMerge: true })
    openMenuItem('自動マージを取り消す')
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ iid: '3', kind: 'cancelAutoMerge', projectId: '7' }))
  })

  it('rebases the shown head and reads the MR again only until GitLab finishes', async () => {
    vi.useFakeTimers()
    try {
      const behind = { ...base, divergedCommitsCount: 2 }
      const { onRefresh, onRun, rerender } = renderActions(behind)
      openMenuItem(/リベース/)
      await act(async () => { await Promise.resolve() })
      expect(onRun).toHaveBeenCalledWith({ iid: '3', kind: 'rebase', projectId: '7', sha: head })
      rerender({ ...behind, rebaseInProgress: true })
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(onRefresh).toHaveBeenCalledTimes(1)
      rerender({ ...behind, divergedCommitsCount: 0, rebaseInProgress: false })
      for (let step = 0; step < 4; step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(onRefresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops reading a rebase that does not finish after a bounded number of reads', async () => {
    vi.useFakeTimers()
    try {
      const { onRefresh, rerender } = renderActions({ ...base, divergedCommitsCount: 2 })
      openMenuItem(/リベース/)
      await act(async () => { await Promise.resolve() })
      rerender({ ...base, divergedCommitsCount: 2, rebaseInProgress: true })
      for (let step = 0; step < 20; step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(onRefresh).toHaveBeenCalledTimes(12)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes and reopens only after confirmation', async () => {
    const { onRun } = renderActions(base)
    globalThis.confirm = vi.fn(() => false)
    openMenuItem('MRをクローズ…')
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalled())
    expect(onRun).not.toHaveBeenCalled()
    globalThis.confirm = vi.fn(() => true)
    openMenuItem('MRをクローズ…')
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ iid: '3', kind: 'setState', projectId: '7', stateEvent: 'close' }))
  })

  it('offers reopen for a closed MR and no merge', async () => {
    const { onRun } = renderActions({ ...base, state: 'closed' })
    fireEvent.click(screen.getByRole('button', { name: 'その他の操作' }))
    expect(screen.queryByRole('menuitem', { name: /マージ…/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'MRを再オープン…' }))
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ iid: '3', kind: 'setState', projectId: '7', stateEvent: 'reopen' }))
  })

  it('edits the title against the title the user started from and toggles Draft', async () => {
    const { onRun } = renderActions(base)
    openMenuItem('タイトルを編集…')
    const dialog = screen.getByRole('dialog', { name: 'タイトルを編集' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'タイトル' }), { target: { value: '  Add fast search ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ expectedTitle: 'Add search', iid: '3', kind: 'setTitle', projectId: '7', title: 'Add fast search' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Enter that confirms an IME conversion does not save.
    openMenuItem('タイトルを編集…')
    const field = within(screen.getByRole('dialog', { name: 'タイトルを編集' })).getByRole('textbox', { name: 'タイトル' })
    fireEvent.change(field, { target: { value: 'Add search 変換' } })
    fireEvent.keyDown(field, { isComposing: true, key: 'Enter' })
    expect(onRun).toHaveBeenCalledTimes(1)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'タイトルを編集' })).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    globalThis.confirm = vi.fn(() => false)
    openMenuItem('Draftにする')
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('!3 をDraftにしますか？')))
    expect(onRun).toHaveBeenCalledTimes(1)
    globalThis.confirm = vi.fn(() => true)
    openMenuItem('Draftにする')
    await waitFor(() => expect(onRun).toHaveBeenLastCalledWith({ expectedTitle: 'Add search', iid: '3', kind: 'setTitle', projectId: '7', title: 'Draft: Add search' }))
  })

  it('sends only the labels added and removed', async () => {
    const { onRun } = renderActions(base)
    openMenuItem('ラベルを編集…')
    const dialog = screen.getByRole('dialog', { name: 'ラベルを編集' })
    // The label dialog searches the project's labels, ancestor groups included.
    expect(mocks.queries).toContainEqual({ kind: 'labels', page: 1, projectId: '7', search: '' })
    const wip = within(dialog).getByRole('button', { name: 'wip' })
    fireEvent.keyDown(wip, { key: 'Backspace' })
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'ラベル' }))
    fireEvent.click(await screen.findByRole('option', { name: /review/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ addLabels: ['review'], iid: '3', kind: 'setLabels', projectId: '7', removeLabels: ['wip'] }))
  })

  it('clears the milestone against the one the user saw', async () => {
    const { onRun } = renderActions(base)
    openMenuItem('マイルストーンを変更…')
    const dialog = screen.getByRole('dialog', { name: 'マイルストーンを変更' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'マイルストーンを外す' }))
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ expectedMilestoneId: '4', iid: '3', kind: 'setMilestone', milestoneId: null, projectId: '7' }))
  })

  it('requests changes only for a reviewer', async () => {
    const { onRun } = renderActions(base)
    openMenuItem('変更を要求')
    await waitFor(() => expect(onRun).toHaveBeenCalledWith({ iid: '3', kind: 'requestChanges', projectId: '7', projectPath: 'group/app' }))
  })

  it('explains why a non-reviewer cannot request changes', () => {
    renderActions(base, undefined, false)
    fireEvent.click(screen.getByRole('button', { name: 'その他の操作' }))
    const item = screen.getByRole('menuitem', { name: /変更を要求/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('レビュアーに指定されている場合に使えます')
  })
})
