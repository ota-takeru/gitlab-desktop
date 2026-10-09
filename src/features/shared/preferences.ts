const preferencePrefix = 'gitlab-desktop:preferences:'

export interface PreferenceScope {
  instanceUrl: string
  userId: string
}

export interface SavedMergeRequestSearch {
  assignee?: string
  authorId?: string
  id: string
  label: string
  query: string
  reviewer?: string
  state: 'all' | 'opened' | 'closed' | 'merged'
  projectId?: string
  updatedAfter?: string
  updatedBefore?: string
  orderBy?: 'updated_at' | 'created_at'
  sort?: 'asc' | 'desc'
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Preferences are optional. A locked down WebView should not prevent
    // browsing or connecting.
  }
}

export function scopedKey(scope: PreferenceScope, name: string): string {
  const normalizedUrl = normalizeInstanceUrl(scope.instanceUrl)
  return `${preferencePrefix}${encodeURIComponent(normalizedUrl)}:${encodeURIComponent(scope.userId)}:${name}`
}

function normalizeInstanceUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/+$/u, '') || '/'
    // URL normalizes the case-insensitive scheme and host while preserving the
    // case-sensitive Self-Managed base path (for example /GitLab).
    return `${parsed.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/u, '')
  }
}

export function readPinnedProjectIds(scope: PreferenceScope): string[] {
  const values = readJson<unknown>(scopedKey(scope, 'pinned'), [])
  return Array.isArray(values) ? values.filter((value: unknown): value is string => typeof value === 'string') : []
}

export function writePinnedProjectIds(scope: PreferenceScope, ids: string[]): void {
  writeJson(scopedKey(scope, 'pinned'), [...new Set(ids)].slice(0, 100))
}

export function readRecentProjectIds(scope: PreferenceScope): string[] {
  const values = readJson<unknown>(scopedKey(scope, 'recent'), [])
  return Array.isArray(values) ? values.filter((value: unknown): value is string => typeof value === 'string').slice(0, 20) : []
}

export function writeRecentProjectIds(scope: PreferenceScope, ids: string[]): void {
  writeJson(scopedKey(scope, 'recent'), [...new Set(ids)].slice(0, 20))
}

export function readSavedSearches(scope: PreferenceScope): SavedMergeRequestSearch[] {
  const values = readJson<unknown>(scopedKey(scope, 'saved-searches'), [])
  if (!Array.isArray(values)) return []
  return values.filter((value): value is SavedMergeRequestSearch => {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<SavedMergeRequestSearch>
    return typeof candidate.id === 'string'
      && typeof candidate.label === 'string'
      && typeof candidate.query === 'string'
      && (candidate.state === 'all' || candidate.state === 'opened' || candidate.state === 'closed' || candidate.state === 'merged')
      && optionalString(candidate.assignee)
      && optionalString(candidate.authorId)
      && optionalString(candidate.projectId)
      && optionalString(candidate.reviewer)
      && optionalString(candidate.updatedAfter)
      && optionalString(candidate.updatedBefore)
      && (candidate.orderBy === undefined || candidate.orderBy === 'updated_at' || candidate.orderBy === 'created_at')
      && (candidate.sort === undefined || candidate.sort === 'asc' || candidate.sort === 'desc')
  }).slice(0, 20)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

export function writeSavedSearches(scope: PreferenceScope, searches: SavedMergeRequestSearch[]): void {
  writeJson(scopedKey(scope, 'saved-searches'), searches.slice(0, 20))
}

export function clearPreferences(scope: PreferenceScope): void {
  try {
    globalThis.localStorage?.removeItem(scopedKey(scope, 'pinned'))
    globalThis.localStorage?.removeItem(scopedKey(scope, 'recent'))
    globalThis.localStorage?.removeItem(scopedKey(scope, 'saved-searches'))
    globalThis.localStorage?.removeItem(scopedKey(scope, 'personal-workspace'))
    globalThis.dispatchEvent(new Event('gitlab-workspace-preferences-change'))
  } catch {
    // Optional local preferences should never block logout.
  }
}

export function preferenceScope(instanceUrl: string, userId: string): PreferenceScope {
  return { instanceUrl, userId }
}
