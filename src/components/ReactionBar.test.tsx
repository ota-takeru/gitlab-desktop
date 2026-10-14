import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { emojiForName, groupReactions } from '../lib/awardEmoji'
import type { AwardEmoji } from '../types/gitlab'
import { ReactionBar } from './ReactionBar'

const alice = { id: '7', name: 'Alice', username: 'alice' }
const me = { id: '42', name: 'Reviewer', username: 'reviewer' }
const awards: AwardEmoji[] = [
  { name: 'thumbsup', user: alice },
  { name: 'tada', user: me },
  { name: 'thumbsup', user: me },
  { name: 'party_parrot', user: alice },
]

it('maps common GitLab names to emoji and shows others by name', () => {
  expect(emojiForName('thumbsup')).toBe('👍')
  expect(emojiForName('party_parrot')).toBe(':party_parrot:')
  expect(groupReactions(awards, '42').map(({ mine, name, users }) => [name, users.length, mine])).toEqual([
    ['thumbsup', 2, true],
    ['tada', 1, true],
    ['party_parrot', 1, false],
  ])
})

it('shows one chip per emoji, marks the own ones and toggles the own reaction', () => {
  const onToggle = vi.fn()
  render(<ReactionBar awards={awards} currentUserId="42" label="Aliceのコメント" onToggle={onToggle} />)

  const thumbs = screen.getByRole('button', { name: '👍 2人' })
  expect(thumbs).toHaveAttribute('aria-pressed', 'true')
  expect(thumbs).toHaveClass('MuiChip-colorPrimary')
  expect(screen.getByRole('button', { name: ':party_parrot: 1人' })).toHaveAttribute('aria-pressed', 'false')

  fireEvent.click(thumbs)
  expect(onToggle).toHaveBeenLastCalledWith('thumbsup', false)
  fireEvent.click(screen.getByRole('button', { name: ':party_parrot: 1人' }))
  expect(onToggle).toHaveBeenLastCalledWith('party_parrot', true)
})

it('offers the common reactions and removes one the user already gave', () => {
  const onToggle = vi.fn()
  render(<ReactionBar awards={awards} currentUserId="42" label="Aliceのコメント" onToggle={onToggle} />)

  fireEvent.click(screen.getByRole('button', { name: 'Aliceのコメントにリアクションを追加' }))
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(8)
  fireEvent.click(within(menu).getByRole('menuitem', { name: /rocket/u }))
  expect(onToggle).toHaveBeenLastCalledWith('rocket', true)

  fireEvent.click(screen.getByRole('button', { name: 'Aliceのコメントにリアクションを追加' }))
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /tada（付けています）/u }))
  expect(onToggle).toHaveBeenLastCalledWith('tada', false)
})

it('disables every control while writes are stopped', () => {
  render(<ReactionBar awards={awards} currentUserId="42" disabled label="このMR" onToggle={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'このMRにリアクションを追加' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '👍 2人' })).toHaveAttribute('aria-disabled', 'true')
})
