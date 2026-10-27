/**
 * The GitLab page a `gitlab-desktop://open?url=<GitLab URL>` link asks the app to show,
 * when it is an HTTPS page on the connected instance. Anything else is ignored rather
 * than opened in the browser, so a link from elsewhere cannot make the app open other sites.
 */
export function gitLabUrlFromDeepLink(link: string, instanceUrl: string): string | null {
  let parsed: URL
  let target: URL
  let instance: URL
  try {
    parsed = new URL(link)
    if (parsed.protocol !== 'gitlab-desktop:' || parsed.hostname !== 'open') return null
    target = new URL(parsed.searchParams.get('url') ?? '')
    instance = new URL(instanceUrl)
  } catch {
    return null
  }
  const basePath = instance.pathname.replace(/\/+$/u, '')
  if (target.protocol !== 'https:' || target.origin !== instance.origin || target.username || target.password) return null
  if (target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) return null
  return target.href
}
