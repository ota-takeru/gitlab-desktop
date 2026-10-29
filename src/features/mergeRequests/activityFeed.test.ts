import { describe, expect, it } from 'vitest'

import type { GitLabTodo, MergeRequest, Note } from '../../types/gitlab'
import { mergeRequestActivity, todoNoteId } from './activityFeed'

const mergeRequest: MergeRequest = {
  id: 'mr-3',
  iid: '3',
  projectId: '7',
  title: 'Add login',
  description: '',
  state: 'opened',
  webUrl: 'https://gitlab.example/group/app/-/merge_requests/3',
  author: { id: '42', name: 'Reviewer', username: 'reviewer' },
  sourceBranch: 'feature',
  targetBranch: 'main',
  updatedAt: '2026-10-20T12:00:00Z',
  headSha: null,
  diffRefs: null,
  projectPath: 'group/app',
}

function note(id: string, body: string, overrides: Partial<Note> = {}): Note {
  return {
    author: { id: '9', name: 'Other', username: 'other' },
    body,
    createdAt: `2026-10-20T${id.padStart(2, '0')}:00:00Z`,
    id,
    position: null,
    resolvable: false,
    resolved: false,
    system: false,
    ...overrides,
  }
}

describe('mergeRequestActivity', () => {
  it('turns comments and the system notes the emails tell about into events, newest first', () => {
    const items = mergeRequestActivity(mergeRequest, [
      note('1', 'added 3 commits\n\n<ul><li>abc - Fix</li></ul>', { system: true }),
      note('2', 'approved this merge request', { system: true }),
      note('3', 'Looks good'),
      note('4', 'added label ~bug', { system: true }),
      note('5', 'merged', { system: true }),
      note('6', 'My own comment', { author: { id: '42', name: 'Reviewer', username: 'reviewer' } }),
    ], '42')

    expect(items.map((item) => [item.id, item.kind])).toEqual([['5', 'merged'], ['3', 'comment'], ['2', 'approved'], ['1', 'pushed']])
    expect(items.find((item) => item.kind === 'pushed')?.commits).toBe(3)
    expect(items[0]).toMatchObject({ iid: '3', projectId: '7', projectLabel: 'group/app', title: 'Add login' })
  })

  it('keeps the file and line of a diff comment', () => {
    const position = { baseSha: 'a', headSha: 'c', newLine: 12, newPath: 'src/app.ts', oldPath: 'src/app.ts', positionType: 'text' as const, startSha: 'b' }
    const [item] = mergeRequestActivity(mergeRequest, [note('1', 'Rename this', { position })], '42')

    expect(item).toMatchObject({ kind: 'comment', line: 12, path: 'src/app.ts' })
  })

  it('reads state changes and revoked approvals', () => {
    const items = mergeRequestActivity(mergeRequest, [
      note('1', 'closed', { system: true }),
      note('2', 'reopened', { system: true }),
      note('3', 'unapproved this merge request', { system: true }),
      note('4', 'revoked approval', { system: true }),
    ], '42')

    expect(items.map((item) => item.kind)).toEqual(['unapproved', 'unapproved', 'reopened', 'closed'])
  })
})

describe('todoNoteId', () => {
  it('finds the comment a mention To-Do links to', () => {
    const todo = { webUrl: 'https://gitlab.example/group/app/-/merge_requests/3#note_88' } as GitLabTodo

    expect(todoNoteId(todo)).toBe('88')
    expect(todoNoteId({ ...todo, webUrl: mergeRequest.webUrl })).toBeNull()
  })
})
