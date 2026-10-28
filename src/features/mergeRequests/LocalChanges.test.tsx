import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitLabCommandError } from '../../types/gitlab'
import { createAppTheme } from '../../theme'

const mocks = vi.hoisted(() => ({
  findLocalRepository: vi.fn(),
  findOwnLocalRepositories: vi.fn(),
  getLocalChanges: vi.fn(),
  getLocalFile: vi.fn(),
  getLocalRepository: vi.fn(),
  getLocalScanFolders: vi.fn(),
  getLocalStatus: vi.fn(),
  linkLocalRepository: vi.fn(),
  pickLocalRepositoryFolder: vi.fn(),
  setLocalScanFolders: vi.fn(),
  unlinkLocalRepository: vi.fn(),
}))
vi.mock('../../lib/localRepository', async () => ({ ...await vi.importActual<typeof import('../../lib/localRepository')>('../../lib/localRepository'), ...mocks }))

import { summarizeLocalStatus, type LocalStatus } from '../../lib/localRepository'
import { LocalChanges, LocalStatusBadge } from './LocalChanges'

const changes = { aheadCount: 0, branch: 'feature', comparedSha: 'a'.repeat(40), containsMrHead: true, diffs: [{ collapsed: false, deletedFile: false, diff: '@@ -1 +1,2 @@\n one\n+two\n', newFile: false, newPath: 'a.txt', oldPath: 'a.txt', renamedFile: false, tooLarge: false }], localHead: 'b'.repeat(40), repositoryPath: 'C:/repos/app', truncated: false, untrackedCount: 0, untrackedIncluded: 0, untrackedMore: false }

function renderLocal(projectPath: string | null = 'group/app') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}><LocalChanges headSha={'a'.repeat(40)} onSelectFile={vi.fn()} projectId="7" projectPath={projectPath} selectedFile={null} sessionId="s1" userId="u1" /></ThemeProvider></QueryClientProvider>)
}

describe('LocalChanges', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getLocalFile.mockResolvedValue({ content: 'one\ntwo\n' })
    mocks.findLocalRepository.mockResolvedValue({ declined: false, repository: null })
    mocks.getLocalScanFolders.mockResolvedValue([])
  })

  it('links a folder through the native check and then reads its changes', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.linkLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue(changes)
    renderLocal()

    const field = await screen.findByRole('textbox', { name: 'ローカルリポジトリのフォルダ' })
    expect(screen.getByRole('button', { name: '紐付ける' })).toBeDisabled()
    fireEvent.change(field, { target: { value: '"C:\\repos\\app"' } })
    fireEvent.click(screen.getByRole('button', { name: '紐付ける' }))

    expect(await screen.findByText('two')).toBeInTheDocument()
    expect(mocks.linkLocalRepository).toHaveBeenCalledWith('s1', '7', 'group/app', '"C:\\repos\\app"')
    expect(mocks.getLocalChanges).toHaveBeenCalledWith('s1', '7', 'a'.repeat(40))
    expect(screen.getByText('C:/repos/app')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /行にコメント/u })).not.toBeInTheDocument()
  })

  it('shows why a folder cannot be linked and keeps the typed path', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.linkLocalRepository.mockRejectedValue(new GitLabCommandError({ code: 'INVALID_INPUT', message: 'このフォルダのgitリモートは group/app を指していません。' }))
    renderLocal()

    fireEvent.change(await screen.findByRole('textbox', { name: 'ローカルリポジトリのフォルダ' }), { target: { value: 'C:\\other' } })
    fireEvent.click(screen.getByRole('button', { name: '紐付ける' }))

    expect(await screen.findByText('このフォルダのgitリモートは group/app を指していません。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'ローカルリポジトリのフォルダ' })).toHaveValue('C:\\other')
    expect(mocks.getLocalChanges).not.toHaveBeenCalled()
  })

  it('cannot link without the project path from GitLab', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    renderLocal(null)
    expect(await screen.findByText(/プロジェクトのパスを返さなかった/u)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'ローカルリポジトリのフォルダ' })).toBeDisabled()
  })

  it('says when the clone does not contain the MR head, and when nothing differs', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue({ ...changes, branch: null, containsMrHead: false, diffs: [], untrackedCount: 3, untrackedMore: true })
    renderLocal()

    expect(await screen.findByText(/ローカルのHEADはMRの最新コミット aaaaaaaa を含んでいません/u)).toBeInTheDocument()
    expect(screen.getByText('MRの最新コミットとローカルの作業ツリーに差分はありません。')).toBeInTheDocument()
    expect(screen.getByText(/未追跡のファイルのうち3件以上は/u)).toBeInTheDocument()
    expect(screen.getByText('（detached HEAD）')).toBeInTheDocument()
  })

  it('shows a missing MR head as an error and reads again on request', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockRejectedValueOnce(new GitLabCommandError({ code: 'NOT_FOUND', message: 'MRの最新コミット aaaaaaaa がローカルにありません。git fetchしてから再読み込みしてください。' })).mockResolvedValueOnce(changes)
    renderLocal()

    expect(await screen.findByText(/git fetchしてから再読み込みしてください/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ローカルの変更を読み直す' }))
    expect(await screen.findByText('two')).toBeInTheDocument()
    expect(screen.queryByText(/git fetchしてから/u)).not.toBeInTheDocument()
  })

  it('links the folder chosen in the system picker', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.pickLocalRepositoryFolder.mockResolvedValue('C:\\repos\\app')
    mocks.linkLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue(changes)
    renderLocal()

    fireEvent.click(await screen.findByRole('button', { name: 'フォルダを選択…' }))

    expect(await screen.findByText('two')).toBeInTheDocument()
    expect(mocks.linkLocalRepository).toHaveBeenCalledWith('s1', '7', 'group/app', 'C:\\repos\\app')
  })

  it('links nothing when the picker is cancelled', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.pickLocalRepositoryFolder.mockResolvedValue(null)
    renderLocal()

    fireEvent.click(await screen.findByRole('button', { name: 'フォルダを選択…' }))
    await waitFor(() => expect(mocks.pickLocalRepositoryFolder).toHaveBeenCalled())
    expect(mocks.linkLocalRepository).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'ローカルリポジトリのフォルダ' })).toHaveValue('')
  })

  it('includes untracked files as new files and shows the whole file from the working tree', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue({ ...changes, diffs: [{ ...changes.diffs[0], diff: '@@ -0,0 +1 @@\n+memo\n', newFile: true, newPath: 'memo.txt', oldPath: 'memo.txt', untracked: true }], untrackedCount: 1, untrackedIncluded: 1 })
    mocks.getLocalFile.mockResolvedValue({ content: 'memo\nsecond line of the file\n' })
    renderLocal()

    expect(await screen.findByText(/未追跡1件を含む/u)).toBeInTheDocument()
    // The file list marks it as untracked, not as a committed new file.
    expect(document.querySelector('[data-kind="U"]')).toBeInTheDocument()
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.queryByText(/上限を超えたため/u)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))

    expect(await screen.findByText('second line of the file')).toBeInTheDocument()
    expect(mocks.getLocalFile).toHaveBeenCalledWith('s1', '7', 'memo.txt')
  })

  it('says when the whole file cannot be read', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue(changes)
    mocks.getLocalFile.mockRejectedValue(new GitLabCommandError({ code: 'TOO_LARGE', message: '1MiBを超えるファイルは表示できません。' }))
    renderLocal()

    fireEvent.click(await screen.findByRole('button', { name: 'ファイル全体' }))
    expect(await screen.findByText('ファイル全体を読めませんでした: 1MiBを超えるファイルは表示できません。')).toBeInTheDocument()
  })

  it('unlinks the folder and returns to the link form with focus in the folder field', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue(changes)
    mocks.unlinkLocalRepository.mockResolvedValue(undefined)
    renderLocal()

    fireEvent.click(await screen.findByRole('button', { name: '紐付けを解除' }))
    await waitFor(() => expect(mocks.unlinkLocalRepository).toHaveBeenCalledWith('s1', '7'))
    expect(await screen.findByRole('textbox', { name: 'ローカルリポジトリのフォルダ' })).toHaveFocus()
  })

  it('moves focus to the refresh button once a folder is linked', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.linkLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue(changes)
    renderLocal()

    fireEvent.change(await screen.findByRole('textbox', { name: 'ローカルリポジトリのフォルダ' }), { target: { value: 'C:\\repos\\app' } })
    fireEvent.click(screen.getByRole('button', { name: '紐付ける' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'ローカルの変更を読み直す' })).toHaveFocus())
  })

  it('keeps the last diff when reading again fails, and says so', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    let rejectRead: (error: unknown) => void = () => undefined
    mocks.getLocalChanges.mockResolvedValueOnce(changes).mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject }))
    renderLocal()

    expect(await screen.findByText('two')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ローカルの変更を読み直す' }))
    expect(await screen.findByText('読み直し中…')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()

    rejectRead(new GitLabCommandError({ code: 'TIMEOUT', message: 'ローカルリポジトリの読み取りがタイムアウトしました。' }))
    expect(await screen.findByText('前回読み取った差分を表示中です。読み直しに失敗しました: ローカルリポジトリの読み取りがタイムアウトしました。')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
    expect(screen.queryByText(/^ローカルの変更を読めませんでした/u)).not.toBeInTheDocument()
  })
})

describe('local changes found without opening the view', () => {
  const status: LocalStatus = { aheadCount: 0, branch: 'feature', changedCount: 0, containsMrHead: true, countMore: false, localHead: 'b'.repeat(40), mrHeadPresent: true, untrackedCount: 0 }

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.findLocalRepository.mockResolvedValue({ declined: false, repository: null })
    mocks.getLocalScanFolders.mockResolvedValue([])
  })

  function renderBadge() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}><button type="button">ローカルの変更<LocalStatusBadge headSha={'a'.repeat(40)} projectId="7" projectPath="group/app" sessionId="s1" sourceBranch="feature" /></button></ThemeProvider></QueryClientProvider>)
  }

  it('names unpushed work, and what keeps the clone from matching the MR', () => {
    expect(summarizeLocalStatus({ ...status, aheadCount: 2, changedCount: 1, untrackedCount: 2 }, 'feature')).toEqual({ label: '未コミット3 · 未push2', tone: 'changes' })
    expect(summarizeLocalStatus({ ...status, changedCount: 300, countMore: true }, 'feature').label).toBe('未コミット300+')
    expect(summarizeLocalStatus(status, 'feature')).toEqual({ label: '変更なし', tone: 'quiet' })
    // Work on another branch is not this MR's.
    expect(summarizeLocalStatus({ ...status, branch: 'main', changedCount: 4, containsMrHead: false }, 'feature')).toEqual({ label: '別ブランチ', tone: 'quiet' })
    expect(summarizeLocalStatus({ ...status, aheadCount: null, changedCount: 1, containsMrHead: false, mrHeadPresent: false }, 'feature')).toEqual({ label: '未コミット1 · 未fetch', tone: 'changes' })
    expect(summarizeLocalStatus({ ...status, aheadCount: 3, containsMrHead: false }, 'feature')).toEqual({ label: '要pull', tone: 'warning' })
  })

  it('reads the linked clone at once and again when the window regains focus', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalStatus.mockResolvedValueOnce({ ...status, changedCount: 1 }).mockResolvedValueOnce({ ...status, aheadCount: 1, changedCount: 2 })
    renderBadge()

    expect(await screen.findByRole('button', { name: 'ローカルの変更未コミット1' })).toBeInTheDocument()
    expect(mocks.getLocalStatus).toHaveBeenCalledWith('s1', '7', 'a'.repeat(40))
    fireEvent.focus(window)
    expect(await screen.findByRole('button', { name: 'ローカルの変更未コミット2 · 未push1' })).toBeInTheDocument()
    expect(mocks.findLocalRepository).not.toHaveBeenCalled()
  })

  it('looks for an unlinked clone below the scan folders and shows nothing when none is found', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    renderBadge()

    await waitFor(() => expect(mocks.findLocalRepository).toHaveBeenCalledWith('s1', '7', 'group/app', false))
    expect(screen.getByRole('button', { name: 'ローカルの変更' })).toBeInTheDocument()
    expect(mocks.getLocalStatus).not.toHaveBeenCalled()
  })

  it('says when the clone cannot be read', async () => {
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalStatus.mockRejectedValue(new GitLabCommandError({ code: 'NOT_FOUND', message: '紐付けたローカルリポジトリのフォルダが見つかりません。' }))
    renderBadge()
    expect(await screen.findByRole('button', { name: 'ローカルの変更読み取れません' })).toBeInTheDocument()
  })

  it('links the clone found after a scan folder is added', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.pickLocalRepositoryFolder.mockResolvedValue('C:\\src')
    mocks.setLocalScanFolders.mockImplementation(async (_session: string, folders: string[]) => folders)
    mocks.getLocalChanges.mockResolvedValue(changes)
    renderLocal()

    const section = await screen.findByRole('region', { name: 'cloneを探すフォルダ' })
    mocks.findLocalRepository.mockResolvedValue({ declined: false, repository: { path: 'C:/src/app', projectPath: 'group/app' } })
    await waitFor(() => expect(within(section).getByRole('button', { name: '探すフォルダを追加…' })).toBeEnabled())
    fireEvent.click(within(section).getByRole('button', { name: '探すフォルダを追加…' }))

    expect(await screen.findByText('two')).toBeInTheDocument()
    expect(mocks.setLocalScanFolders).toHaveBeenCalledWith('s1', ['C:\\src'])
    expect(screen.getByText('C:/src/app')).toBeInTheDocument()
    expect(mocks.linkLocalRepository).not.toHaveBeenCalled()
  })

  it('says when the scan folders hold no clone of the project', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.getLocalScanFolders.mockResolvedValue(['C:\\src'])
    renderLocal()

    expect(await screen.findByText('登録したフォルダに group/app のcloneは見つかりませんでした。')).toBeInTheDocument()
    expect(screen.getByText('C:\\src')).toBeInTheDocument()
  })

  it('searches again for the project when asked, even one the user unlinked', async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.getLocalScanFolders.mockResolvedValue(['C:\\src'])
    mocks.findLocalRepository.mockResolvedValue({ declined: true, repository: null })
    mocks.getLocalChanges.mockResolvedValue(changes)
    renderLocal()

    expect(await screen.findByText('group/app は紐付けを解除したため自動では紐付けません。「このプロジェクトを探す」で探せます。')).toBeInTheDocument()
    mocks.findLocalRepository.mockResolvedValue({ declined: false, repository: { path: 'C:/src/app', projectPath: 'group/app' } })
    fireEvent.click(screen.getByRole('button', { name: 'このプロジェクトを探す' }))

    expect(await screen.findByText('two')).toBeInTheDocument()
    expect(mocks.findLocalRepository).toHaveBeenLastCalledWith('s1', '7', 'group/app', true)
  })

  it("searches for the projects of the user's own MRs at once and lists what was found", async () => {
    mocks.getLocalRepository.mockResolvedValue(null)
    mocks.getLocalScanFolders.mockResolvedValue(['C:\\src'])
    mocks.findOwnLocalRepositories.mockResolvedValue([
      { error: null, projectId: '8', projectPath: 'group/api', result: { declined: false, repository: { path: 'C:/src/api', projectPath: 'group/api' } } },
      { error: null, projectId: '9', projectPath: 'group/web', result: { declined: false, repository: null } },
      { error: null, projectId: '10', projectPath: 'group/old', result: { declined: true, repository: null } },
    ])
    renderLocal()

    const section = await screen.findByRole('region', { name: 'cloneを探すフォルダ' })
    await waitFor(() => expect(within(section).getByRole('button', { name: '自分のMRのプロジェクトをまとめて探す' })).toBeEnabled())
    fireEvent.click(within(section).getByRole('button', { name: '自分のMRのプロジェクトをまとめて探す' }))

    const results = await screen.findByRole('region', { name: '自分のMRのプロジェクトを探した結果' })
    expect(mocks.findOwnLocalRepositories).toHaveBeenCalledWith('s1', 'u1')
    expect(within(results).getByText('自分が作成者または担当者のオープンなMRの3プロジェクトを探し、1件が紐付いています。')).toBeInTheDocument()
    expect(within(results).getByText('C:/src/api')).toBeInTheDocument()
    expect(within(results).getByText('見つかりませんでした')).toBeInTheDocument()
    expect(within(results).getByText('紐付けを解除したため紐付けていません')).toBeInTheDocument()
  })
})

describe('Markdown in local changes', () => {
  it('opens a Markdown change-only preview first and keeps source and whole-file options', async () => {
    const markdownDiff = { ...changes.diffs[0], oldPath: 'docs/guide.md', newPath: 'docs/guide.md', diff: '@@ -1,1 +1,1 @@\n-# Before\n+# Local heading\n' }
    mocks.getLocalRepository.mockResolvedValue({ path: 'C:/repos/app', projectPath: 'group/app' })
    mocks.getLocalChanges.mockResolvedValue({ ...changes, diffs: [markdownDiff] })
    mocks.getLocalFile.mockResolvedValue({ content: '# Local heading\n\nDocument body' })
    renderLocal()
    const preview = await screen.findByRole('region', { name: 'Markdown差分プレビュー' })
    expect(within(preview).getByRole('heading', { name: 'Local heading' })).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'Before' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '差分' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Document body')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Markdown差分のソースを表示' }))
    expect(screen.getAllByTestId('diff-line')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'ファイル全体' }))
    expect(screen.getByRole('button', { name: 'ファイル全体' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Document body')).toBeInTheDocument()
  })
})
