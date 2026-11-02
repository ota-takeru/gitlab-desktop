import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFadeAfterLoading } from './useFadeAfterLoading'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('fades content in only after a placeholder that stayed long enough to be seen', () => {
  const { rerender, result } = renderHook(({ placeholder }) => useFadeAfterLoading(placeholder), { initialProps: { placeholder: true } })
  act(() => { vi.advanceTimersByTime(50) })
  rerender({ placeholder: false })
  expect(result.current).toBeUndefined()

  rerender({ placeholder: true })
  act(() => { vi.advanceTimersByTime(100) })
  rerender({ placeholder: false })
  expect(result.current).toHaveProperty('animation')
})
