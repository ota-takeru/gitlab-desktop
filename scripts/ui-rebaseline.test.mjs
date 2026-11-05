import { deepEqual } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { changedBaselines } from './ui-rebaseline.mjs'

test('takes only the rebuilt baselines that are new or differ, ignoring other files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-rebaseline-test-'))
  const rebuilt = join(root, 'rebuilt')
  const committed = join(root, 'committed')
  mkdirSync(rebuilt)
  mkdirSync(committed)
  try {
    writeFileSync(join(rebuilt, 'same.png'), 'a')
    writeFileSync(join(committed, 'same.png'), 'a')
    writeFileSync(join(rebuilt, 'moved.png'), 'b')
    writeFileSync(join(committed, 'moved.png'), 'c')
    writeFileSync(join(rebuilt, 'new.png'), 'd')
    writeFileSync(join(committed, 'kept-only-here.png'), 'e')
    writeFileSync(join(rebuilt, 'notes.txt'), 'f')
    deepEqual(changedBaselines(rebuilt, committed), ['moved.png', 'new.png'])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
