import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock, sessionFixture } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sessionFixture: {
    id: 'session-1',
    instanceUrl: 'https://gitlab.example',
    serverVersion: null,
    user: { id: '42', name: 'Reviewer', username: 'reviewer' },
  },
}))

vi.mock('../connections/ConnectionProvider', () => ({ useConnection: () => ({ session: sessionFixture }) }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: queryMock }))

import { GroupSearchPicker, ProjectSearchPicker, UserSearchPicker } from './SearchPickers'

const users = [{ id: '17', name: 'Alice Example', username: 'alice' }]
const projects = [{ archived: false, description: '', id: '77', name: 'Desktop', pathWithNamespace: 'team/desktop', webUrl: 'https://gitlab.example/team/desktop' }]
const groups = [{ fullName: 'Team / Platform', fullPath: 'team/platform', id: '12', name: 'Platform', webUrl: 'https://gitlab.example/groups/team/platform' }]
const emptyResult = { data: null, error: null, loading: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false }

describe('SearchPickers', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => ({
      ...emptyResult,
      data: query?.kind === 'users' ? users : query?.kind === 'projects' ? projects : query?.kind === 'groups' ? groups : null,
    }))
  })

  it('debounces user candidate search, requires two characters, and returns only the selected ID', async () => {
    const onChange = vi.fn()
    render(<UserSearchPicker ariaLabel="MRの作者" label="作者" onChange={onChange} value="" />)
    const input = screen.getByRole('combobox', { name: 'MRの作者' })

    fireEvent.change(input, { target: { value: 'A' } })
    await new Promise((resolve) => globalThis.setTimeout(resolve, 400))
    expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'users')).toBe(false)

    fireEvent.change(input, { target: { value: 'Al' } })
    await waitFor(() => expect(queryMock).toHaveBeenCalledWith('session-1', expect.objectContaining({ kind: 'users', page: 1, search: 'Al' })))
    fireEvent.click(screen.getByRole('option', { name: /Alice Example/ }))

    expect(onChange).toHaveBeenCalledWith('17')
  })

  it('searches projects with unrestricted membership only when opened on an empty term', async () => {
    const onChange = vi.fn()
    render(<ProjectSearchPicker ariaLabel="MRのプロジェクト" label="プロジェクト" onChange={onChange} value="" />)
    const input = screen.getByRole('combobox', { name: 'MRのプロジェクト' })

    fireEvent.mouseDown(input)
    await waitFor(() => expect(queryMock).toHaveBeenCalledWith('session-1', {
      includeArchived: false,
      kind: 'projects',
      membership: false,
      page: 1,
      search: '',
    }))
    fireEvent.click(screen.getByRole('option', { name: /Desktop/ }))

    expect(onChange).toHaveBeenCalledWith('77')
  })

  it('debounces group candidate search, requires two characters, and returns the ID with the full path', async () => {
    const onChange = vi.fn()
    render(<GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={onChange} value="" />)
    const input = screen.getByRole('combobox', { name: 'MRのグループ' })

    fireEvent.mouseDown(input)
    expect(await screen.findByText('2文字以上入力してください')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'p' } })
    await new Promise((resolve) => globalThis.setTimeout(resolve, 400))
    expect(queryMock.mock.calls.some(([, query]) => query?.kind === 'groups')).toBe(false)

    fireEvent.change(input, { target: { value: 'pl' } })
    await waitFor(() => expect(queryMock).toHaveBeenCalledWith('session-1', { kind: 'groups', page: 1, search: 'pl' }))
    fireEvent.click(screen.getByRole('option', { name: /team\/platform · ID 12/u }))

    expect(onChange).toHaveBeenCalledWith('12', 'team/platform')
  })

  it('reports group search states while loading and after a failure', async () => {
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => ({ ...emptyResult, loading: query?.kind === 'groups' }))
    const view = render(<GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={vi.fn()} value="" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'MRのグループ' }), { target: { value: 'pl' } })
    expect(await screen.findByText('検索中…')).toBeInTheDocument()
    view.unmount()

    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => ({ ...emptyResult, error: query?.kind === 'groups' ? new Error('権限がありません') : null }))
    render(<GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={vi.fn()} value="" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'MRのグループ' }), { target: { value: 'pl' } })
    expect(await screen.findByText('グループ候補を取得できませんでした')).toBeInTheDocument()
    expect(screen.getByText('権限がありません')).toBeInTheDocument()
  })

  it('keeps a saved group path or ID selected, naming the ID by its known path', () => {
    const view = render(<GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={vi.fn()} value="team/platform" />)
    expect(screen.getByRole('combobox', { name: 'MRのグループ' })).toHaveValue('team/platform · 保存済みのグループパス')
    view.rerender(<GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={vi.fn()} value="12" />)
    expect(screen.getByRole('combobox', { name: 'MRのグループ' })).toHaveValue('ID 12 · 保存済みのID')
    view.rerender(<GroupSearchPicker ariaLabel="MRのグループ" label="グループ" onChange={vi.fn()} selectedPath="team/platform" value="12" />)
    expect(screen.getByRole('combobox', { name: 'MRのグループ' })).toHaveValue('team/platform · ID 12')
  })

  it('keeps a legacy ID visible when there is no candidate name available', () => {
    render(<UserSearchPicker ariaLabel="MRの作者" label="作者" onChange={vi.fn()} value="17" />)

    expect(screen.getByRole('combobox', { name: 'MRの作者' })).toHaveValue('ID 17 · 保存済みのID')
  })

  it('shows no choice for a value that is not an ID', () => {
    render(<UserSearchPicker ariaLabel="MRのレビュアー" label="レビュアー" onChange={vi.fn()} value="id" />)

    expect(screen.getByRole('combobox', { name: 'MRのレビュアー' })).toHaveValue('')
  })
})
