import { expect, it } from 'vitest'

import { personalQueueFor } from './personalQueue'

it('recognizes a personal queue only when nothing else narrows it', () => {
  expect(personalQueueFor({ reviewer: 'self', state: 'opened' }, '1')).toBe('waiting')
  expect(personalQueueFor({ assignee: 'self', page: '2', search: 'fix', sort: 'asc', state: 'opened' }, '1')).toBe('assigned')
  expect(personalQueueFor({ authorId: '1', orderBy: 'created_at', state: 'opened' }, '1')).toBe('created')

  expect(personalQueueFor({ assignee: 'self', labels: 'bug', state: 'opened' }, '1')).toBeNull()
  expect(personalQueueFor({ assignee: 'self', reviewer: 'self', state: 'opened' }, '1')).toBeNull()
  expect(personalQueueFor({ projectId: '9', reviewer: 'self' }, '1')).toBeNull()
  expect(personalQueueFor({ authorId: '7', state: 'opened' }, '1')).toBeNull()
  expect(personalQueueFor({ state: 'opened' }, '1')).toBeNull()
})
