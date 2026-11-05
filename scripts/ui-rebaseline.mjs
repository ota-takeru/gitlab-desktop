import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASELINES = 'tests/visual/screenshots'
const WORKFLOW = 'ui-preview.yml'
const ARTIFACT = 'screenshot-baselines'

/** The rebuilt PNGs that are new or differ byte for byte from the committed ones. Rebuilt images that match are left out. */
export function changedBaselines(rebuiltDir, baselineDir) {
  return readdirSync(rebuiltDir).filter((name) => name.endsWith('.png')).filter((name) => {
    const committed = join(baselineDir, name)
    return !existsSync(committed) || !readFileSync(join(rebuiltDir, name)).equals(readFileSync(committed))
  }).sort()
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}

function git(...args) {
  return run('git', args)
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** The run a dispatch on this commit started, which GitHub lists a few seconds after accepting it. */
function findDispatchedRun(branch, sha, startedAt) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', WORKFLOW, '--branch', branch, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,headSha,createdAt']))
    const found = runs.find((entry) => entry.headSha === sha && Date.parse(entry.createdAt) >= startedAt - 60_000)
    if (found) return String(found.databaseId)
    sleep(5_000)
  }
  throw new Error('The rebuild was requested, but its run did not appear on GitHub.')
}

/** Rebuilds the baselines on the CI runner for the pushed branch and commits only those that changed. Nothing is pushed. */
function main() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch === 'main' || branch === 'HEAD') throw new Error('Check out the branch whose baselines should change; main and a detached HEAD are refused.')
  if (git('status', '--porcelain')) throw new Error('Commit or set aside the working tree changes first, so the rebuild matches this checkout.')
  const sha = git('rev-parse', 'HEAD')
  const remote = run('git', ['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s/u)[0]
  if (remote !== sha) throw new Error(`Push ${branch} first: CI rebuilds what is on GitHub, and origin has ${remote || 'no such branch'}.`)

  const startedAt = Date.now()
  execFileSync('gh', ['workflow', 'run', WORKFLOW, '--ref', branch, '-f', 'update_snapshots=true'], { stdio: 'inherit' })
  const runId = findDispatchedRun(branch, sha, startedAt)
  console.log(`Waiting for run ${runId}.`)
  execFileSync('gh', ['run', 'watch', runId, '--exit-status', '--interval', '20'], { stdio: 'inherit' })

  const dir = mkdtempSync(join(tmpdir(), 'ui-rebaseline-'))
  try {
    execFileSync('gh', ['run', 'download', runId, '--name', ARTIFACT, '--dir', dir], { stdio: 'inherit' })
    const changed = changedBaselines(dir, BASELINES)
    if (!changed.length) {
      console.log('No baseline changed.')
      return
    }
    for (const name of changed) copyFileSync(join(dir, name), join(BASELINES, name))
    git('add', ...changed.map((name) => `${BASELINES}/${name}`))
    git('commit', '-m', 'Rebuild the changed screenshots on the CI runner')
    console.log(`Committed ${changed.length} baseline(s). Look at each one before pushing:\n${changed.map((name) => `  ${name}`).join('\n')}`)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
