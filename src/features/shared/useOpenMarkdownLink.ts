import { useCallback, useLayoutEffect, useRef } from 'react'
import { useNotify } from '../../components/Feedback'
import { normalizeGitLabError, openExternalUrl, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import { parseMergeRequestUrl } from '../../lib/mergeRequestUrl'
import { isTauri } from '../../lib/runtime'
import { useConnection } from '../connections/ConnectionProvider'
import type { MrRef } from './personalWorkspace'

function onInstance(url: string, instanceUrl: string): boolean {
  try {
    const target = new URL(url)
    const instance = new URL(instanceUrl)
    const basePath = instance.pathname.replace(/\/+$/u, '')
    return target.protocol === 'https:' && target.origin === instance.origin && (target.pathname === basePath || target.pathname.startsWith(`${basePath}/`))
  } catch { return false }
}

/**
 * Opens a link clicked in a comment or description: an MR on the connected
 * GitLab opens in the app, other GitLab pages and other sites in the default
 * browser. Outside the desktop app links stay plain anchors.
 */
export function useOpenMarkdownLink(onOpenMergeRequest: (ref: MrRef) => void): ((url: string) => void) | undefined {
  const { session } = useConnection()
  const notify = useNotify()
  const openMergeRequestRef = useRef(onOpenMergeRequest)
  useLayoutEffect(() => { openMergeRequestRef.current = onOpenMergeRequest }, [onOpenMergeRequest])
  const sessionId = session?.id
  const instanceUrl = session?.instanceUrl
  const open = useCallback(async (url: string) => {
    if (!sessionId || !instanceUrl) return
    try {
      if (!onInstance(url, instanceUrl)) { await openExternalUrl(url); return }
      let mergeRequest: { path: string; iid: string } | null = null
      try { mergeRequest = parseMergeRequestUrl(url, instanceUrl) } catch { /* Another GitLab page. */ }
      if (!mergeRequest) { await openGitLabUrl(sessionId, url); return }
      const project = await queryGitLab({ sessionId, mode: 'network', query: { kind: 'project', path: mergeRequest.path } })
      if (!project?.data.id) throw new Error('プロジェクトを取得できませんでした。')
      openMergeRequestRef.current({ projectId: project.data.id, iid: mergeRequest.iid })
    } catch (caught) {
      notify({ message: `リンクを開けませんでした: ${normalizeGitLabError(caught).message}`, severity: 'error' })
    }
  }, [instanceUrl, notify, sessionId])
  const openLink = useCallback((url: string) => { void open(url) }, [open])
  return isTauri() && sessionId ? openLink : undefined
}
