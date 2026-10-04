import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { readProjectVersions, validateReleaseTag } from './release-guard.mjs'

function output(name, value) {
  const line = `${name}=${value}\n`
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, line, 'utf8')
  }
  console.log(line.trimEnd())
}

function previousPackageVersion() {
  try {
    const packageJson = JSON.parse(execFileSync('git', ['show', 'HEAD^:package.json'], { encoding: 'utf8' }))
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
}

function tagExists(tag) {
  return Boolean(execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim())
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? 'local'
  const versions = readProjectVersions()
  const currentTag = process.env.RELEASE_TAG?.trim() || (event === 'push' ? process.env.GITHUB_REF_NAME?.trim() : '')

  if (event === 'workflow_dispatch' || (event === 'push' && process.env.GITHUB_REF_TYPE === 'tag')) {
    const tag = currentTag || `v${versions.package}`
    validateReleaseTag(tag, versions.package)
    output('release_tag', tag)
    output('should_release', 'true')
    return
  }

  if (event !== 'push' || process.env.GITHUB_REF_NAME !== 'main') {
    output('release_tag', '')
    output('should_release', 'false')
    return
  }

  const previous = previousPackageVersion()
  if (previous === versions.package) {
    output('release_tag', '')
    output('should_release', 'false')
    console.log(`Version ${versions.package} did not change; no release will be published.`)
    return
  }

  const tag = `v${versions.package}`
  validateReleaseTag(tag, versions.package)
  if (tagExists(tag)) {
    output('release_tag', '')
    output('should_release', 'false')
    console.log(`Release tag ${tag} already exists; versions are immutable.`)
    return
  }

  output('release_tag', tag)
  output('should_release', 'true')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
