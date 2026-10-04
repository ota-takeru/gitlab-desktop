import { beforeEach, describe, expect, it } from 'vitest'

import { preferenceScope, readPinnedProjectIds, readSavedSearches, writePinnedProjectIds, writeSavedSearches } from './preferences'

describe('account-scoped preferences', () => {
  beforeEach(() => localStorage.clear())

  it('preserves case-sensitive Self-Managed base paths while normalizing the host', () => {
    const upper = preferenceScope('HTTPS://GITLAB.EXAMPLE/GitLab', '42')
    const lower = preferenceScope('https://gitlab.example/gitlab', '42')
    writePinnedProjectIds(upper, ['1'])
    writePinnedProjectIds(lower, ['2'])

    expect(readPinnedProjectIds(upper)).toEqual(['1'])
    expect(readPinnedProjectIds(lower)).toEqual(['2'])
  })

  it('bounds persisted shortcuts and keeps all saved search filters', () => {
    const scope = preferenceScope('https://gitlab.example', '42')
    writePinnedProjectIds(scope, Array.from({ length: 101 }, (_, index) => String(index + 1)))
    writeSavedSearches(scope, [{ authorId: '7', id: 'search-1', label: 'History', projectId: '9', query: 'release', reviewer: 'self', state: 'all', updatedAfter: '2026-01-01', updatedBefore: '2026-01-31' }])

    expect(readPinnedProjectIds(scope)).toHaveLength(100)
    expect(readSavedSearches(scope)[0]).toMatchObject({ authorId: '7', projectId: '9', reviewer: 'self', updatedAfter: '2026-01-01', updatedBefore: '2026-01-31' })
  })
})
