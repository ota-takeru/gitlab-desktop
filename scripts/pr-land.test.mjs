import { deepEqual } from 'node:assert'
import { test } from 'node:test'

import { isDryRun, landingBlockers, onlyBaselinesDiffer } from './pr-land.mjs'

test('takes a dry run from the argument or from npm, which keeps the flag for itself', () => {
  deepEqual(isDryRun(['12', '--dry-run'], {}), true)
  deepEqual(isDryRun(['12'], { npm_config_dry_run: 'true' }), true)
  deepEqual(isDryRun(['12'], {}), false)
})

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

const visual = 'Screenshot comparison and accessibility'
const compare = 'Compare the catalog and client screens with their baselines'
const visualFailed = [...passed, { bucket: 'fail', name: visual }]

test('rebuilds the baselines only when the screenshot comparison is all that failed', () => {
  deepEqual(onlyBaselinesDiffer(open, visualFailed, 'a', [compare]), true)
})

test('keeps every other failure as a stop', () => {
  deepEqual(onlyBaselinesDiffer(open, passed, 'a', []), false)
  deepEqual(onlyBaselinesDiffer(open, visualFailed, 'a', ['Check accessibility of the client screens']), false)
  deepEqual(onlyBaselinesDiffer(open, visualFailed, 'a', ['Check accessibility of the client screens', compare]), false)
  deepEqual(onlyBaselinesDiffer(open, visualFailed, 'a', []), false)
  deepEqual(onlyBaselinesDiffer(open, [...visualFailed, { bucket: 'fail', name: 'Rust' }], 'a', [compare]), false)
  deepEqual(onlyBaselinesDiffer(open, [...passed, { bucket: 'pending', name: visual }], 'a', [compare]), false)
  deepEqual(onlyBaselinesDiffer(open, [{ bucket: 'fail', name: visual }], 'a', [compare]), false)
  deepEqual(onlyBaselinesDiffer(open, visualFailed, 'b', [compare]), false)
  deepEqual(onlyBaselinesDiffer({ ...open, isDraft: true }, visualFailed, 'a', [compare]), false)
  deepEqual(onlyBaselinesDiffer({ ...open, mergeable: 'CONFLICTING' }, visualFailed, 'a', [compare]), false)
})
