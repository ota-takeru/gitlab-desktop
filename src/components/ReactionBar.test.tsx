import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

it('opens the emoji picker and removes one the user already gave', async () => {
  globalThis.localStorage.clear()
  const onToggle = vi.fn()
  render(<ReactionBar awards={awards} currentUserId="42" label="Aliceのコメント" onToggle={onToggle} />)

  fireEvent.click(screen.getByRole('button', { name: 'Aliceのコメントにリアクションを追加' }))
  const picker = screen.getByRole('dialog', { name: 'Aliceのコメントに付ける絵文字' })
  fireEvent.click(await within(picker).findByRole('button', { name: /:rocket:/u }))
  expect(onToggle).toHaveBeenLastCalledWith('rocket', true)

  fireEvent.click(screen.getByRole('button', { name: 'Aliceのコメントにリアクションを追加' }))
  const tada = await within(screen.getByRole('dialog')).findByRole('button', { name: /:tada:）、付けています/u })
  expect(tada).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(tada)
  expect(onToggle).toHaveBeenLastCalledWith('tada', false)
})

it('shows less common emoji others gave once the full list has loaded', async () => {
  render(<ReactionBar awards={[{ name: 'flag_jp', user: alice }, { name: 'thumbsup_tone2', user: alice }]} currentUserId="42" label="このMR" onToggle={vi.fn()} />)
  expect(await screen.findByRole('button', { name: '🇯🇵 1人' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '👍🏼 1人' })).toBeInTheDocument()
})

it('disables every control while writes are stopped', () => {
  render(<ReactionBar awards={awards} currentUserId="42" disabled label="このMR" onToggle={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'このMRにリアクションを追加' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '👍 2人' })).toHaveAttribute('aria-disabled', 'true')
})

it('shows a reaction being sent at once and drops it when GitLab refuses', async () => {
  let settle: (accepted: boolean) => void = () => undefined
  const onToggle = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
  render(<ReactionBar awards={awards} currentUserId="42" label="Aliceのコメント" onToggle={onToggle} />)

  fireEvent.click(screen.getByRole('button', { name: ':party_parrot: 1人' }))
  const sending = screen.getByRole('button', { name: ':party_parrot: 2人' })
  expect(sending).toHaveAttribute('aria-pressed', 'true')
  expect(sending).toHaveAttribute('aria-busy', 'true')

  await act(async () => settle(false))
  expect(screen.getByRole('button', { name: ':party_parrot: 1人' })).toHaveAttribute('aria-pressed', 'false')
})

it('keeps an accepted reaction until the reactions read back replace it', async () => {
  let settle: (accepted: boolean) => void = () => undefined
  const onToggle = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
  const view = render(<ReactionBar awards={awards} currentUserId="42" label="Aliceのコメント" onToggle={onToggle} />)

  fireEvent.click(screen.getByRole('button', { name: '👍 2人' }))
  expect(screen.getByRole('button', { name: '👍 1人' })).toHaveAttribute('aria-busy', 'true')
  await act(async () => settle(true))
  expect(screen.getByRole('button', { name: '👍 1人' })).not.toHaveAttribute('aria-busy')

  // GitLab's answer replaces the shown change, here with a reaction someone else added meanwhile.
  view.rerender(<ReactionBar awards={[{ name: 'thumbsup', user: alice }, { name: 'thumbsup', user: { id: '9', name: 'Bob', username: 'bob' } }]} currentUserId="42" label="Aliceのコメント" onToggle={onToggle} />)
  expect(screen.getByRole('button', { name: '👍 2人' })).toHaveAttribute('aria-pressed', 'false')
})
