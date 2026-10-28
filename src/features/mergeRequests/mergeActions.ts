import { currentLocale, translate, type MessageKey } from '../../i18n/i18n'
import type { MergeRequest } from '../../types/gitlab'

/** GitLab's `detailed_merge_status` values, in the words the merge controls show. */
const mergeStatusLabels: Record<string, MessageKey> = {
  approvals_syncing: 'mergeRequest.mergeStatus.approvalsSyncing',
  checking: 'mergeRequest.mergeStatus.checking',
  ci_must_pass: 'mergeRequest.mergeStatus.ciMustPass',
  ci_still_running: 'mergeRequest.mergeStatus.ciStillRunning',
  commits_status: 'mergeRequest.mergeStatus.commitsStatus',
  conflict: 'mergeRequest.mergeStatus.conflict',
  discussions_not_resolved: 'mergeRequest.mergeStatus.discussionsNotResolved',
  draft_status: 'mergeRequest.mergeStatus.draftStatus',
  jira_association_missing: 'mergeRequest.mergeStatus.jiraAssociationMissing',
  locked_lfs_files: 'mergeRequest.mergeStatus.lockedLfsFiles',
  locked_paths: 'mergeRequest.mergeStatus.lockedPaths',
  merge_request_blocked: 'mergeRequest.mergeStatus.mergeRequestBlocked',
  merge_time: 'mergeRequest.mergeStatus.mergeTime',
  mergeable: 'mergeRequest.mergeStatus.mergeable',
  need_rebase: 'mergeRequest.mergeStatus.needRebase',
  not_approved: 'mergeRequest.mergeStatus.notApproved',
  not_open: 'mergeRequest.mergeStatus.notOpen',
  preparing: 'mergeRequest.mergeStatus.preparing',
  requested_changes: 'mergeRequest.mergeStatus.requestedChanges',
  security_policy_pipeline_check: 'mergeRequest.mergeStatus.securityPolicyPipelineCheck',
  security_policy_violations: 'mergeRequest.mergeStatus.securityPolicyViolations',
  status_checks_must_pass: 'mergeRequest.mergeStatus.statusChecksMustPass',
  title_regex: 'mergeRequest.mergeStatus.titleRegex',
  unchecked: 'mergeRequest.mergeStatus.unchecked',
}

/** Statuses GitLab is still working out; reloading later gives the answer. */
const transientStatuses = new Set(['approvals_syncing', 'checking', 'preparing', 'unchecked'])
/** Statuses where only the pipeline stands between the MR and a merge. */
const pipelineStatuses = new Set(['mergeable', 'ci_must_pass', 'ci_still_running'])
const activePipelineStatuses = new Set(['created', 'pending', 'preparing', 'running', 'scheduled', 'waiting_for_resource'])

export interface MergeReadiness {
  /** GitLab says it can merge now. */
  canMerge: boolean
  /** A pipeline is running and nothing else blocks, so it can merge when it succeeds. */
  canAutoMerge: boolean
  /** What GitLab says, or why the client cannot tell. */
  summary: string
  tone: 'success' | 'warning' | 'info'
}

/**
 * Whether the merge controls may offer a merge. Only GitLab's own
 * `detailed_merge_status` allows it; anything the client cannot read is shown
 * as unknown rather than guessed from other fields.
 */
export function mergeReadiness(mergeRequest: MergeRequest): MergeReadiness {
  const blocked = (summary: string, tone: MergeReadiness['tone'] = 'warning'): MergeReadiness => ({ canAutoMerge: false, canMerge: false, summary, tone })
  if (mergeRequest.state !== 'opened') return blocked(translate('mergeRequest.mergeStatus.notOpen'), 'info')
  if (mergeRequest.autoMerge) return blocked(translate('mergeRequest.readiness.autoMergeSet'), 'info')
  if (mergeRequest.rebaseInProgress) return blocked(translate('mergeRequest.readiness.rebasing'), 'info')
  if (mergeRequest.canMerge === false) return blocked(translate('mergeRequest.readiness.noPermission'), 'info')
  const status = mergeRequest.detailedMergeStatus
  if (!status) return blocked(translate('mergeRequest.readiness.statusUnavailable'))
  const label = mergeStatusLabels[status]
  const summary = label ? translate(label) : translate('mergeRequest.readiness.statusUnknown', { status })
  if (mergeRequest.canMerge !== true) return blocked(mergeRequest.canMerge == null ? translate('mergeRequest.readiness.permissionUnknown') : summary)
  const pipelineActive = activePipelineStatuses.has(mergeRequest.pipeline?.status ?? '')
  const canAutoMerge = pipelineActive && pipelineStatuses.has(status)
  if (status === 'mergeable') return { canAutoMerge, canMerge: true, summary, tone: 'success' }
  return { canAutoMerge, canMerge: false, summary, tone: transientStatuses.has(status) || canAutoMerge ? 'info' : 'warning' }
}

/** A rebase helps when GitLab asks for one or the source branch is behind. */
export function canRebase(mergeRequest: MergeRequest): boolean {
  return mergeRequest.state === 'opened' && !mergeRequest.rebaseInProgress && Boolean(mergeRequest.headSha)
    && (mergeRequest.detailedMergeStatus === 'need_rebase' || (mergeRequest.divergedCommitsCount ?? 0) > 0)
}

// GitLab treats these title prefixes as Draft, in any letter case.
const draftPrefix = /^\s*(?:\[draft\]|\(draft\)|draft:)\s*/iu

/** The title that makes an MR Draft or ready, the way GitLab reads titles. */
export function titleWithDraft(title: string, draft: boolean): string {
  let ready = title
  while (draftPrefix.test(ready)) ready = ready.replace(draftPrefix, '')
  return draft ? `Draft: ${ready}` : ready
}

/** People's names as one list in the current language, such as 「A、B」. */
export function formatNames(names: string[]): string {
  return new Intl.ListFormat(currentLocale(), { type: 'conjunction' }).format(names)
}
