import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { isOutsideApplication } from './release-main.mjs'

const RELEASE_COMMIT = /^Release v\d+\.\d+\.\d+/u

/**
 * The changes a release ships, one commit subject per line. Commit subjects in this project already
 * describe the change for its users, so they are the notes. Version commits and commits that only
 * touch files the installer does not contain (documentation, tests, CI) are left out.
 */
export function formatReleaseNotes(commits) {
  return commits
    .filter(({ subject, paths }) => !RELEASE_COMMIT.test(subject) && !isOutsideApplication(paths))
    .map(({ subject }) => `- ${subject.trim()}`)
    .join('\n')
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The newest release tag before HEAD; HEAD^ so a rerun of a tagged release still finds the one before it. */
function previousReleaseTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD^']).trim()
  } catch {
    return null
  }
}

/** The commits since the previous release, oldest first, with the files each one changed. */
export function commitsSincePreviousRelease() {
  const tag = previousReleaseTag()
  const log = git(['log', '--no-merges', '--reverse', '--format=%x1e%s', '--name-only', tag ? `${tag}..HEAD` : 'HEAD'])
  return log.split('\x1e').filter((entry) => entry.trim()).map((entry) => {
    const [subject, ...paths] = entry.split('\n')
    return { subject, paths: paths.map((path) => path.trim()).filter(Boolean) }
  })
}

/** Writes the notes to `VITE_RELEASE_NOTES` for the later steps: the app build embeds them and `latest.json` carries them. */
function main() {
  const notes = formatReleaseNotes(commitsSincePreviousRelease())
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `VITE_RELEASE_NOTES<<RELEASE_NOTES_END\n${notes}\nRELEASE_NOTES_END\n`, 'utf8')
  }
  console.log(notes || '(no user-visible changes)')
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
