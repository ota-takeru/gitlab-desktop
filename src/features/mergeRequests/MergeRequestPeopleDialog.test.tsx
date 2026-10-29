import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GitLabUser } from '../../types/gitlab'
import { MergeRequestPeopleDialog } from './MergeRequestPeopleDialog'

vi.mock('../connections/connectionContext', () => ({ useConnection: () => ({ session: { id: 'session-1', user: { id: 'user-1', name: '自分', username: 'me' } } }) }))
vi.mock('../shared/useGitLabQuery', () => ({ useGitLabQuery: () => ({ data: [], loading: false, refreshing: false }) }))

const participants: GitLabUser[] = [
  { id: 'user-2', name: '太田 健', username: 'ota' },
  { id: 'user-3', name: '佐藤 花子', username: 'sato' },
]

describe('MergeRequestPeopleDialog', () => {
  it('offers the MR participants before typing and filters them by one character of a Japanese name', () => {
    render(<MergeRequestPeopleDialog current={[]} disabled={false} label="レビュアー" onClose={vi.fn()} onSave={vi.fn(async () => true)} open participants={participants} />)
    const input = screen.getByRole('combobox', { name: 'レビュアー' })

    fireEvent.mouseDown(input)
    expect(screen.getByRole('option', { name: /@ota/u })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /@sato/u })).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '佐' } })
    expect(screen.getByRole('option', { name: /@sato/u })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /@ota/u })).not.toBeInTheDocument()

    // The name's space may be left out.
    fireEvent.change(input, { target: { value: '太田健' } })
    expect(screen.getByRole('option', { name: /@ota/u })).toBeInTheDocument()
  })
})
