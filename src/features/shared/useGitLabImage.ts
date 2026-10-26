import { useEffect, useState } from 'react'
import { getGitLabImage } from '../../lib/gitlab'

/** Cache only in memory; clear when the user logs out or switches accounts. */
const cache = new Map<string, Promise<string | null>>()
const IMAGE_CACHE_LIMIT = 16
function clearCache() { cache.clear() }
globalThis.addEventListener?.('gitlab-explicit-logout', clearCache)
globalThis.addEventListener?.('gitlab-account-replaced', clearCache)

function load(sessionId: string, url: string): Promise<string | null> {
  const key = `${sessionId}\n${url}`
  const existing = cache.get(key)
  if (existing) return existing
  if (cache.size >= IMAGE_CACHE_LIMIT) cache.clear()
  const request = getGitLabImage(sessionId, url).catch(() => { cache.delete(key); return null })
  cache.set(key, request)
  return request
}

export function useGitLabImage(sessionId: string | undefined, url: string | undefined): { data: string | null; ready: boolean } {
  const key = sessionId && url ? `${sessionId}\n${url}` : null
  const [result, setResult] = useState<{ key: string; data: string | null } | null>(null)
  useEffect(() => {
    if (!sessionId || !url || !key) return
    let active = true
    void load(sessionId, url).then((data) => { if (active) setResult({ key, data }) })
    return () => { active = false }
  }, [key, sessionId, url])
  return { data: result?.key === key ? result.data : null, ready: !key || result?.key === key }
}
