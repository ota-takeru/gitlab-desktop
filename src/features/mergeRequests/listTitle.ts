import type { MergeRequest } from '../../types/gitlab'

/** The title without GitLab's draft prefix, since list rows already show a Draft chip and the prefix makes titles look alike. */
export function listTitle(mergeRequest: Pick<MergeRequest, 'draft' | 'title'>): string {
  if (!mergeRequest.draft) return mergeRequest.title
  return mergeRequest.title.replace(/^\s*(?:\[draft\]|\(draft\)|draft:)\s*/iu, '') || mergeRequest.title
}
