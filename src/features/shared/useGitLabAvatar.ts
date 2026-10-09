import { useEffect, useState } from 'react'

import { getGitLabAvatar } from '../../lib/gitlab'

const AVATAR_CACHE_LIMIT = 500
// Avatar images are per session and stay in memory only. Rust keeps the same
// bound and refuses anything that is not an image hosted by the instance.
const cache = new Map<string, Promise<string | null>>()

function clearAvatarCache() {
  cache.clear()
}

globalThis.addEventListener?.('gitlab-explicit-logout', clearAvatarCache)
globalThis.addEventListener?.('gitlab-account-replaced', clearAvatarCache)

function loadAvatar(sessionId: string, url: string): Promise<string | null> {
  const key = `${sessionId}\n${url}`
  const cached = cache.get(key)
  if (cached) return cached
  if (cache.size >= AVATAR_CACHE_LIMIT) cache.clear()
  const pending = getGitLabAvatar(sessionId, url).catch(() => {
    // Failures are not cached so a later render can retry.
    cache.delete(key)
    return null
  })
  cache.set(key, pending)
  return pending
}

/** Resolves a GitLab avatar to a `data:` URL; null while loading or when unavailable. */
export function useGitLabAvatar(sessionId: string | null | undefined, url: string | null | undefined): string | null {
  const key = sessionId && url ? `${sessionId}\n${url}` : null
  const [loaded, setLoaded] = useState<{ key: string; src: string | null } | null>(null)
  useEffect(() => {
    if (!sessionId || !url || !key) return
    let active = true
    void loadAvatar(sessionId, url).then((src) => { if (active) setLoaded({ key, src }) })
    return () => { active = false }
  }, [key, sessionId, url])
  return loaded && loaded.key === key ? loaded.src : null
}
