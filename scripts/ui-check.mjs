import { spawnSync } from 'node:child_process'

// Every Playwright check CI runs on the client, against the committed baselines, for a local run before a push:
// a failure in any of them stops CI, and stops a rebuild of the baselines too.
// One retry absorbs a busy machine missing a timed wait; a changed image fails both tries.
const CHECKS = ['a11y', 'grid', 'text-centre', 'preview', 'catalog', 'user'].map((name) => `tests/visual/${name}.visual.ts`)

const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()

const startHead = head()
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...CHECKS, '--retries=1', ...process.argv.slice(2)], {
  env: { ...process.env, UI_SNAP_BASELINES: 'committed' },
  stdio: 'inherit',
})
if (result.error) console.error(result.error.message)
// The dev server shows whatever this checkout holds now, so a pass after another branch came in says nothing about this one.
if (head() !== startHead) {
  console.error(`This checkout moved from ${startHead} to ${head()} during the check, so the result is not about one commit. Run it again, in a worktree of its own if another session uses this folder.`)
  process.exit(1)
}
process.exit(result.status ?? 1)
