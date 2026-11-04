import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { moveListRowFocus } from './listRowFocus'

function List() {
  return <ul onKeyDown={moveListRowFocus}>
    {['one', 'two', 'three'].map((name) => <li key={name}>
      <button data-list-row="true">{name}</button>
      <button>{`${name} action`}</button>
    </li>)}
    <li><input aria-label="filter" /></li>
  </ul>
}

describe('moveListRowFocus', () => {
  it('moves between neighbouring rows', () => {
    render(<List />)
    screen.getByRole('button', { name: 'one' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'j' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'two' }))
    fireEvent.keyDown(document.activeElement!, { key: 'k' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'one' }))
  })

  it('moves from a row\'s action as it would from the row', () => {
    render(<List />)
    screen.getByRole('button', { name: 'two action' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'k' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'one' }))
    screen.getByRole('button', { name: 'two action' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'j' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'three' }))
  })

  it('leaves typing in a field alone', () => {
    render(<List />)
    const field = screen.getByRole('textbox', { name: 'filter' })
    field.focus()
    fireEvent.keyDown(field, { key: 'j' })
    expect(document.activeElement).toBe(field)
  })
})
