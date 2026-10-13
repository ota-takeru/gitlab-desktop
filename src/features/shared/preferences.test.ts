import { beforeEach, describe, expect, it } from 'vitest'

import { preferenceScope, readPinnedProjectIds, readSavedSearches, scopedKey, writePinnedProjectIds, writeSavedSearches } from './preferences'

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
    writeSavedSearches(scope, [{ assignee: 'self', authorId: '7', groupId: 'team/platform', id: 'search-1', label: 'History', labels: 'bug,ready', projectId: '9', query: 'release', reviewer: 'self', sourceBranch: 'feature/search', state: 'all', targetBranch: 'main', updatedAfter: '2026-01-01', updatedBefore: '2026-01-31' }])

    expect(readPinnedProjectIds(scope)).toHaveLength(100)
    expect(readSavedSearches(scope)[0]).toMatchObject({ assignee: 'self', authorId: '7', groupId: 'team/platform', labels: 'bug,ready', projectId: '9', reviewer: 'self', sourceBranch: 'feature/search', targetBranch: 'main', updatedAfter: '2026-01-01', updatedBefore: '2026-01-31' })
  })

  it('drops saved searches with incorrectly typed added filters', () => {
    const scope = preferenceScope('https://gitlab.example', '42')
    localStorage.setItem(scopedKey(scope, 'saved-searches'), JSON.stringify([
      { id: 'ok', label: 'Valid', query: '', state: 'all', groupId: 'team/platform', labels: 'bug', sourceBranch: 'feature', targetBranch: 'main' },
      { id: 'bad', label: 'Invalid', query: '', state: 'all', groupId: 42 },
    ]))

    expect(readSavedSearches(scope).map(({ id }) => id)).toEqual(['ok'])
  })
})
