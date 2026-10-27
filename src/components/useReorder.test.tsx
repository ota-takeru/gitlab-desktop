import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useReorder } from './useReorder'

// Three 30px rows with 10px between them: tops at 0, 40 and 80.
const ROW = 30
const GAP = 10

function List({ keys, onMove, onOpen = vi.fn() }: { keys: string[]; onMove: (key: string, to: number) => void; onOpen?: (key: string) => void }) {
  const reorder = useReorder({ axis: 'y', keys, onMove })
  return <ul {...reorder.containerProps}>
    {keys.map((key) => <li key={key} {...reorder.itemProps(key)} onClick={() => onOpen(key)} tabIndex={0}>
      {key}<button data-no-reorder type="button">{`${key}を閉じる`}</button>
    </li>)}
    <output data-testid="dragging">{reorder.draggingKey ?? ''}</output>
  </ul>
}

function pointer(type: string, init: { clientX?: number; clientY: number; pointerId?: number }) {
  const event = new MouseEvent(type, { bubbles: true, clientX: init.clientX ?? 0, clientY: init.clientY })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  act(() => { window.dispatchEvent(event) })
}

function row(key: string) {
  return screen.getByText(key, { selector: 'li' })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = Array.from(this.parentElement?.children ?? []).indexOf(this)
    const top = index * (ROW + GAP)
    return { bottom: top + ROW, height: ROW, left: 0, right: 100, top, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 0 })
})

it('moves an item dragged past the middle of another, sliding the others aside meanwhile', () => {
  const onMove = vi.fn()
  const onOpen = vi.fn()
  render(<List keys={['a', 'b', 'c']} onMove={onMove} onOpen={onOpen} />)

  fireEvent.pointerDown(row('a'), { button: 0, clientY: 15, pointerId: 1 })
  pointer('pointermove', { clientY: 17 })
  expect(screen.getByTestId('dragging')).toHaveTextContent('')

  pointer('pointermove', { clientY: 15 + 45 })
  expect(screen.getByTestId('dragging')).toHaveTextContent('a')
  expect(row('a')).toHaveAttribute('data-reorder-dragging', 'true')
  expect(row('a').style.transform).toBe('translateY(45px)')
  expect(row('b').style.transform).toBe(`translateY(${-(ROW + GAP)}px)`)
  expect(row('c').style.transform).toBe('none')

  pointer('pointerup', { clientY: 60 })
  expect(onMove).toHaveBeenCalledWith('a', 1)
  expect(screen.getByTestId('dragging')).toHaveTextContent('')
  // The click that ends the drag does not open the item.
  fireEvent.click(row('a'))
  expect(onOpen).not.toHaveBeenCalled()
  fireEvent.click(row('a'))
  expect(onOpen).toHaveBeenCalledWith('a')
})

it('moves nothing when the drag is cancelled, ends where it began, or starts on a button', () => {
  const onMove = vi.fn()
  render(<List keys={['a', 'b', 'c']} onMove={onMove} />)

  fireEvent.pointerDown(row('c'), { button: 0, clientY: 95, pointerId: 1 })
  pointer('pointermove', { clientY: 20 })
  pointer('pointercancel', { clientY: 20 })
  fireEvent.pointerDown(row('b'), { button: 0, clientY: 55, pointerId: 1 })
  pointer('pointermove', { clientY: 62 })
  pointer('pointerup', { clientY: 62 })
  fireEvent.pointerDown(screen.getByRole('button', { name: 'aを閉じる' }), { button: 0, clientY: 15, pointerId: 1 })
  pointer('pointermove', { clientY: 90 })
  fireEvent.pointerDown(row('a'), { button: 2, clientY: 15, pointerId: 1 })
  pointer('pointermove', { clientY: 90 })
  expect(screen.getByTestId('dragging')).toHaveTextContent('')
  expect(onMove).not.toHaveBeenCalled()
})

it('moves with Alt and the arrow keys within the list and keeps the focus on the item', () => {
  const onMove = vi.fn()
  render(<List keys={['a', 'b', 'c']} onMove={onMove} />)

  fireEvent.keyDown(row('b'), { altKey: true, key: 'ArrowUp' })
  expect(onMove).toHaveBeenLastCalledWith('b', 0)
  expect(document.activeElement).toBe(row('b'))
  fireEvent.keyDown(row('c'), { altKey: true, key: 'ArrowDown' })
  fireEvent.keyDown(row('a'), { altKey: true, key: 'ArrowUp' })
  fireEvent.keyDown(row('a'), { key: 'ArrowDown' })
  fireEvent.keyDown(row('a'), { altKey: true, key: 'ArrowRight' })
  expect(onMove).toHaveBeenCalledTimes(1)
})
