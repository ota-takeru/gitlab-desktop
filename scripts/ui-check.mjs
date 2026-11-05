import { spawnSync } from 'node:child_process'

// The screenshot comparison CI runs, against the committed baselines, for a local run before a push.
// One retry absorbs a busy machine missing a timed wait; a changed image fails both tries.
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/visual/catalog.visual.ts', 'tests/visual/user.visual.ts', '--retries=1', ...process.argv.slice(2)], {
  env: { ...process.env, UI_SNAP_BASELINES: 'committed' },
  stdio: 'inherit',
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
