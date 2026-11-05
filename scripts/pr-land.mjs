import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const PASSED = new Set(['pass', 'skipping'])

/** Why this pull request must not merge now; empty when it may. The head is the one the wait started from. */
export function landingBlockers(pullRequest, checks, startHead) {
  const blockers = []
  if (pullRequest.state !== 'OPEN') blockers.push(`it is ${pullRequest.state}`)
  if (pullRequest.isDraft) blockers.push('it is a draft')
  if (pullRequest.headRefOid !== startHead) blockers.push('new commits arrived while waiting')
  if (pullRequest.mergeable !== 'MERGEABLE') blockers.push(`GitHub reports it as ${pullRequest.mergeable}`)
  if (!checks.length) blockers.push('it has no checks')
  for (const check of checks) {
    if (!PASSED.has(check.bucket)) blockers.push(`${check.name}: ${check.bucket}`)
  }
  return blockers
}

/** `npm run pr:land 12 --dry-run` gives the flag to npm, which passes it on only in the environment; missing it would merge. */
export function isDryRun(args, env) {
  return args.includes('--dry-run') || env.npm_config_dry_run === 'true'
}

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function readPullRequest(number) {
  return JSON.parse(gh('pr', 'view', number, '--json', 'state,isDraft,headRefOid,mergeable,title,url'))
}

function readChecks(number) {
  // Exits non-zero while a check is failing or pending; the JSON is printed either way.
  const result = spawnSync('gh', ['pr', 'checks', number, '--json', 'name,bucket'], { encoding: 'utf8' })
  try {
    return JSON.parse(result.stdout)
  } catch {
    return []
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Waits for a pull request's checks, then merges it with a merge commit only if every one passed on the same head. */
function main() {
  const args = process.argv.slice(2)
  const dryRun = isDryRun(args, process.env)
  const number = args.find((arg) => /^\d+$/u.test(arg))
  if (!number) throw new Error('Usage: npm run pr:land <pull request number> [--dry-run]')
  if (dryRun) console.log('Dry run: nothing will be merged.')

  const start = readPullRequest(number)
  console.log(`Waiting for the checks of #${number}: ${start.title}`)
  // Checks take a moment to appear after a push, and `--watch` fails while there are none.
  for (let attempt = 0; attempt < 24 && !readChecks(number).length; attempt += 1) sleep(5_000)
  spawnSync('gh', ['pr', 'checks', number, '--watch', '--interval', '20'], { stdio: 'inherit' })

  const blockers = landingBlockers(readPullRequest(number), readChecks(number), start.headRefOid)
  if (blockers.length) throw new Error(`Not merged:\n${blockers.map((blocker) => `  ${blocker}`).join('\n')}`)
  if (dryRun) {
    console.log(`#${number} could merge. Nothing was merged (--dry-run).`)
    return
  }
  execFileSync('gh', ['pr', 'merge', number, '--merge', '--match-head-commit', start.headRefOid], { stdio: 'inherit' })
  console.log(`Merged ${start.url}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
