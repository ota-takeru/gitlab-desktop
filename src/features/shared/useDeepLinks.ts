import { listen } from '@tauri-apps/api/event'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useEffect, useRef } from 'react'

import { gitLabUrlFromDeepLink, gitLabUrlOnInstance } from '../../lib/deepLink'
import { isTauri } from '../../lib/runtime'

/** The GitLab page a link or notification names, on the connected instance; null for anything else. */
type Target = (instanceUrl: string) => string | null

/**
 * Opens the GitLab page of a `gitlab-desktop://open?url=…` link, the one the app was
 * started with or one passed to the running app, and of a clicked notification, through
 * the same in-app handling as a link in a comment. One that arrives before the connection
 * is ready waits for it.
 */
export function useDeepLinks(open: ((url: string) => void) | undefined, instanceUrl: string | undefined) {
  const pending = useRef<Target[]>([])
  const target = useRef({ instanceUrl, open })
  useEffect(() => {
    target.current = { instanceUrl, open }
    if (!open || !instanceUrl) return
    const targets = pending.current
    pending.current = []
    for (const resolve of targets) {
      const url = resolve(instanceUrl)
      if (url) open(url)
    }
  }, [instanceUrl, open])

  useEffect(() => {
    if (!isTauri()) return
    let active = true
    const receive = (targets: Target[]) => {
      if (!active) return
      const { instanceUrl: current, open: openLink } = target.current
      if (!openLink || !current) { pending.current.push(...targets); return }
      for (const resolve of targets) {
        const url = resolve(current)
        if (url) openLink(url)
      }
    }
    const receiveLinks = (links: string[] | null) => { if (links) receive(links.map((link) => (instance) => gitLabUrlFromDeepLink(link, instance))) }
    void getCurrent().then(receiveLinks).catch(() => undefined)
    const unlisten = onOpenUrl(receiveLinks).catch(() => undefined)
    const unlistenNotifications = listen<string>('notification-clicked', ({ payload }) => receive([(instance) => gitLabUrlOnInstance(payload, instance)])).catch(() => undefined)
    return () => {
      active = false
      void unlisten.then((stop) => stop?.())
      void unlistenNotifications.then((stop) => stop?.())
    }
  }, [])
}
