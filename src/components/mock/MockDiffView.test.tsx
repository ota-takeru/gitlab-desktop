import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from '../../theme'
import type { MockChangedFile, MockDiscussion } from '../../mock/fixtures'
import type { MockCommentPosition } from '../../mock/reviewTypes'
import { MockDiffView, type MockDiffDisplayMode } from './MockDiffView'

function renderView(file: MockChangedFile, displayMode: MockDiffDisplayMode = 'full', contentVersionLabel = 'b7c2e81', onAddComment?: (position: MockCommentPosition) => void, commentScope: 'overall' | 'commit' = 'overall', discussions: MockDiscussion[] = []) {
  return render(
    <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
      <MockDiffView
        displayMode={displayMode}
        files={[file]}
        discussions={discussions}
        onDisplayModeChange={vi.fn()}
        onOpenDiscussion={vi.fn()}
        onSelectPath={vi.fn()}
        selectedPath={file.path}
        contentVersionLabel={contentVersionLabel}
        commentScope={commentScope}
        onAddComment={onAddComment}
      />
    </ThemeProvider>,
  )
}

function fileWith(lines: MockChangedFile['lines'], fullContent?: string): MockChangedFile {
  return {
    path: 'src/example.ts',
    additions: 1,
    deletions: 1,
    lines,
    fullContent,
  }
}

describe('MockDiffView', () => {
  it('renders the complete post-change source without diff deletion markers', () => {
    renderView(fileWith([
      { kind: 'context', oldLine: 1, newLine: 1, code: 'export const value = 1' },
      { kind: 'deletion', oldLine: 2, code: 'removed from the file' },
      { kind: 'addition', newLine: 2, code: 'export const value = 2' },
    ], 'header context\nexport const value = 2\ntrailing context'))

    expect(screen.getByText('header context')).toBeInTheDocument()
    expect(screen.getByText('trailing context')).toBeInTheDocument()
    expect(screen.getByText('変更後 · b7c2e81 · 3行')).toBeInTheDocument()
    expect(screen.queryByText('removed from the file')).not.toBeInTheDocument()
    expect(screen.queryByText(/^[+−]/, { selector: 'code' })).not.toBeInTheDocument()
    expect(screen.getByText('行コメントは差分で表示')).toBeInTheDocument()
  })

  it('keeps an unavailable full source distinct from an empty file', () => {
    const unavailable = fileWith([{ kind: 'addition', newLine: 1, code: 'only in diff' }])
    const { unmount } = renderView(unavailable)

    expect(screen.getByText('ファイル全体の内容は未取得です')).toBeInTheDocument()
    expect(screen.getByText('変更後 · b7c2e81 · 内容未取得')).toBeInTheDocument()
    expect(screen.queryByText('only in diff')).not.toBeInTheDocument()

    unmount()
    renderView(fileWith([], ''))

    expect(screen.getByText('このファイルは空です')).toBeInTheDocument()
    expect(screen.getByText('変更後 · b7c2e81 · 空ファイル')).toBeInTheDocument()
    expect(screen.queryByText('ファイル全体の内容は未取得です')).not.toBeInTheDocument()
  })

  it('can return to the diff mode without changing the selected file', () => {
    const onDisplayModeChange = vi.fn()
    const file = fileWith([{ kind: 'context', oldLine: 1, newLine: 1, code: 'const value = 1' }], 'const value = 1')
    render(
      <ThemeProvider theme={createAppTheme('dark', 'workbench')}>
        <MockDiffView
          displayMode="full"
          files={[file]}
          discussions={[]}
          onDisplayModeChange={onDisplayModeChange}
          onOpenDiscussion={vi.fn()}
          onSelectPath={vi.fn()}
          selectedPath={file.path}
        />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '差分' }))

    expect(onDisplayModeChange).toHaveBeenCalledWith('diff')
    expect(screen.getByRole('button', { name: '変更ファイル src/example.ts' })).toHaveAttribute('aria-current', 'true')
  })

  it('emits file, diff-line, and full-file comment positions for the selected version', () => {
    const onAddComment = vi.fn()
    const file = fileWith([
      { kind: 'context', oldLine: 1, newLine: 1, code: 'const before = true' },
      { kind: 'deletion', oldLine: 2, code: 'const removed = true' },
      { kind: 'addition', newLine: 2, code: 'const after = true' },
    ], 'const before = true\nconst after = true')

    const { unmount } = renderView(file, 'diff', 'a1b2c3d', onAddComment, 'commit')

    fireEvent.click(screen.getByRole('button', { name: 'このファイルにコメント' }))
    fireEvent.click(screen.getByRole('button', { name: '新1行目にコメント' }))
    fireEvent.click(screen.getByRole('button', { name: '旧2行目にコメント' }))
    fireEvent.click(screen.getByRole('button', { name: '新2行目にコメント' }))

    expect(onAddComment.mock.calls).toEqual([
      [{ path: 'src/example.ts', side: 'new', sha: 'a1b2c3d', scope: 'commit' }],
      [{ path: 'src/example.ts', side: 'new', line: 1, sha: 'a1b2c3d', scope: 'commit' }],
      [{ path: 'src/example.ts', side: 'old', line: 2, sha: 'a1b2c3d', scope: 'commit' }],
      [{ path: 'src/example.ts', side: 'new', line: 2, sha: 'a1b2c3d', scope: 'commit' }],
    ])

    unmount()
    renderView(file, 'full', 'a1b2c3d', onAddComment, 'commit')
    fireEvent.click(screen.getByRole('button', { name: '新2行目にコメント' }))

    expect(onAddComment).toHaveBeenLastCalledWith({ path: 'src/example.ts', side: 'new', line: 2, sha: 'a1b2c3d', scope: 'commit' })
  })

  it('does not expose line comments when the full source is unavailable', () => {
    const onAddComment = vi.fn()
    renderView(fileWith([{ kind: 'addition', newLine: 1, code: 'only in diff' }]), 'full', 'a1b2c3d', onAddComment)

    expect(screen.queryByRole('button', { name: '新1行目にコメント' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'このファイルにコメント' })).toBeInTheDocument()
  })

  it('matches positioned discussion markers by side, scope, and SHA', () => {
    const file = fileWith([
      { kind: 'deletion', oldLine: 4, code: 'const removed = true' },
      { kind: 'addition', newLine: 8, code: 'const added = true' },
    ], 'const added = true')
    const discussionBase = {
      author: { name: 'レビュー担当', handle: '@reviewer', initials: 'RV' },
      body: '確認コメント',
      createdAt: '今日 10:00',
      file: file.path,
      replies: [],
      state: 'open' as const,
    }
    const discussions: MockDiscussion[] = [
      {
        ...discussionBase,
        id: 'positioned-old',
        line: 4,
        position: { path: file.path, side: 'old', line: 4, sha: 'b7c2e81', scope: 'overall' },
      },
      {
        ...discussionBase,
        id: 'positioned-commit',
        line: 8,
        position: { path: file.path, side: 'new', line: 8, sha: 'b7c2e81', scope: 'commit' },
      },
    ]

    renderView(file, 'diff', 'b7c2e81', undefined, 'overall', discussions)

    expect(screen.getByRole('button', { name: '4行目の議論を開く' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '8行目の議論を開く' })).not.toBeInTheDocument()
  })
})
