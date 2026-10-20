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
