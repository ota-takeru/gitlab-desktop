import { deepEqual } from 'node:assert'
import { test } from 'node:test'

import { landingBlockers } from './pr-land.mjs'

const open = { headRefOid: 'a', isDraft: false, mergeable: 'MERGEABLE', state: 'OPEN' }
const passed = [{ bucket: 'pass', name: 'Frontend' }, { bucket: 'skipping', name: 'Optional' }]

test('lets a pull request merge only when every check passed on the head the wait started from', () => {
  deepEqual(landingBlockers(open, passed, 'a'), [])
})

test('names everything that stops a merge', () => {
  deepEqual(landingBlockers(open, [{ bucket: 'fail', name: 'Screenshots' }, { bucket: 'pending', name: 'Rust' }, { bucket: 'cancel', name: 'Windows' }], 'a'), ['Screenshots: fail', 'Rust: pending', 'Windows: cancel'])
  deepEqual(landingBlockers(open, passed, 'b'), ['new commits arrived while waiting'])
  deepEqual(landingBlockers(open, [], 'a'), ['it has no checks'])
  deepEqual(landingBlockers({ ...open, isDraft: true }, passed, 'a'), ['it is a draft'])
  deepEqual(landingBlockers({ ...open, mergeable: 'CONFLICTING' }, passed, 'a'), ['GitHub reports it as CONFLICTING'])
  deepEqual(landingBlockers({ ...open, state: 'MERGED' }, passed, 'a'), ['it is MERGED'])
})
