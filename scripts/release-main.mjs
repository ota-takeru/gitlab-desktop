import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { readProjectVersions, validateReleaseTag } from './release-guard.mjs'
import { nextVersion } from './version-bump.mjs'

const NO_RELEASE = Object.freeze({ autoBump: false, releaseTag: '', shouldRelease: false })

/** Changes that never alter the application, so they are not released. */
export function isDocumentationOnly(paths) {
  return paths.length > 0 && paths.every((path) => path.startsWith('docs/') || /\.md$/i.test(path))
}

/**
 * Decides what a workflow run publishes.
 * - A tag push or a manual run publishes that existing tag.
 * - A main push whose version changed publishes the new version.
 * - A main push without a version change bumps the patch version, unless it only changes documentation.
 */
export function decideRelease({ event, refName, refType, tag, version, previousVersion, changedPaths, tagExists }) {
  if (event === 'workflow_dispatch' || (event === 'push' && refType === 'tag')) {
    const releaseTag = tag || `v${version}`
    validateReleaseTag(releaseTag, version)
    return { autoBump: false, releaseTag, shouldRelease: true }
  }

  if (event !== 'push' || refName !== 'main') return { ...NO_RELEASE, reason: 'Only pushes to main are released.' }

  if (previousVersion !== version) {
    const releaseTag = `v${version}`
    validateReleaseTag(releaseTag, version)
    if (tagExists(releaseTag)) return { ...NO_RELEASE, reason: `Release tag ${releaseTag} already exists; versions are immutable.` }
    return { autoBump: false, releaseTag, shouldRelease: true }
  }

  if (isDocumentationOnly(changedPaths)) return { ...NO_RELEASE, reason: 'Only documentation changed; no release will be published.' }

  const releaseTag = `v${nextVersion(version, 'patch')}`
  if (tagExists(releaseTag)) throw new Error(`Release tag ${releaseTag} already exists; bump the version manually before pushing.`)
  return { autoBump: true, releaseTag, shouldRelease: true }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The push's base commit, or the parent commit when GitHub reports none (a new branch). */
function pushBase() {
  const before = process.env.PUSH_BEFORE?.trim()
  return before && !/^0+$/.test(before) ? before : 'HEAD^'
}

function versionAt(commit) {
  try {
    const packageJson = JSON.parse(git(['show', `${commit}:package.json`]))
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
}

function changedPathsSince(commit) {
  try {
    return git(['diff', '--name-only', commit, 'HEAD']).split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    // An unknown base (force push or shallow history) must not hide a code change.
    return ['<unknown>']
  }
}

function output(name, value) {
  const line = `${name}=${value}\n`
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, line, 'utf8')
  }
  console.log(line.trimEnd())
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? 'local'
  const base = pushBase()
  const decision = decideRelease({
    changedPaths: changedPathsSince(base),
    event,
    previousVersion: versionAt(base),
    refName: process.env.GITHUB_REF_NAME,
    refType: process.env.GITHUB_REF_TYPE,
    tag: process.env.RELEASE_TAG?.trim() || (event === 'push' ? process.env.GITHUB_REF_NAME?.trim() : ''),
    tagExists: (tag) => Boolean(git(['tag', '--list', tag]).trim()),
    version: readProjectVersions().package,
  })
  output('release_tag', decision.releaseTag)
  output('release_version', decision.releaseTag.replace(/^v/, ''))
  output('should_release', String(decision.shouldRelease))
  output('auto_bump', String(decision.autoBump))
  if (decision.reason) console.log(decision.reason)
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
