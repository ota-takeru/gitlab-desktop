import { clearGitLabMutationStates } from '../shared/useGitLabMutation'
import { clearComposerBufferStore } from './useComposerBuffer'

/**
 * Where each MR's comment list was scrolled, so returning to it keeps the place, with the
 * height the sticky header had then: it shrinks once the page is scrolled, and the same
 * scrollTop under a taller header would show the list lower.
 */
export const commentScrollPositions = new Map<string, { header: number; top: number }>()

/** Clear in-memory composer text when a workspace/session is disposed. */
export function clearComposerBuffers(): void {
  commentScrollPositions.clear()
  clearComposerBufferStore()
  clearGitLabMutationStates()
}
