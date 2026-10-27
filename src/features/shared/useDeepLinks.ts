import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useEffect, useRef } from 'react'

import { gitLabUrlFromDeepLink } from '../../lib/deepLink'
import { isTauri } from '../../lib/runtime'

/**
 * Opens the GitLab page of a `gitlab-desktop://open?url=…` link, the one the app was
 * started with or one passed to the running app, through the same in-app handling as
 * a link in a comment. A link that arrives before the connection is ready waits for it.
 */
export function useDeepLinks(open: ((url: string) => void) | undefined, instanceUrl: string | undefined) {
  const pending = useRef<string[]>([])
  const target = useRef({ instanceUrl, open })
  useEffect(() => {
    target.current = { instanceUrl, open }
    if (!open || !instanceUrl) return
    const links = pending.current
    pending.current = []
    for (const link of links) {
      const url = gitLabUrlFromDeepLink(link, instanceUrl)
      if (url) open(url)
    }
  }, [instanceUrl, open])

  useEffect(() => {
    if (!isTauri()) return
    let active = true
    const receive = (links: string[] | null) => {
      if (!active || !links) return
      const { instanceUrl: current, open: openLink } = target.current
      if (!openLink || !current) { pending.current.push(...links); return }
      for (const link of links) {
        const url = gitLabUrlFromDeepLink(link, current)
        if (url) openLink(url)
      }
    }
    void getCurrent().then(receive).catch(() => undefined)
    const unlisten = onOpenUrl(receive).catch(() => undefined)
    return () => {
      active = false
      void unlisten.then((stop) => stop?.())
    }
  }, [])
}
