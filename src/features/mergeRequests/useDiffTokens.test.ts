import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ParsedLine } from './diffParser'
import { useDiffTokens } from './useDiffTokens'

function contextLines(count: number): ParsedLine[] {
  return Array.from({ length: count }, (_, index) => ({ commentable: true, kind: 'context', newLine: index + 1, oldLine: index + 1, prefix: ' ', text: `const value${index} = 'padding padding padding padding padding'` }) as ParsedLine)
}

function line(kind: ParsedLine['kind'], text: string): ParsedLine {
  return { commentable: true, kind, prefix: kind === 'add' ? '+' : kind === 'remove' ? '-' : ' ', text } as ParsedLine
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

  it('colours removed lines from the old side and context lines from the new side', () => {
    // The added comment opener makes the context line a comment on the new side only.
    const lines = [line('add', '/*'), line('context', 'const a = 1'), line('remove', 'const b = 2')]
    const { result } = renderHook(() => useDiffTokens(lines, 'typescript', true))
    expect(result.current[1][0].className).toBe('hljs-comment')
    expect(result.current[2][0]).toEqual({ className: 'hljs-keyword', text: 'const' })
  })

  it('reads the context before removed lines so a construct opened there colours them', () => {
    const lines = [line('context', '/*'), line('context', 'note'), line('remove', 'const b = 2'), line('add', 'const c = 3'), line('context', 'const d = 4')]
    const { result } = renderHook(() => useDiffTokens(lines, 'typescript', true))
    expect(result.current[2][0].className).toBe('hljs-comment')
    expect(result.current.map((tokens) => tokens.map((token) => token.text).join(''))).toEqual(lines.map((item) => item.text))
  })

  it('colours removed lines far apart in one long file', async () => {
    const lines = [...contextLines(3000), line('remove', 'const first = 1'), ...contextLines(3000), line('remove', 'const last = 2')]
    const { result } = renderHook(() => useDiffTokens(lines, 'typescript', true))
    expect(result.current[3000][0]).toEqual({ className: 'hljs-keyword', text: 'const' })
    await waitFor(() => expect(result.current.at(-1)?.[0]).toEqual({ className: 'hljs-keyword', text: 'const' }))
  })
})
