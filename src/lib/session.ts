import { invoke } from '@tauri-apps/api/core'

import { GitLabCommandError, type GitLabSession } from '../types/gitlab'
import { isTauri, normalizeGitLabError } from './gitlab'

/**
 * Replaces the token of the saved connection without touching the account's
 * cache, unsent input or receipts. Rust uses the saved instance URL, works
 * without an active session, and refuses another user's token before changing
 * anything (INVALID_INPUT). The returned session has a new id.
 */
export async function reauthenticateGitLab(token: string): Promise<GitLabSession> {
  if (!isTauri()) throw new GitLabCommandError({ code: 'UNSUPPORTED', message: 'ブラウザプレビューではGitLab接続を利用できません。デスクトップ版で接続してください。' })
  try {
    return await invoke<GitLabSession>('reauthenticate_gitlab', { token })
  } catch (error) {
    throw normalizeGitLabError(error)
  }
}
