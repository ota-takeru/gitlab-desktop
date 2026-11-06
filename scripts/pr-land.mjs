import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { rebuildBaselines } from './ui-rebaseline.mjs'

const PASSED = new Set(['pass', 'skipping'])
const VISUAL_CHECK = 'Screenshot comparison and accessibility'
const COMPARE_STEP = 'Compare the catalog and client screens with their baselines'

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

/**
 * Whether the only thing stopping a merge is the screenshot comparison, so that rebuilding the baselines can clear it.
 * Accessibility and every other step of that job, and every other check, still stop the merge.
 */
export function onlyBaselinesDiffer(pullRequest, checks, startHead, failedSteps) {
  const failing = checks.filter((check) => !PASSED.has(check.bucket))
  return failing.length === 1 && failing[0].name === VISUAL_CHECK && failing[0].bucket === 'fail'
    && failedSteps.length === 1 && failedSteps[0] === COMPARE_STEP
    && landingBlockers(pullRequest, checks.filter((check) => PASSED.has(check.bucket)), startHead).length === 0
}

/** `npm run pr:land 12 --dry-run` gives the flag to npm, which passes it on only in the environment; missing it would merge. */
export function isDryRun(args, env) {
  return args.includes('--dry-run') || env.npm_config_dry_run === 'true'
}

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function readPullRequest(number) {
  return JSON.parse(gh('pr', 'view', number, '--json', 'state,isDraft,headRefName,headRefOid,mergeable,title,url'))
}

function readChecks(number) {
  // Exits non-zero while a check is failing or pending; the JSON is printed either way.
  const result = spawnSync('gh', ['pr', 'checks', number, '--json', 'name,bucket,link'], { encoding: 'utf8' })
  try {
    return JSON.parse(result.stdout)
  } catch {
    return []
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** The steps that failed in the visual job, read from the run its check links to. */
function failedVisualSteps(checks) {
  const runId = checks.find((check) => check.name === VISUAL_CHECK)?.link?.match(/\/runs\/(\d+)/u)?.[1]
  if (!runId) return []
  const { jobs } = JSON.parse(gh('run', 'view', runId, '--json', 'jobs'))
  return jobs.find((job) => job.name === VISUAL_CHECK)?.steps.filter((step) => step.conclusion === 'failure').map((step) => step.name) ?? []
}

function waitForChecks(number) {
  // Checks take a moment to appear after a push, and `--watch` fails while there are none.
  for (let attempt = 0; attempt < 24 && !readChecks(number).length; attempt += 1) sleep(5_000)
  spawnSync('gh', ['pr', 'checks', number, '--watch', '--interval', '20'], { stdio: 'inherit' })
}

/** Rebuilds the baselines of the checked-out pull request branch, pushes them and lists them on the pull request. */
function pushRebuiltBaselines(number, pullRequest) {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  if (branch !== pullRequest.headRefName) throw new Error(`Only the screenshot comparison failed. Check out ${pullRequest.headRefName} and run this again to rebuild the baselines.`)
  console.log('Only the screenshot comparison failed. Rebuilding the baselines on CI.')
  const changed = rebuildBaselines()
  if (!changed.length) throw new Error('The screenshot comparison failed, but rebuilding changed no baseline. Not merged.')
  execFileSync('git', ['push', 'origin', branch], { stdio: 'inherit' })
  gh('pr', 'comment', number, '--body', `\`pr:land\` rebuilt these baselines without anyone looking at them. Check them if the change was not meant to move these screens:\n\n${changed.map((name) => `- \`tests/visual/screenshots/${name}\``).join('\n')}`)
  console.log(`Pushed ${changed.length} rebuilt baseline(s) and listed them on the pull request.`)
}

/** Waits for a pull request's checks, then merges it with a merge commit only if every one passed on the same head. A failed screenshot comparison alone is cleared once by rebuilding the baselines. */
function main() {
  const args = process.argv.slice(2)
  const dryRun = isDryRun(args, process.env)
  const number = args.find((arg) => /^\d+$/u.test(arg))
  if (!number) throw new Error('Usage: npm run pr:land <pull request number> [--dry-run]')
  if (dryRun) console.log('Dry run: nothing will be merged.')

  let start = readPullRequest(number)
  console.log(`Waiting for the checks of #${number}: ${start.title}`)
  waitForChecks(number)

  const checks = readChecks(number)
  if (onlyBaselinesDiffer(readPullRequest(number), checks, start.headRefOid, failedVisualSteps(checks))) {
    if (dryRun) {
      console.log(`Only the screenshot comparison of #${number} failed, so it would rebuild the baselines and go on. Nothing was changed (--dry-run).`)
      return
    }
    pushRebuiltBaselines(number, start)
    start = readPullRequest(number)
    waitForChecks(number)
  }

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
