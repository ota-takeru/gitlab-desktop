import { describe, expect, it } from 'vitest'

import { formatMergeRequestState, formatRelativeTime, shortSha } from './format'

const now = Date.parse('2026-10-09T12:00:00.000Z')

describe('formatRelativeTime', () => {
  it('uses short relative units for the last week', () => {
    expect(formatRelativeTime('2026-10-09T11:59:30.000Z', now)).toBe('たった今')
    expect(formatRelativeTime('2026-10-09T11:45:00.000Z', now)).toBe('15分前')
    expect(formatRelativeTime('2026-10-09T09:00:00.000Z', now)).toBe('3時間前')
    expect(formatRelativeTime('2026-10-07T12:00:00.000Z', now)).toBe('2日前')
  })

  it('falls back to a calendar date for older, future and other-year values', () => {
    expect(formatRelativeTime('2026-09-01T12:00:00.000Z', now)).toBe('9/1')
    expect(formatRelativeTime('2025-09-01T12:00:00.000Z', now)).toBe('2025/9/1')
    expect(formatRelativeTime('2026-10-20T12:00:00.000Z', now)).toBe('10/20')
  })

  it('keeps unparsable values visible instead of hiding them', () => {
    expect(formatRelativeTime('unknown', now)).toBe('unknown')
  })
})

describe('formatMergeRequestState', () => {
  it('maps GitLab states and keeps unknown states visible', () => {
    expect(formatMergeRequestState('opened')).toBe('Open')
    expect(formatMergeRequestState('merged')).toBe('Merged')
    expect(formatMergeRequestState('closed')).toBe('Closed')
    expect(formatMergeRequestState('something')).toBe('something')
    expect(formatMergeRequestState('')).toBe('Unknown')
  })
})

describe('shortSha', () => {
  it('shortens full SHAs only', () => {
    expect(shortSha('a1b2c3d4e5f60718293a')).toBe('a1b2c3d4')
    expect(shortSha('a1b2c3d')).toBe('a1b2c3d')
  })
})
