import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitLabCommandError } from '../../types/gitlab'
import { createAppTheme } from '../../theme'

const mocks = vi.hoisted(() => ({
  getLocalChanges: vi.fn(),
  getLocalFile: vi.fn(),
  getLocalRepository: vi.fn(),
  linkLocalRepository: vi.fn(),
  pickLocalRepositoryFolder: vi.fn(),
  unlinkLocalRepository: vi.fn(),
}))
vi.mock('../../lib/localRepository', () => mocks)

import { LocalChanges } from './LocalChanges'

const changes = { aheadCount: 0, branch: 'feature', comparedSha: 'a'.repeat(40), containsMrHead: true, diffs: [{ collapsed: false, deletedFile: false, diff: '@@ -1 +1,2 @@\n one\n+two\n', newFile: false, newPath: 'a.txt', oldPath: 'a.txt', renamedFile: false, tooLarge: false }], localHead: 'b'.repeat(40), repositoryPath: 'C:/repos/app', truncated: false, untrackedCount: 0, untrackedIncluded: 0, untrackedMore: false }

function renderLocal(projectPath: string | null = 'group/app') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}><LocalChanges headSha={'a'.repeat(40)} onSelectFile={vi.fn()} projectId="7" projectPath={projectPath} selectedFile={null} sessionId="s1" /></ThemeProvider></QueryClientProvider>)
}

describe('LocalChanges', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getLocalFile.mockResolvedValue({ content: 'one\ntwo\n' })
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
    expect(screen.getByText('U')).toBeInTheDocument()
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
