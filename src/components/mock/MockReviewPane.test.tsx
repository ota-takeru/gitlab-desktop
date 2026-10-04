import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from '../../theme'
import { mockMergeRequests } from '../../mock/fixtures'
import { getMockCommitsForMergeRequest } from '../../mock/commits'
import { MockReviewPane } from './MockReviewPane'

function renderPane(activeTab: 'overview' | 'changes' | 'discussion' = 'discussion') {
  const mergeRequest = mockMergeRequests[0]
  const onSelectTab = vi.fn()
  const view = render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <MockReviewPane
        activeTab={activeTab}
        approved={false}
        draft=""
        mergeRequest={mergeRequest}
        onApproveToggle={vi.fn()}
        onBackToList={vi.fn()}
        onCancelReply={vi.fn()}
        onChangeDraft={vi.fn()}
        onOpenDiscussion={vi.fn()}
        onReply={vi.fn()}
        onSaveDraft={vi.fn()}
        onSelectFile={vi.fn()}
        onSelectTab={onSelectTab}
        onSubmitComment={vi.fn()}
        onToggleResolved={vi.fn()}
        replyTarget={undefined}
        resolvedIds={[]}
        selectedFile={mergeRequest.files[0].path}
      />
    </ThemeProvider>,
  )
  return { ...view, onSelectTab }
}

describe('MockReviewPane', () => {
  it('switches between the full MR and parent-to-selected-commit diffs', () => {
    const commits = getMockCommitsForMergeRequest(mockMergeRequests[0].id)
    renderPane('changes')

    expect(screen.getByText('MR全体 · すべての変更ファイル')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(commits.at(-1)?.sha ?? '') }))

    expect(screen.getByText(`親コミット → 選択コミット: ${commits.at(-1)?.parentSHA} → ${commits.at(-1)?.sha}`)).toBeInTheDocument()
    expect(screen.getByText(/DETAIL_CACHE_TTL_MS = 10 \* 60 \* 1000/)).toBeInTheDocument()
    expect(screen.getByText('コミット差分 · 行コメントはMR全体で表示')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(commits[0].sha) }))

    expect(screen.getByText(`親コミット → 選択コミット: ${commits[0].parentSHA} → ${commits[0].sha}`)).toBeInTheDocument()
    expect(screen.getByText(/DETAIL_CACHE_TTL_MS = 5 \* 60 \* 1000/)).toBeInTheDocument()
    expect(screen.queryByText(/DETAIL_CACHE_TTL_MS = 10 \* 60 \* 1000/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'MR全体' }))
    expect(screen.getByText('MR全体 · すべての変更ファイル')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '変更ファイル src/search/query-runner.ts' })).toBeInTheDocument()
  })

  it('keeps the full-file mode when the selected commit changes', () => {
    const commits = getMockCommitsForMergeRequest(mockMergeRequests[0].id)
    renderPane('changes')

    fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))
    expect(screen.getByText(/変更後 · b7c2e81 ·/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(commits[0].sha) }))

    expect(screen.getByText(new RegExp(`変更後 · ${commits[0].sha} ·`))).toBeInTheDocument()
    expect(screen.getByText('行コメントはMR全体の差分で表示')).toBeInTheDocument()
  })

  it('keeps the overview reference-only and sends review work back to the discussion tab', () => {
    const mergeRequest = mockMergeRequests[0]
    const { onSelectTab } = renderPane('overview')

    expect(screen.getByText(mergeRequest.description)).toBeInTheDocument()
    expect(screen.getAllByText(`${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`).length).toBeGreaterThan(0)
    expect(screen.getAllByText(mergeRequest.labels[0]).length).toBeGreaterThan(0)
    expect(screen.getByText(`Checks ${mergeRequest.checksPassed}/${mergeRequest.checksTotal}`)).toBeInTheDocument()
    expect(screen.getByText(`変更 ${mergeRequest.files.length}ファイル`)).toBeInTheDocument()
    expect(screen.queryByText(mergeRequest.discussions[0].body)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'レビューコメント' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '議論に戻る' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '議論に戻る' }))

    expect(onSelectTab).toHaveBeenCalledWith('discussion')
  })

  it('focuses the composer when a discussion reply is selected', () => {
    const mergeRequest = mockMergeRequests[0]
    render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <MockReviewPane
          activeTab="discussion"
          approved={false}
          draft=""
          mergeRequest={mergeRequest}
          onApproveToggle={vi.fn()}
          onBackToList={vi.fn()}
          onCancelReply={vi.fn()}
          onChangeDraft={vi.fn()}
          onOpenDiscussion={vi.fn()}
          onReply={vi.fn()}
          onSaveDraft={vi.fn()}
          onSelectFile={vi.fn()}
          onSelectTab={vi.fn()}
          onSubmitComment={vi.fn()}
          onToggleResolved={vi.fn()}
          replyTarget={mergeRequest.discussions[0].author.name}
          resolvedIds={[]}
          selectedFile={mergeRequest.files[0].path}
        />
      </ThemeProvider>,
    )

    expect(screen.getByRole('textbox', { name: 'レビューコメント' })).toHaveFocus()
    expect(screen.getByText(`${mergeRequest.discussions[0].author.name} に返信`)).toBeInTheDocument()
  })

  it('keeps discussion first in the detail tab order', () => {
    renderPane()

    const tabs = screen.getAllByRole('tab', { name: /^(議論|変更|概要)/ })
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['議論 4', '変更 2', '概要'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })
})
