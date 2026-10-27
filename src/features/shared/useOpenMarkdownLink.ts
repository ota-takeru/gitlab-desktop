import { useCallback, useLayoutEffect, useRef } from 'react'
import { useNotify } from '../../components/feedbackContext'
import { normalizeGitLabError, openExternalUrl, openGitLabUrl, queryGitLab } from '../../lib/gitlab'
import { parseGitLabPageUrl } from '../../lib/gitlabPageUrl'
import { parseMergeRequestUrl } from '../../lib/mergeRequestUrl'
import { isTauri } from '../../lib/runtime'
import type { GitLabUser } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { resolveGitLabPage, type GitLabPageLocation } from './gitlabPageLocation'
import type { MrRef } from './personalWorkspace'

const RESERVED_PROFILE_PATHS = new Set([
  '404.html', '422.html', '500.html', '502.html', '503.html', 'admin', 'api', 'apple-touch-icon.png',
  'assets', 'autocomplete', 'dashboard', 'deploy.html', 'explore', 'favicon.ico', 'favicon.png',
  'files', 'groups', 'health_check', 'help', 'import', 'invites', 'jobs', 'jwt', 'login', 'logout',
  'oauth', 'profile', 'projects', 'public', 'robots.txt', 's', 'search', 'sitemap', 'sitemap.xml',
  'sitemap.xml.gz', 'slash-command-logo.png', 'snippets', 'unsubscribes', 'uploads', 'users', 'v2',
])

type ProfileTarget = { kind: 'username'; username: string } | { kind: 'userId'; userId: string }

function onInstance(url: string, instanceUrl: string): boolean {
  try {
    const target = new URL(url)
    const instance = new URL(instanceUrl)
    const basePath = instance.pathname.replace(/\/+$/u, '')
    return target.protocol === 'https:' && target.origin === instance.origin && (target.pathname === basePath || target.pathname.startsWith(`${basePath}/`))
  } catch { return false }
}

function profileTarget(url: string, instanceUrl: string): ProfileTarget | null {
  try {
    const target = new URL(url)
    const instance = new URL(instanceUrl)
    if (target.protocol !== 'https:' || target.origin !== instance.origin || target.username || target.password) return null
    const basePath = instance.pathname.replace(/\/+$/u, '')
    const prefix = basePath ? `${basePath}/` : '/'
    if (!target.pathname.startsWith(prefix)) return null
    const route = target.pathname.slice(prefix.length).replace(/\/$/u, '')
    if (route.startsWith('-/u/')) {
      const userId = route.slice('-/u/'.length)
      return /^[1-9]\d*$/u.test(userId) ? { kind: 'userId', userId } : null
    }
    let username: string
    try { username = decodeURIComponent(route) } catch { return null }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,253}[a-zA-Z0-9_-]$/u.test(username)) return null
    const normalizedUsername = username.toLowerCase()
    if (RESERVED_PROFILE_PATHS.has(normalizedUsername)
      || /\.(?:git|atom)$/u.test(normalizedUsername)) return null
    return { kind: 'username', username }
  } catch { return null }
}

/**
 * Opens a link clicked in a comment or description. GitLab users, merge
 * requests, and a project's overview, branches, MR list, folders and files on
 * the connected instance open in the app;
 * other GitLab pages and other sites open in the default browser. Outside the
 * desktop app links stay plain anchors.
 */
export function useOpenMarkdownLink(onOpenMergeRequest: (ref: MrRef) => void, onOpenUser: (user: GitLabUser) => void, onOpenPage?: (location: GitLabPageLocation) => void): ((url: string) => void) | undefined {
  const { session } = useConnection()
  const notify = useNotify()
  const openMergeRequestRef = useRef(onOpenMergeRequest)
  const openUserRef = useRef(onOpenUser)
  const openPageRef = useRef(onOpenPage)
  const operationRef = useRef(0)
  const sessionId = session?.id
  const instanceUrl = session?.instanceUrl
  const currentSessionRef = useRef(sessionId)
  useLayoutEffect(() => {
    openMergeRequestRef.current = onOpenMergeRequest
    openUserRef.current = onOpenUser
    openPageRef.current = onOpenPage
  }, [onOpenMergeRequest, onOpenPage, onOpenUser])
  useLayoutEffect(() => {
    currentSessionRef.current = sessionId
    operationRef.current += 1
  }, [instanceUrl, sessionId])
  useLayoutEffect(() => {
    const invalidate = () => { operationRef.current += 1 }
    globalThis.addEventListener('gitlab-explicit-logout', invalidate)
    globalThis.addEventListener('gitlab-account-replaced', invalidate)
    globalThis.addEventListener('gitlab-client-location-change', invalidate)
    globalThis.addEventListener('popstate', invalidate)
    globalThis.addEventListener('hashchange', invalidate)
    return () => {
      operationRef.current += 1
      globalThis.removeEventListener('gitlab-explicit-logout', invalidate)
      globalThis.removeEventListener('gitlab-account-replaced', invalidate)
      globalThis.removeEventListener('gitlab-client-location-change', invalidate)
      globalThis.removeEventListener('popstate', invalidate)
      globalThis.removeEventListener('hashchange', invalidate)
    }
  }, [])
  const open = useCallback(async (url: string) => {
    if (!sessionId || !instanceUrl) return
    const operation = ++operationRef.current
    const isCurrent = () => operationRef.current === operation && currentSessionRef.current === sessionId
    try {
      if (!onInstance(url, instanceUrl)) { await openExternalUrl(url); return }
      let mergeRequest: { path: string; iid: string } | null = null
      try { mergeRequest = parseMergeRequestUrl(url, instanceUrl) } catch { /* Another GitLab page. */ }
      if (!mergeRequest) {
        const page = openPageRef.current ? parseGitLabPageUrl(url, instanceUrl) : null
        if (page) {
          const location = await resolveGitLabPage(sessionId, page, isCurrent)
          if (!isCurrent()) return
          if (location) { openPageRef.current?.(location); return }
        }
        const profile = profileTarget(url, instanceUrl)
        if (profile) {
          const user = profile.kind === 'username'
            ? await queryGitLab({ sessionId, mode: 'network', query: { kind: 'user', username: profile.username } })
            : await queryGitLab({ sessionId, mode: 'network', query: { kind: 'userById', userId: profile.userId } })
          if (!isCurrent()) return
          if (user?.data) { openUserRef.current(user.data); return }
        }
        if (isCurrent()) await openGitLabUrl(sessionId, url)
        return
      }
      const project = await queryGitLab({ sessionId, mode: 'network', query: { kind: 'project', path: mergeRequest.path } })
      if (!isCurrent()) return
      if (!project?.data.id) throw new Error('プロジェクトを取得できませんでした。')
      openMergeRequestRef.current({ projectId: project.data.id, iid: mergeRequest.iid })
    } catch (caught) {
      if (isCurrent()) notify({ message: `リンクを開けませんでした: ${normalizeGitLabError(caught).message}`, severity: 'error' })
    }
  }, [instanceUrl, notify, sessionId])
  const openLink = useCallback((url: string) => { void open(url) }, [open])
  return isTauri() && sessionId ? openLink : undefined
}
