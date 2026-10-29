import { translate } from '../i18n/i18n'

/** An MR on the connected GitLab; `page` is its changes, commits or pipelines page, and `noteId` the comment its `#note_<id>` names. */
export interface MergeRequestUrl {
  path: string
  iid: string
  page?: 'diffs' | 'commits' | 'pipelines'
  noteId?: string
}

export function parseMergeRequestUrl(input: string, instanceUrl: string): MergeRequestUrl {
  let rawPath: string
  try { rawPath = decodeURIComponent(input.trim().replace(/^https:\/\/[^/?#]+/iu, '').split(/[?#]/u)[0]) } catch { throw new Error(translate('mrList.url.format')) }
  if (rawPath.split('/').some((part) => part === '.' || part === '..')) throw new Error(translate('mrList.url.project'))
  let url: URL
  let instance: URL
  try { url = new URL(input.trim()); instance = new URL(instanceUrl) } catch { throw new Error(translate('mrList.url.notUrl')) }
  if (url.protocol !== 'https:' || url.origin !== instance.origin || url.username || url.password) throw new Error(translate('mrList.url.notHttps'))
  const basePath = instance.pathname.replace(/\/+$/u, '')
  if (!url.pathname.startsWith(`${basePath}/`)) throw new Error(translate('mrList.url.otherInstance'))
  const match = url.pathname.slice(basePath.length + 1).match(/^(.+)\/-\/merge_requests\/([1-9]\d*)(?:\/(diffs|commits|pipelines))?\/?$/u)
  if (!match) throw new Error(translate('mrList.url.format'))
  let path: string
  try { path = decodeURIComponent(match[1]) } catch { throw new Error(translate('mrList.url.format')) }
  if (path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\?#]/u.test(path) || Array.from(path).some((char) => char.charCodeAt(0) < 32)) throw new Error(translate('mrList.url.project'))
  const page = match[3] as MergeRequestUrl['page']
  const noteId = /^#note_([1-9]\d*)$/u.exec(url.hash)?.[1]
  return { path, iid: match[2], ...(page ? { page } : {}), ...(noteId ? { noteId } : {}) }
}
