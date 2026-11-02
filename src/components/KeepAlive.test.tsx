import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeepAlive } from './KeepAlive'
import { useScreenReadiness } from './screenReadinessContext'

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

function Holding({ held, label }: { held: boolean; label: string }) {
  const hold = useScreenReadiness()
  useEffect(() => { if (held && hold) return hold() }, [held, hold])
  return label
}

describe('revealWhenReady', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const view = (active: string | null, held: boolean, onPending?: (pending: boolean) => void) => <KeepAlive activeKey={active} max={3} onRevealPendingChange={onPending} revealWhenReady><Holding held={held} label={active ?? ''} /></KeepAlive>
  // Screens stay in the order they were first shown; a hidden screen's text is emptied, so it cannot be found by it.
  const screenOf = (container: HTMLElement, label: string) => container.children[label.charCodeAt(0) - 'a'.charCodeAt(0)]

  it('keeps the screen before a new one showing until the new one is no longer held', () => {
    const { container, rerender } = render(view('a', false))
    rerender(view('b', true))
    expect(screenOf(container, 'a')).not.toHaveStyle({ display: 'none' })
    expect(screenOf(container, 'b')).toHaveStyle({ opacity: '0', position: 'absolute' })

    rerender(view('b', false))
    act(() => { vi.advanceTimersToNextFrame() })
    expect(screenOf(container, 'a')).toHaveStyle({ display: 'none' })
    expect(screenOf(container, 'b')).not.toHaveStyle({ opacity: '0' })
  })

  it('shows a held screen after a second at most', () => {
    const { container, rerender } = render(view('a', false))
    rerender(view('b', true))
    act(() => { vi.advanceTimersByTime(999) })
    expect(screenOf(container, 'b')).toHaveStyle({ opacity: '0' })
    act(() => { vi.advanceTimersByTime(1) })
    expect(screenOf(container, 'b')).not.toHaveStyle({ opacity: '0' })
  })

  it('shows a kept screen at once, and tells the caller when nothing kept shows in place of a new one', () => {
    const onPending = vi.fn()
    const { container, rerender } = render(view(null, false, onPending))
    rerender(view('a', true, onPending))
    expect(onPending).toHaveBeenLastCalledWith(true)
    rerender(view('a', false, onPending))
    act(() => { vi.advanceTimersToNextFrame() })
    expect(onPending).toHaveBeenLastCalledWith(false)

    rerender(view('b', false, onPending))
    act(() => { vi.advanceTimersToNextFrame() })
    rerender(view('a', true, onPending))
    expect(screenOf(container, 'a')).not.toHaveStyle({ opacity: '0' })
    expect(screenOf(container, 'b')).toHaveStyle({ display: 'none' })
  })

  it('waits for reads inside kept screens of its own', () => {
    const nested = (active: string, held: boolean) => <KeepAlive activeKey={active} max={3} revealWhenReady><KeepAlive activeKey="tab" max={3}><Holding held={held} label={active} /></KeepAlive></KeepAlive>
    const { container, rerender } = render(nested('a', false))
    rerender(nested('b', true))
    act(() => { vi.advanceTimersToNextFrame() })
    expect(screenOf(container, 'b')).toHaveStyle({ opacity: '0' })

    rerender(nested('b', false))
    act(() => { vi.advanceTimersToNextFrame() })
    expect(screenOf(container, 'b')).not.toHaveStyle({ opacity: '0' })
  })
})
