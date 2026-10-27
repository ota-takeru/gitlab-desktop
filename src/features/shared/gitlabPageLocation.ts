import { queryGitLab } from '../../lib/gitlab'
import type { GitLabPage } from '../../lib/gitlabPageUrl'
import type { TreeEntry } from '../../types/gitlab'

/** The app screen for a GitLab project page. */
export interface GitLabPageLocation {
  route: 'overview' | 'branches' | 'mrs' | 'code'
  params: Record<string, string>
}

// A ref with this many `/`-separated parts is not tried further.
const MAX_REF_PARTS = 6
// A file is looked for in at most this many pages of its folder.
const MAX_FOLDER_PAGES = 5

async function folderEntries(sessionId: string, projectId: string, ref: string, path: string, page: number) {
  try {
    return await queryGitLab({ sessionId, mode: 'network', query: { kind: 'tree', page, path, projectId, ref } })
  } catch {
    return null
  }
}

async function findFile(sessionId: string, projectId: string, ref: string, filePath: string): Promise<TreeEntry | null> {
  const slash = filePath.lastIndexOf('/')
  const folder = slash === -1 ? '' : filePath.slice(0, slash)
  for (let page = 1; page <= MAX_FOLDER_PAGES; page += 1) {
    const result = await folderEntries(sessionId, projectId, ref, folder, page)
    if (!result) return null
    const entry = result.data.find((item) => item.type === 'blob' && item.path === filePath)
    if (entry) return entry
    if (!result.nextPage) return null
  }
  return null
}

/**
 * Finds the screen for a project page. A folder or file URL does not mark where
 * its ref ends, so the shortest ref whose folder (or file) exists is taken, as GitLab does.
 * Null when the project or the folder or file cannot be read.
 */
export async function resolveGitLabPage(sessionId: string, page: GitLabPage, isCurrent: () => boolean): Promise<GitLabPageLocation | null> {
  // A group or subgroup URL looks like a project URL; it is not found as a project and opens in the browser.
  const project = await queryGitLab({ sessionId, mode: 'network', query: { kind: 'project', path: page.path } }).catch(() => null)
  if (!isCurrent() || !project?.data.id) return null
  const base = { projectId: project.data.id, projectName: project.data.name, projectUrl: project.data.webUrl }
  if (page.kind === 'project') return { route: 'overview', params: base }
  if (page.kind === 'branches') return { route: 'branches', params: base }
  if (page.kind === 'mrs') return { route: 'mrs', params: { ...base, state: 'opened' } }
  if (page.kind !== 'tree' && page.kind !== 'blob') return null
  const { kind, rest } = page
  for (let split = 1; split <= Math.min(rest.length - (kind === 'blob' ? 1 : 0), MAX_REF_PARTS); split += 1) {
    const ref = rest.slice(0, split).join('/')
    const path = rest.slice(split).join('/')
    if (kind === 'tree') {
      const folder = await folderEntries(sessionId, base.projectId, ref, path, 1)
      if (!isCurrent()) return null
      if (folder) return { route: 'code', params: { ...base, ref, ...(path ? { path } : {}) } }
      continue
    }
    const file = await findFile(sessionId, base.projectId, ref, path)
    if (!isCurrent()) return null
    if (file) {
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      return { route: 'code', params: { ...base, ref, ...(folder ? { path: folder } : {}), blob: file.id, file: path } }
    }
  }
  return null
}
