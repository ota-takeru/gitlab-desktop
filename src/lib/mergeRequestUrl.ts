import { translate } from '../i18n/i18n'

export function parseMergeRequestUrl(input: string, instanceUrl: string): { path: string; iid: string } {
  let rawPath: string
  try { rawPath = decodeURIComponent(input.trim().replace(/^https:\/\/[^/?#]+/iu, '').split(/[?#]/u)[0]) } catch { throw new Error(translate('mrList.url.format')) }
  if (rawPath.split('/').some((part) => part === '.' || part === '..')) throw new Error(translate('mrList.url.project'))
  let url: URL
  let instance: URL
  try { url = new URL(input.trim()); instance = new URL(instanceUrl) } catch { throw new Error(translate('mrList.url.notUrl')) }
  if (url.protocol !== 'https:' || url.origin !== instance.origin || url.username || url.password) throw new Error(translate('mrList.url.notHttps'))
  const basePath = instance.pathname.replace(/\/+$/u, '')
  if (!url.pathname.startsWith(`${basePath}/`)) throw new Error(translate('mrList.url.otherInstance'))
  const match = url.pathname.slice(basePath.length + 1).match(/^(.+)\/-\/merge_requests\/([1-9]\d*)(?:\/(?:diffs|commits))?\/?$/u)
  if (!match) throw new Error(translate('mrList.url.format'))
  let path: string
  try { path = decodeURIComponent(match[1]) } catch { throw new Error(translate('mrList.url.format')) }
  if (path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\?#]/u.test(path) || Array.from(path).some((char) => char.charCodeAt(0) < 32)) throw new Error(translate('mrList.url.project'))
  return { path, iid: match[2] }
}
