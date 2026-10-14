// Only the GitLab URL is remembered so the connection form can start with it.
// It is not a secret; tokens never leave the Rust side.
const LAST_INSTANCE_KEY = 'gitlab-desktop:last-instance-url'

export function readLastInstanceUrl(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(LAST_INSTANCE_KEY)
    return value && /^https:\/\//u.test(value) ? value : null
  } catch {
    return null
  }
}

export function writeLastInstanceUrl(instanceUrl: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_INSTANCE_KEY, instanceUrl)
  } catch {
    // The form then starts with GitLab.com.
  }
}

/** A host typed without a scheme is taken as HTTPS; trailing slashes are dropped. */
export function normalizeInstanceInput(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, '')
  return trimmed && !/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? `https://${trimmed}` : trimmed
}

export function sameInstance(left: string, right: string): boolean {
  return normalizeInstanceInput(left).toLowerCase() === normalizeInstanceInput(right).toLowerCase()
}
