import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { MergeRequest } from '../../types/gitlab'

const mocks = vi.hoisted(() => ({ project: { squashOption: 'default_off' } as { squashOption?: string } }))

vi.mock('../connections/connectionContext', () => ({
  useConnection: () => ({ session: { id: 'session-1' } }),
}))

vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: () => ({ data: mocks.project, error: null, loading: false }),
}))

import { MergePanel, type MergePanelProps } from './MergePanel'

const head = 'a'.repeat(40)
const base = {
  canMerge: true,
  detailedMergeStatus: 'mergeable',
  forceRemoveSourceBranch: true,
  headSha: head,
  iid: '3',
  projectId: '7',
  projectPath: 'group/app',
  sourceBranch: 'feature',
  squashOnMerge: false,
  state: 'opened',
  targetBranch: 'main',
} as MergeRequest

function renderPanel(mergeRequest: Partial<MergeRequest> = {}, props: Partial<MergePanelProps> = {}) {
  const handlers = {
    onCancelAutoMerge: vi.fn(),
    onFocused: vi.fn(),
    onMerge: vi.fn(async () => true),
    onResolve: vi.fn(),
  }
  render(<ThemeProvider theme={createAppTheme('light')}><MergePanel canApprove disabled={false} focusRequested={false} mergeRequest={{ ...base, ...mergeRequest }} {...handlers} {...props} /></ThemeProvider>)
  return handlers
}

describe('MergePanel', () => {
  beforeEach(() => {
    mocks.project = { squashOption: 'default_off' }
  })

  it('merges the shown head with the chosen options', async () => {
    const { onMerge } = renderPanel()
    expect(screen.getByText('マージできます')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'ソースブランチを削除' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'コミットをスカッシュ' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'マージコミットのメッセージを編集' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'マージコミットのメッセージ（任意）' }), { target: { value: 'Merge search' } })
    fireEvent.click(screen.getByRole('button', { name: 'マージする' }))
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith({ autoMerge: false, mergeCommitMessage: 'Merge search', removeSourceBranch: true, sha: head, squash: true }))
  })

  it('does not send a message written before editing was turned off', async () => {
    const { onMerge } = renderPanel()
    const edit = screen.getByRole('checkbox', { name: 'マージコミットのメッセージを編集' })
    fireEvent.click(edit)
    fireEvent.change(screen.getByRole('textbox', { name: 'マージコミットのメッセージ（任意）' }), { target: { value: 'Merge search' } })
    fireEvent.click(edit)
    fireEvent.click(screen.getByRole('button', { name: 'マージする' }))
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith({ autoMerge: false, removeSourceBranch: true, sha: head, squash: false }))
  })

  it.each([
    ['draft_status', 'Readyにする', 'markReady'],
    ['need_rebase', 'リベース', 'rebase'],
    ['discussions_not_resolved', '議論を開く', 'openDiscussion'],
    ['ci_must_pass', 'パイプラインを開く', 'openPipelines'],
    ['not_approved', '承認する', 'approve'],
    ['conflict', 'GitLabで開く', 'openInGitLab'],
  ])('offers the step for %s beside a merge it refuses', (detailedMergeStatus, label, resolution) => {
    const { onResolve } = renderPanel({ detailedMergeStatus })
    expect(screen.getByRole('button', { name: 'マージする' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(onResolve).toHaveBeenCalledWith(resolution)
  })

  it('does not offer approving to someone who cannot approve now', () => {
    renderPanel({ detailedMergeStatus: 'not_approved' }, { canApprove: false })
    expect(screen.queryByRole('button', { name: '承認する' })).not.toBeInTheDocument()
  })

  it('still lets a locked client go to another tab but not write', () => {
    renderPanel({ detailedMergeStatus: 'discussions_not_resolved' }, { disabled: true })
    expect(screen.getByRole('button', { name: '議論を開く' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'ソースブランチを削除' })).toBeDisabled()
  })

  it('offers no step while GitLab is still checking', () => {
    renderPanel({ detailedMergeStatus: 'checking' })
    expect(screen.queryByRole('button', { name: 'GitLabで開く' })).not.toBeInTheDocument()
  })

  it('sets auto-merge while the pipeline runs and keeps a squash the project always does', async () => {
    mocks.project = { squashOption: 'always' }
    const { onMerge } = renderPanel({ detailedMergeStatus: 'ci_still_running', forceRemoveSourceBranch: false, pipeline: { status: 'running', webUrl: '' } })
    expect(screen.queryByRole('button', { name: '今すぐマージ' })).not.toBeInTheDocument()
    const squash = screen.getByRole('checkbox', { name: 'コミットをスカッシュ' })
    expect(squash).toBeChecked()
    expect(squash).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '自動マージを設定' }))
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith({ autoMerge: true, removeSourceBranch: false, sha: head, squash: true }))
  })

  it('offers both auto-merge and merging now when either is possible', async () => {
    const { onMerge } = renderPanel({ pipeline: { status: 'running', webUrl: '' } })
    fireEvent.click(screen.getByRole('button', { name: '今すぐマージ' }))
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith(expect.objectContaining({ autoMerge: false })))
  })

  it('shows how far behind the source branch is with a rebase', () => {
    const { onResolve } = renderPanel({ divergedCommitsCount: 897 })
    expect(screen.getByText('ターゲットより897コミット遅れています')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'リベース' }))
    expect(onResolve).toHaveBeenCalledWith('rebase')
  })

  it('shows only the reason to someone who may not merge', () => {
    renderPanel({ canMerge: false })
    expect(screen.getByText('このMRをマージする権限がありません')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'マージする' })).not.toBeInTheDocument()
  })

  it('leaves rebase and canceling auto-merge to GitLab\'s refusal for someone who may not merge', () => {
    const { onCancelAutoMerge, onResolve } = renderPanel({ autoMerge: true, canMerge: false, divergedCommitsCount: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'リベース' }))
    expect(onResolve).toHaveBeenCalledWith('rebase')
    fireEvent.click(screen.getByRole('button', { name: '自動マージを取り消す' }))
    expect(onCancelAutoMerge).toHaveBeenCalled()
  })

  it('replaces the merge with its cancel once auto-merge is set', () => {
    const { onCancelAutoMerge } = renderPanel({ autoMerge: true })
    expect(screen.queryByRole('button', { name: 'マージする' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '自動マージを取り消す' }))
    expect(onCancelAutoMerge).toHaveBeenCalled()
  })

  it('takes focus when the header asks and reports it once done', () => {
    const { onFocused } = renderPanel({}, { focusRequested: true })
    expect(screen.getByRole('region', { name: 'マージ' })).toHaveFocus()
    expect(onFocused).toHaveBeenCalledTimes(1)
  })
})
