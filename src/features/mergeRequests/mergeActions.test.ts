import { describe, expect, it } from 'vitest'

import type { MergeRequest } from '../../types/gitlab'
import { canRebase, mergeReadiness, titleWithDraft } from './mergeActions'

const base: MergeRequest = {
  author: { id: '1', name: 'Author', username: 'author' },
  canMerge: true,
  description: '',
  detailedMergeStatus: 'mergeable',
  diffRefs: null,
  headSha: 'a'.repeat(40),
  id: '10',
  iid: '3',
  projectId: '7',
  sourceBranch: 'feature',
  state: 'opened',
  targetBranch: 'main',
  title: 'Add search',
  updatedAt: '2026-10-01T00:00:00Z',
  webUrl: 'https://gitlab.example/group/app/-/merge_requests/3',
}

describe('mergeReadiness', () => {
  it('allows a merge only when GitLab says the MR is mergeable and the user may merge', () => {
    expect(mergeReadiness(base)).toMatchObject({ canAutoMerge: false, canMerge: true, summary: 'マージできます', tone: 'success' })
    expect(mergeReadiness({ ...base, canMerge: false })).toMatchObject({ canMerge: false, summary: 'このMRをマージする権限がありません' })
    expect(mergeReadiness({ ...base, canMerge: null })).toMatchObject({ canMerge: false, summary: 'マージ権限を確認できません' })
  })

  it('names what blocks the merge in Japanese', () => {
    expect(mergeReadiness({ ...base, detailedMergeStatus: 'discussions_not_resolved' })).toMatchObject({ canMerge: false, summary: '未解決のスレッドがあります', tone: 'warning' })
    expect(mergeReadiness({ ...base, detailedMergeStatus: 'conflict' }).summary).toBe('コンフリクトがあります')
    expect(mergeReadiness({ ...base, detailedMergeStatus: 'not_approved' }).summary).toBe('承認が足りません')
    expect(mergeReadiness({ ...base, detailedMergeStatus: 'draft_status' }).summary).toBe('Draftのためマージできません')
    expect(mergeReadiness({ ...base, detailedMergeStatus: 'checking' }).tone).toBe('info')
  })

  it('never guesses when GitLab did not say or said something unknown', () => {
    expect(mergeReadiness({ ...base, detailedMergeStatus: undefined, mergeStatus: 'can_be_merged' })).toMatchObject({ canAutoMerge: false, canMerge: false })
    const unknown = mergeReadiness({ ...base, detailedMergeStatus: 'future_check' })
    expect(unknown).toMatchObject({ canAutoMerge: false, canMerge: false })
    expect(unknown.summary).toContain('future_check')
  })

  it('offers auto-merge only while a pipeline runs and nothing else blocks', () => {
    const running = { ...base, pipeline: { status: 'running', webUrl: '' } }
    expect(mergeReadiness({ ...running, detailedMergeStatus: 'ci_still_running' })).toMatchObject({ canAutoMerge: true, canMerge: false, tone: 'info' })
    expect(mergeReadiness(running)).toMatchObject({ canAutoMerge: true, canMerge: true })
    expect(mergeReadiness({ ...running, detailedMergeStatus: 'discussions_not_resolved' }).canAutoMerge).toBe(false)
    expect(mergeReadiness({ ...base, detailedMergeStatus: 'ci_must_pass', pipeline: { status: 'failed', webUrl: '' } }).canAutoMerge).toBe(false)
    expect(mergeReadiness({ ...running, autoMerge: true })).toMatchObject({ canAutoMerge: false, canMerge: false, summary: 'パイプライン成功時に自動でマージされます' })
  })

  it('does not offer a merge for closed or merged MRs or during a rebase', () => {
    expect(mergeReadiness({ ...base, state: 'merged' }).canMerge).toBe(false)
    expect(mergeReadiness({ ...base, rebaseInProgress: true })).toMatchObject({ canMerge: false, summary: 'リベース中です' })
  })
})

describe('canRebase', () => {
  it('offers a rebase when GitLab asks for one or the branch is behind', () => {
    expect(canRebase(base)).toBe(false)
    expect(canRebase({ ...base, detailedMergeStatus: 'need_rebase' })).toBe(true)
    expect(canRebase({ ...base, divergedCommitsCount: 3 })).toBe(true)
    expect(canRebase({ ...base, divergedCommitsCount: 3, rebaseInProgress: true })).toBe(false)
    expect(canRebase({ ...base, divergedCommitsCount: 3, state: 'closed' })).toBe(false)
  })
})

describe('titleWithDraft', () => {
  it('adds or removes the Draft prefixes GitLab reads', () => {
    expect(titleWithDraft('Add search', true)).toBe('Draft: Add search')
    expect(titleWithDraft('Draft: Add search', false)).toBe('Add search')
    expect(titleWithDraft('[Draft] (draft) DRAFT: Add search', false)).toBe('Add search')
    expect(titleWithDraft('[draft] Add search', true)).toBe('Draft: Add search')
    expect(titleWithDraft('Drafting rules', false)).toBe('Drafting rules')
  })
})
