import { invoke } from '@tauri-apps/api/core'

import { translate } from '../i18n/i18n'
import { GitLabCommandError, type Diff, type GitLabSnapshot, type MergeRequest } from '../types/gitlab'
import { isTauri, normalizeGitLabError, queryGitLab } from './gitlab'

/** A project's clone on this computer, linked by the user. */
export interface LocalRepository {
  path: string
  projectPath: string
}

/** The linked clone's working tree against the MR head, read by git when asked. */
export interface LocalChanges {
  repositoryPath: string
  comparedSha: string
  /** Null in a repository with no commit yet. */
  localHead: string | null
  /** Null when HEAD is detached. */
  branch: string | null
  /** Whether the local HEAD has the MR head in its history. */
  containsMrHead: boolean
  /** Commits on HEAD that are not in the MR head; null when not counted. */
  aheadCount: number | null
  /** Untracked files found. */
  untrackedCount: number
  /** More untracked files exist than were counted. */
  untrackedMore: boolean
  /** Untracked files shown in `diffs` as new files; the rest are only counted. */
  untrackedIncluded: number
  diffs: Diff[]
  /** The diff was cut at the size limit; later files are missing. */
  truncated: boolean
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new GitLabCommandError({ code: 'UNSUPPORTED', message: translate('common.localRepository.browserUnavailable') })
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}

export function getLocalRepository(sessionId: string, projectId: string): Promise<LocalRepository | null> {
  return call('get_local_repository', { projectId, sessionId })
}

export function linkLocalRepository(sessionId: string, projectId: string, projectPath: string, path: string): Promise<LocalRepository> {
  return call('link_local_repository', { path, projectId, projectPath, sessionId })
}

export function unlinkLocalRepository(sessionId: string, projectId: string): Promise<void> {
  return call('unlink_local_repository', { projectId, sessionId })
}

/** One file of the linked clone's working tree, as it is now. */
export function getLocalFile(sessionId: string, projectId: string, path: string): Promise<{ content: string }> {
  return call('get_local_file', { path, projectId, sessionId })
}

/** The folder chosen in the system folder picker, or null when cancelled. */
export function pickLocalRepositoryFolder(): Promise<string | null> {
  return call('pick_local_repository_folder', { title: translate('common.localRepository.pickFolderTitle') })
}

export function getLocalChanges(sessionId: string, projectId: string, headSha: string): Promise<LocalChanges> {
  return call('get_local_changes', { headSha, projectId, sessionId })
}

/** A short summary of the linked clone against the MR head, read without a diff. */
export interface LocalStatus {
  localHead: string | null
  branch: string | null
  /** Whether the MR head commit has been fetched into the clone. */
  mrHeadPresent: boolean
  containsMrHead: boolean
  aheadCount: number | null
  /** Tracked paths with uncommitted changes. */
  changedCount: number
  untrackedCount: number
  /** More paths exist than were counted. */
  countMore: boolean
}

export function getLocalStatus(sessionId: string, projectId: string, headSha: string): Promise<LocalStatus> {
  return call('get_local_status', { headSha, projectId, sessionId })
}

/** The folders searched for clones of projects that are not linked yet. */
export function getLocalScanFolders(sessionId: string): Promise<string[]> {
  return call('get_local_scan_folders', { sessionId })
}

export function setLocalScanFolders(sessionId: string, folders: string[]): Promise<string[]> {
  return call('set_local_scan_folders', { folders, sessionId })
}

/** The outcome of looking for a project's clone below the scan folders. */
export interface LocalRepositorySearch {
  /** The linked clone, or the one found and linked; null when none is found. */
  repository: LocalRepository | null
  /** The user unlinked the project, so it is linked only when searched for explicitly. */
  declined: boolean
}

/**
 * The linked clone, or else one found below the scan folders and linked. A
 * project the user unlinked is searched for only when `explicit`.
 */
export function findLocalRepository(sessionId: string, projectId: string, projectPath: string, explicit = false): Promise<LocalRepositorySearch> {
  return call('find_local_repository', { explicit, projectId, projectPath, sessionId })
}

/** Pages of the user's open MRs read for their projects, per condition. */
const OWN_MR_PAGES = 3

/** A project of the user's open MRs and what the search found for it. */
export interface OwnProjectSearch {
  projectId: string
  projectPath: string
  result: LocalRepositorySearch | null
  error: string | null
}

/**
 * Looks for the clones of the projects of open MRs the user authored or is
 * assigned to, linking those found, as when each MR is opened.
 */
export async function findOwnLocalRepositories(sessionId: string, userId: string): Promise<OwnProjectSearch[]> {
  const projects = new Map<string, string>()
  for (const own of [{ authorId: userId }, { assigneeId: userId }]) {
    for (let page: number | null = 1; page !== null && page <= OWN_MR_PAGES;) {
      const snapshot: GitLabSnapshot<MergeRequest[]> | null = await queryGitLab({ mode: 'network', query: { kind: 'mrs', page, search: '', state: 'opened', ...own }, sessionId })
      for (const mergeRequest of snapshot?.data ?? []) {
        if (mergeRequest.projectPath && !projects.has(mergeRequest.projectId)) projects.set(mergeRequest.projectId, mergeRequest.projectPath)
      }
      page = snapshot?.nextPage ?? null
    }
  }
  // One project at a time, so the folders are not walked for many projects at once.
  const results: OwnProjectSearch[] = []
  for (const [projectId, projectPath] of projects) {
    try {
      results.push({ error: null, projectId, projectPath, result: await findLocalRepository(sessionId, projectId, projectPath) })
    } catch (error) {
      results.push({ error: normalizeGitLabError(error).message, projectId, projectPath, result: null })
    }
  }
  return results
}

/** What the 「ローカルの変更」 button says about the clone: work not yet pushed, or why it cannot be compared. */
export function summarizeLocalStatus(status: LocalStatus, sourceBranch?: string): { label: string; tone: 'changes' | 'warning' | 'quiet' } {
  if (!status.containsMrHead && status.branch !== sourceBranch) return { label: translate('common.localRepository.otherBranch'), tone: 'quiet' }
  const uncommitted = status.changedCount + status.untrackedCount
  const ahead = status.containsMrHead ? status.aheadCount ?? 0 : 0
  const parts = [
    uncommitted || status.countMore ? translate(status.countMore ? 'common.localRepository.uncommittedMore' : 'common.localRepository.uncommitted', { count: uncommitted }) : null,
    ahead ? translate('common.localRepository.unpushed', { count: ahead }) : null,
    !status.mrHeadPresent ? translate('common.localRepository.notFetched') : !status.containsMrHead ? translate('common.localRepository.pullNeeded') : null,
  ].filter(Boolean)
  if (!parts.length) return { label: translate('common.localRepository.noChanges'), tone: 'quiet' }
  return { label: parts.join(' · '), tone: uncommitted || status.countMore || ahead ? 'changes' : 'warning' }
}
