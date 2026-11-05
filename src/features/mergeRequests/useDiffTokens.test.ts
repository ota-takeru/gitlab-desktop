import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ParsedLine } from './diffParser'
import { useDiffTokens } from './useDiffTokens'

function contextLines(count: number): ParsedLine[] {
  return Array.from({ length: count }, (_, index) => ({ commentable: true, kind: 'context', newLine: index + 1, oldLine: index + 1, prefix: ' ', text: `const value${index} = 'padding padding padding padding padding'` }) as ParsedLine)
}

describe('useDiffTokens', () => {
  it('colours a short file with the first render', () => {
    const lines = contextLines(10)
    const { result } = renderHook(() => useDiffTokens(lines, 'typescript', true))
    expect(result.current.at(-1)?.[0]).toEqual({ className: 'hljs-keyword', text: 'const' })
  })

  it('shows the end of a long file as plain text until it has been coloured', async () => {
    const lines = contextLines(5000)
    const { result } = renderHook(() => useDiffTokens(lines, 'typescript', true))

    expect(result.current[0][0]).toEqual({ className: 'hljs-keyword', text: 'const' })
    expect(result.current.at(-1)).toEqual([{ text: lines.at(-1)?.text }])

    await waitFor(() => expect(result.current.at(-1)?.[0]).toEqual({ className: 'hljs-keyword', text: 'const' }))
    expect(result.current.map((line) => line.map((token) => token.text).join(''))).toEqual(lines.map((line) => line.text))
  })

  it('returns no tokens while disabled and plain text without a language', () => {
    const lines = contextLines(2)
    expect(renderHook(() => useDiffTokens(lines, 'typescript', false)).result.current).toEqual([])
    expect(renderHook(() => useDiffTokens(lines, null, true)).result.current[0]).toEqual([{ text: lines[0].text }])
  })
})
