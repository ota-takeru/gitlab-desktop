import { deepEqual, strictEqual, throws } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createReleaseConfig, UPDATER_ENDPOINT } from './release-config.mjs'
import { readProjectVersions, validateReleaseTag } from './release-guard.mjs'
import { decideRelease, isDocumentationOnly } from './release-main.mjs'
import { nextVersion, writeProjectVersion } from './version-bump.mjs'

test('project versions stay in lockstep', () => {
  const versions = readProjectVersions()
  validateReleaseTag(`v${versions.package}`, versions.package)
  strictEqual(versions.package, versions.cargo)
  strictEqual(versions.package, versions.tauri)
})

test('release tags must match the application version', () => {
  validateReleaseTag('v0.1.0', '0.1.0')
  throws(() => validateReleaseTag('0.1.1', '0.1.0'), /must use v<version>/)
  throws(() => validateReleaseTag('v0.2.0', '0.1.0'), /does not match project version/)
})

test('generated updater configuration is fixed to the public repository', () => {
  const config = createReleaseConfig('A'.repeat(43))
  deepEqual(config.bundle, {
    active: true,
    createUpdaterArtifacts: true,
    targets: ['nsis'],
  })
  deepEqual(config.plugins.updater, {
    endpoints: [UPDATER_ENDPOINT],
    pubkey: 'A'.repeat(43),
  })
  strictEqual(UPDATER_ENDPOINT, 'https://github.com/ota-takeru/gitlab-desktop/releases/latest/download/latest.json')
})

const mainPush = {
  changedPaths: ['src/App.tsx'],
  event: 'push',
  previousVersion: '0.4.0',
  refName: 'main',
  refType: 'branch',
  tag: 'main',
  tagExists: () => false,
  version: '0.4.0',
}

test('a main push without a version change releases the next patch version', () => {
  deepEqual(decideRelease(mainPush), { autoBump: true, releaseTag: 'v0.4.1', shouldRelease: true })
  throws(() => decideRelease({ ...mainPush, tagExists: (tag) => tag === 'v0.4.1' }), /already exists/)
})

test('a version bumped before the push is released as is', () => {
  deepEqual(decideRelease({ ...mainPush, version: '0.5.0' }), { autoBump: false, releaseTag: 'v0.5.0', shouldRelease: true })
  strictEqual(decideRelease({ ...mainPush, tagExists: () => true, version: '0.5.0' }).shouldRelease, false)
})

test('documentation-only pushes and other branches are not released', () => {
  strictEqual(decideRelease({ ...mainPush, changedPaths: ['README.md', 'docs/distribution.md'] }).shouldRelease, false)
  strictEqual(decideRelease({ ...mainPush, changedPaths: ['docs/a.md', 'src/App.tsx'] }).autoBump, true)
  strictEqual(decideRelease({ ...mainPush, refName: 'feature' }).shouldRelease, false)
  strictEqual(isDocumentationOnly([]), false)
})

test('tag pushes and manual runs publish the existing tag', () => {
  deepEqual(decideRelease({ ...mainPush, refType: 'tag', tag: 'v0.4.0' }), { autoBump: false, releaseTag: 'v0.4.0', shouldRelease: true })
  throws(() => decideRelease({ ...mainPush, event: 'workflow_dispatch', tag: 'v0.3.0' }), /does not match/)
})

test('version kinds follow SemVer', () => {
  strictEqual(nextVersion('0.4.9', 'patch'), '0.4.10')
  strictEqual(nextVersion('0.4.9', 'minor'), '0.5.0')
  strictEqual(nextVersion('0.4.9', 'major'), '1.0.0')
  strictEqual(nextVersion('0.4.9', '0.6.0'), '0.6.0')
  throws(() => nextVersion('0.4.9', 'next'), /must be patch/)
})

test('a version bump updates every version file and keeps them in lockstep', () => {
  const root = mkdtempSync(join(tmpdir(), 'version-bump-'))
  try {
    mkdirSync(join(root, 'src-tauri'))
    for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      copyFileSync(file, join(root, file))
    }
    const current = readProjectVersions(root).package
    const next = nextVersion(current, 'minor')
    deepEqual(writeProjectVersion(root, next), { from: current, to: next })
    strictEqual(readProjectVersions(root).package, next)
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    strictEqual(lock.version, next)
    strictEqual(lock.packages[''].version, next)
    strictEqual(/name = "gitlab-desktop"\r?\nversion = "([^"]+)"/.exec(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'))?.[1], next)
    // Only the version lines change.
    const before = readFileSync('package-lock.json', 'utf8').split('\n')
    const after = readFileSync(join(root, 'package-lock.json'), 'utf8').split('\n')
    strictEqual(before.filter((line, index) => line !== after[index]).length, 2)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
