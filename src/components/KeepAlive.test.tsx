import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { KeepAlive } from './KeepAlive'

it('keeps the listed screens mounted beyond the limit until they leave the list', () => {
  const view = (active: string, keep: string[]) => <KeepAlive activeKey={active} keep={keep} max={2}>{active}</KeepAlive>
  const { container, rerender } = render(view('a', ['a', 'b']))
  for (const active of ['b', 'c', 'd', 'e']) rerender(view(active, ['a', 'b']))
  // a and b are kept; of the others only the limit stays (the active one and one more).
  expect(container.children).toHaveLength(4)
  expect(container.querySelector('[data-screen-active="true"]')).toHaveTextContent('e')

  rerender(view('e', ['b']))
  expect(container.children).toHaveLength(3)
  rerender(view('e', []))
  expect(container.children).toHaveLength(2)
})

it('drops the screens beyond a lowered limit without waiting for the next screen', () => {
  const view = (active: string, max: number) => <KeepAlive activeKey={active} max={max}>{active}</KeepAlive>
  const { container, rerender } = render(view('a', 3))
  for (const active of ['b', 'c']) rerender(view(active, 3))
  expect(container.children).toHaveLength(3)

  rerender(view('c', 1))
  expect(container.children).toHaveLength(1)
  expect(container.querySelector('[data-screen-active="true"]')).toHaveTextContent('c')
})
