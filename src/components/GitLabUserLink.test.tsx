import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { GitLabUserLink } from './GitLabUserLink'
import { MarkdownLinkProvider } from './MarkdownLinks'

const user = { id: '7', name: 'Alice', username: 'alice' }

it('opens the profile through the app without activating its enclosing row', () => {
  const open = vi.fn()
  const rowClick = vi.fn()
  render(<MarkdownLinkProvider instanceUrl="https://gitlab.example/gitlab/" open={open}><div onClick={rowClick}><GitLabUserLink user={user} /></div></MarkdownLinkProvider>)
  fireEvent.click(screen.getByRole('link', { name: 'Alice' }))
  expect(open).toHaveBeenCalledWith('https://gitlab.example/gitlab/alice')
  expect(rowClick).not.toHaveBeenCalled()
})

it('keeps the name as text when there is no connected instance', () => {
  render(<GitLabUserLink user={user} />)
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
