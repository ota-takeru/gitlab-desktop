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

import { ProjectSearchPicker, UserSearchPicker } from './SearchPickers'

const users = [{ id: '17', name: 'Alice Example', username: 'alice' }]
const projects = [{ archived: false, description: '', id: '77', name: 'Desktop', pathWithNamespace: 'team/desktop', webUrl: 'https://gitlab.example/team/desktop' }]
const emptyResult = { data: null, error: null, loading: false, refreshing: false, refresh: vi.fn(), snapshot: null, stale: false }

describe('SearchPickers', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockImplementation((_sessionId: string, query: { kind?: string } | null) => ({
      ...emptyResult,
      data: query?.kind === 'users' ? users : query?.kind === 'projects' ? projects : null,
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

  it('keeps a legacy ID visible when there is no candidate name available', () => {
    render(<UserSearchPicker ariaLabel="MRの作者" label="作者" onChange={vi.fn()} value="17" />)

    expect(screen.getByRole('combobox', { name: 'MRの作者' })).toHaveValue('ID 17 · 保存済みのID')
  })
})
