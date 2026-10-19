import { invoke } from '@tauri-apps/api/core'

import { GitLabCommandError, type Diff } from '../types/gitlab'
import { isTauri, normalizeGitLabError } from './gitlab'

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
  if (!isTauri()) throw new GitLabCommandError({ code: 'UNSUPPORTED', message: 'ブラウザプレビューではローカルリポジトリを読めません。デスクトップ版で利用してください。' })
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
  return call('pick_local_repository_folder', {})
}

export function getLocalChanges(sessionId: string, projectId: string, headSha: string): Promise<LocalChanges> {
  return call('get_local_changes', { headSha, projectId, sessionId })
}
