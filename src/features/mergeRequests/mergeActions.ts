import type { MergeRequest } from '../../types/gitlab'

/** GitLab's `detailed_merge_status` values, in the words the merge controls show. */
const mergeStatusLabels: Record<string, string> = {
  approvals_syncing: '承認状態を同期中です',
  checking: 'マージできるか確認中です',
  ci_must_pass: 'パイプラインの成功が必要です',
  ci_still_running: 'パイプラインが実行中です',
  commits_status: 'ソースブランチにコミットが必要です',
  conflict: 'コンフリクトがあります',
  discussions_not_resolved: '未解決のスレッドがあります',
  draft_status: 'Draftのためマージできません',
  jira_association_missing: 'タイトルか説明でJiraの課題を参照する必要があります',
  locked_lfs_files: '他のユーザーがロックしたLFSファイルがあります',
  locked_paths: '他のユーザーがロックしたパスがあります',
  merge_request_blocked: '別のMRにブロックされています',
  merge_time: '指定された時刻まではマージできません',
  mergeable: 'マージできます',
  need_rebase: 'リベースが必要です',
  not_approved: '承認が足りません',
  not_open: 'MRがオープンではありません',
  preparing: '差分を準備中です',
  requested_changes: 'レビュアーが変更を要求しています',
  security_policy_pipeline_check: 'セキュリティポリシーによりパイプラインの成功が必要です',
  security_policy_violations: 'セキュリティポリシーを満たしていません',
  status_checks_must_pass: 'ステータスチェックの成功が必要です',
  title_regex: 'タイトルがプロジェクトの規則に合っていません',
  unchecked: 'マージできるかまだ確認されていません',
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
  if (mergeRequest.state !== 'opened') return blocked('MRがオープンではありません', 'info')
  if (mergeRequest.autoMerge) return blocked('パイプライン成功時に自動でマージされます', 'info')
  if (mergeRequest.rebaseInProgress) return blocked('リベース中です', 'info')
  if (mergeRequest.canMerge === false) return blocked('このMRをマージする権限がありません', 'info')
  const status = mergeRequest.detailedMergeStatus
  if (!status) return blocked('この接続先ではマージできるか判別できません。GitLabで確認してください')
  const summary = mergeStatusLabels[status] ?? `GitLabの判定（${status}）を解釈できません。GitLabで確認してください`
  if (mergeRequest.canMerge !== true) return blocked(mergeRequest.canMerge == null ? 'マージ権限を確認できません' : summary)
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
