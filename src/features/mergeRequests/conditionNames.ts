import type { MessageKey } from '../../i18n/i18n'
import type { MergeRequestState } from '../../types/gitlab'

/** The conditions added from 「＋条件を追加」, each shown as one tag once applied. */
export type ConditionKind = 'state' | 'reviewer' | 'assignee' | 'author' | 'labels' | 'sourceBranch' | 'targetBranch' | 'updated' | 'project' | 'group'

/** In the order 「＋条件を追加」 lists them. */
export const CONDITION_KINDS: readonly ConditionKind[] = ['state', 'reviewer', 'assignee', 'author', 'labels', 'sourceBranch', 'targetBranch', 'updated', 'project', 'group']

export const CONDITION_NAMES: Record<ConditionKind, MessageKey> = {
  assignee: 'mrList.condition.assignee',
  author: 'mrList.condition.author',
  group: 'mrList.condition.group',
  labels: 'mrList.condition.labels',
  project: 'mrList.condition.project',
  reviewer: 'mrList.condition.reviewer',
  sourceBranch: 'mrList.condition.sourceBranch',
  state: 'mrList.condition.state',
  targetBranch: 'mrList.condition.targetBranch',
  updated: 'mrList.condition.updated',
}

export const STATE_NAMES: Record<MergeRequestState, MessageKey> = { all: 'mrList.state.all', closed: 'mrList.state.closed', merged: 'mrList.state.merged', opened: 'mrList.state.opened' }
