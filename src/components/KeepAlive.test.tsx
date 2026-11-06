import { act, fireEvent, render } from '@testing-library/react'
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

// jsdom has no AnimationEvent, so React listens for the prefixed name.
const endFade = (element: Element) => fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }))

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
    expect(screenOf(container, 'b')).not.toHaveStyle({ animation: 'gitlab-fade-in 150ms ease-out' })

    rerender(view('b', false))
    act(() => { vi.advanceTimersToNextFrame() })
    // It fades in on top of the screen before it, so no blank pane shows between the two.
    expect(screenOf(container, 'a')).not.toHaveStyle({ display: 'none' })
    expect(screenOf(container, 'b')).not.toHaveStyle({ opacity: '0' })
    expect(screenOf(container, 'b')).toHaveStyle({ animation: 'gitlab-fade-in 150ms ease-out', position: 'absolute' })

    endFade(screenOf(container, 'b'))
    expect(screenOf(container, 'a')).toHaveStyle({ display: 'none' })
    expect(screenOf(container, 'b')).not.toHaveStyle({ position: 'absolute' })
    expect(screenOf(container, 'b')).toHaveStyle({ animation: 'gitlab-fade-in 150ms ease-out' })
  })

  it('keeps the screen before one coming back under it until its fade ends', () => {
    const { container, rerender } = render(view('a', false))
    rerender(view('b', false))
    act(() => { vi.advanceTimersToNextFrame() })
    endFade(screenOf(container, 'b'))

    rerender(view('a', false))
    expect(screenOf(container, 'b')).not.toHaveStyle({ display: 'none' })
    expect(screenOf(container, 'a')).toHaveStyle({ position: 'absolute' })
    endFade(screenOf(container, 'a'))
    expect(screenOf(container, 'b')).toHaveStyle({ display: 'none' })
  })

  it('does not take a fade inside the screen for its own', () => {
    const { container, rerender } = render(<KeepAlive activeKey="a" max={3}><span>a</span></KeepAlive>)
    rerender(<KeepAlive activeKey="b" max={3}><span>b</span></KeepAlive>)
    endFade(screenOf(container, 'b').querySelector('span')!)
    expect(screenOf(container, 'a')).not.toHaveStyle({ display: 'none' })
  })

  it('stops covering the screen before it when a fade never reports an end', () => {
    const { container, rerender } = render(view('a', false))
    rerender(view('b', false))
    act(() => { vi.advanceTimersToNextFrame() })
    act(() => { vi.advanceTimersByTime(499) })
    expect(screenOf(container, 'a')).not.toHaveStyle({ display: 'none' })
    act(() => { vi.advanceTimersByTime(1) })
    expect(screenOf(container, 'a')).toHaveStyle({ display: 'none' })
    expect(screenOf(container, 'b')).not.toHaveStyle({ position: 'absolute' })
  })

  it('tells the caller to keep showing what was there until a new screen has faded in', () => {
    const onPending = vi.fn()
    const { container, rerender } = render(view(null, false, onPending))
    rerender(view('a', true, onPending))
    rerender(view('a', false, onPending))
    act(() => { vi.advanceTimersToNextFrame() })
    expect(onPending).toHaveBeenLastCalledWith(true)
    endFade(screenOf(container, 'a'))
    expect(onPending).toHaveBeenLastCalledWith(false)
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
    endFade(screenOf(container, 'a'))
    expect(onPending).toHaveBeenLastCalledWith(false)

    rerender(view('b', false, onPending))
    act(() => { vi.advanceTimersToNextFrame() })
    rerender(view('a', true, onPending))
    expect(screenOf(container, 'a')).not.toHaveStyle({ opacity: '0' })
    endFade(screenOf(container, 'a'))
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
