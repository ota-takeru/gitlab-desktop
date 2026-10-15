import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { loadEmojiCatalog, readRecentReactions, searchEmoji } from '../lib/awardEmoji'
import { EmojiPicker } from './EmojiPicker'

beforeEach(() => globalThis.localStorage.clear())

function renderPicker(mine: string[] = []) {
  const onPick = vi.fn()
  render(<EmojiPicker anchorEl={document.body} label="このMR" mine={new Set(mine)} onClose={vi.fn()} onPick={onPick} />)
  return { onPick, picker: screen.getByRole('dialog', { name: 'このMRに付ける絵文字' }) }
}

it('finds emoji by Japanese words and by GitLab names, and offers only names GitLab knows', async () => {
  const { choices } = await loadEmojiCatalog()
  expect(searchEmoji(choices, 'いいね')[0]?.name).toBe('thumbsup')
  expect(searchEmoji(choices, 'thumbsup')[0]?.name).toBe('thumbsup')
  expect(searchEmoji(choices, 'ロケット').map((choice) => choice.name)).toContain('rocket')
  // Skin-tone variants and flags are left out of the picker.
  expect(choices.some((choice) => /(?:_tone[1-5]|skin_tone)/u.test(choice.name))).toBe(false)
  expect(choices.some((choice) => choice.name.startsWith('flag_'))).toBe(false)
})

it('starts with the common reactions and picks a search result with Enter', async () => {
  const { onPick, picker } = renderPicker(['thumbsup'])
  const recent = await within(picker).findByRole('group', { name: 'よく使う' })
  expect(within(recent).getAllByRole('button')).toHaveLength(8)
  expect(within(recent).getByRole('button', { name: /:thumbsup:）、付けています/u })).toHaveAttribute('aria-pressed', 'true')

  const search = within(picker).getByRole('textbox', { name: '絵文字を検索' })
  expect(search).toHaveFocus()
  fireEvent.change(search, { target: { value: 'ロケット' } })
  expect(within(picker).getByRole('group', { name: '検索結果' })).toBeInTheDocument()
  fireEvent.keyDown(search, { isComposing: true, key: 'Enter' })
  expect(onPick).not.toHaveBeenCalled()
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(onPick).toHaveBeenLastCalledWith('rocket')
  expect(readRecentReactions()[0]).toBe('rocket')
})

it('says when nothing matches', async () => {
  const { picker } = renderPicker()
  await within(picker).findByRole('group', { name: 'よく使う' })
  fireEvent.change(within(picker).getByRole('textbox', { name: '絵文字を検索' }), { target: { value: 'zzzz' } })
  expect(within(picker).getByText('「zzzz」に一致する絵文字はありません')).toBeInTheDocument()
})

it('shows a category and moves through the grid with the arrow keys', async () => {
  const { onPick, picker } = renderPicker()
  await within(picker).findByRole('group', { name: 'よく使う' })
  fireEvent.click(within(picker).getByRole('tab', { name: '食べ物' }))
  const food = within(picker).getByRole('group', { name: '食べ物' })
  expect(within(food).getByRole('button', { name: /:hamburger:/u })).toBeInTheDocument()

  const search = within(picker).getByRole('textbox', { name: '絵文字を検索' })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  const cells = within(food).getAllByRole('button')
  expect(cells[0]).toHaveFocus()
  fireEvent.keyDown(cells[0]!, { key: 'ArrowRight' })
  expect(cells[1]).toHaveFocus()
  fireEvent.keyDown(cells[1]!, { key: 'ArrowDown' })
  expect(cells[10]).toHaveFocus()
  fireEvent.keyDown(cells[10]!, { key: 'ArrowUp' })
  fireEvent.keyDown(cells[1]!, { key: 'ArrowUp' })
  expect(search).toHaveFocus()

  fireEvent.click(cells[1]!)
  expect(onPick).toHaveBeenCalledTimes(1)
})
