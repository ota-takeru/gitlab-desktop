import { clearGitLabMutationStates } from '../shared/useGitLabMutation'
import { clearComposerBufferStore } from './useComposerBuffer'

/** Where each MR's comment list was scrolled, so returning to it keeps the place. */
export const commentScrollPositions = new Map<string, number>()

/** Clear in-memory composer text when a workspace/session is disposed. */
export function clearComposerBuffers(): void {
  commentScrollPositions.clear()
  clearComposerBufferStore()
  clearGitLabMutationStates()
}
