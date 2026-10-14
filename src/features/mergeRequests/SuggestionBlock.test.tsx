import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Note, Suggestion } from '../../types/gitlab'
import { NoteBody, type SuggestionActions } from './SuggestionBlock'

const colleague = { id: '9', name: 'Colleague', username: 'colleague' }
const suggestion = (id: string, overrides: Partial<Suggestion> = {}): Suggestion => ({ appliable: true, applied: false, fromContent: `old ${id}\n`, fromLine: 1, id, toContent: `new ${id}\n`, toLine: 1, ...overrides })
const body = '二つ提案します\n\n```suggestion\nnew 1\n```\n\n```suggestion\nnew 2\n```'

function renderBody(note: Pick<Note, 'author' | 'body' | 'suggestions'>, actions: Partial<SuggestionActions> = {}) {
  const onApply = vi.fn(async () => true)
  const onOpenInGitLab = vi.fn()
  render(<ThemeProvider theme={createAppTheme('light')}><NoteBody actions={{ currentUserId: '42', disabled: false, headSha: 'a'.repeat(40), onApply, onOpenInGitLab, ...actions }} note={note} /></ThemeProvider>)
  return { onApply, onOpenInGitLab }
}

describe('NoteBody suggestions', () => {
  it('shows each suggestion against the lines it replaces and applies them one by one or together', async () => {
    const { onApply } = renderBody({ author: colleague, body, suggestions: [suggestion('1'), suggestion('2')] })

    expect(screen.getByText('二つ提案します')).toBeInTheDocument()
    const [first] = screen.getAllByRole('figure', { name: '変更提案' })
    expect(within(first).getByText('old 1').closest('[data-kind]')).toHaveAttribute('data-kind', 'remove')
    expect(within(first).getByText('new 1').closest('[data-kind]')).toHaveAttribute('data-kind', 'add')

    fireEvent.click(screen.getByRole('button', { name: '2件の提案をまとめて適用' }))
    const dialog = await screen.findByRole('dialog', { name: '2件の提案を適用しますか？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '2件を適用する' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(['1', '2'], undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(within(first).getByRole('button', { name: '提案を適用' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '適用する' }))
    await waitFor(() => expect(onApply).toHaveBeenLastCalledWith(['1'], undefined))
  })

  it('offers no apply button to the author, and says when a suggestion is applied or not applicable', () => {
    renderBody({ author: { ...colleague, id: '42' }, body, suggestions: [suggestion('1'), suggestion('2')] })
    expect(screen.queryByRole('button', { name: /適用/u })).not.toBeInTheDocument()
  })

  it('shows applied and unavailable suggestions without an apply button', () => {
    renderBody({ author: colleague, body, suggestions: [suggestion('1', { appliable: false, applied: true }), suggestion('2', { appliable: false })] })
    expect(screen.getByText('適用済み')).toBeInTheDocument()
    expect(screen.getByText('現在は適用できません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提案を適用/u })).not.toBeInTheDocument()
  })

  it('opens GitLab when the suggestions came without their IDs', () => {
    const { onOpenInGitLab } = renderBody({ author: colleague, body })
    fireEvent.click(screen.getAllByRole('button', { name: 'GitLabで適用' })[0])
    expect(onOpenInGitLab).toHaveBeenCalled()
    expect(screen.getAllByText('置き換え前の行は差分のコメント位置で確認してください。')).toHaveLength(2)
  })

  it('keeps applying disabled while writes are blocked', () => {
    renderBody({ author: colleague, body: '```suggestion\nnew 1\n```', suggestions: [suggestion('1')] }, { disabled: true })
    expect(screen.getByRole('button', { name: '提案を適用' })).toBeDisabled()
  })
})
