import { ThemeProvider } from '@mui/material/styles'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../theme'
import { ConditionSearchField, type ConditionTag } from './ConditionSearchField'

function Field({ menu, tags }: { menu?: boolean; tags?: ConditionTag[] }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <ThemeProvider theme={createAppTheme('light')}>
    <ConditionSearchField
      appliedLabel="applied"
      inputRef={inputRef}
      label="search"
      menu={menu ? { id: 'options', label: 'conditions', onChoose, options: [{ kind: 'author', label: 'Author' }], title: 'Add' } : undefined}
      onChange={onChange}
      placeholder="search"
      submitLabel="submit"
      submitTooltip="Enter"
      tags={tags}
      value=""
    />
  </ThemeProvider>
}

const onChange = vi.fn()
const onChoose = vi.fn()

describe('ConditionSearchField', () => {
  it('is a plain search box without a menu', () => {
    render(<Field />)
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('textbox', { name: 'search' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('lists the conditions on Down and hands back the chosen one with the field', () => {
    render(<Field menu />)
    const input = screen.getByRole('combobox', { name: 'search' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Author' }))
    expect(onChoose).toHaveBeenCalledWith('author', expect.any(HTMLElement))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('removes a tag that can be removed and keeps a fixed one', () => {
    const onRemove = vi.fn()
    render(<Field tags={[{ key: 'fixed', label: 'Fixed' }, { key: 'author', label: 'Author: me', onRemove, removeLabel: 'remove author' }]} />)
    expect(screen.getByRole('group', { name: 'applied' })).toBeTruthy()
    expect(screen.getAllByLabelText(/^remove/u)).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('remove author'))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
