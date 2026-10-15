import type { MergeRequestState } from '../../types/gitlab'

/** The conditions added from 「＋条件を追加」, each shown as one tag once applied. */
export type ConditionKind = 'state' | 'reviewer' | 'assignee' | 'author' | 'labels' | 'sourceBranch' | 'targetBranch' | 'updated' | 'project' | 'group'

/** In the order 「＋条件を追加」 lists them. */
export const CONDITION_KINDS: readonly ConditionKind[] = ['state', 'reviewer', 'assignee', 'author', 'labels', 'sourceBranch', 'targetBranch', 'updated', 'project', 'group']

export const CONDITION_NAMES: Record<ConditionKind, string> = {
  assignee: '担当者',
  author: '作者',
  group: 'グループ',
  labels: 'ラベル',
  project: 'プロジェクト',
  reviewer: 'レビュアー',
  sourceBranch: 'ソースブランチ',
  state: '状態',
  targetBranch: 'ターゲットブランチ',
  updated: '更新日',
}

export const STATE_NAMES: Record<MergeRequestState, string> = { all: 'すべての状態', closed: 'Closed', merged: 'Merged', opened: 'Open' }
