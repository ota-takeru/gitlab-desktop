import { deepEqual, strictEqual, throws } from 'node:assert'
import { test } from 'node:test'

import { createReleaseConfig, UPDATER_ENDPOINT } from './release-config.mjs'
import { readProjectVersions, validateReleaseTag } from './release-guard.mjs'

test('project versions stay in lockstep', () => {
  const versions = readProjectVersions()
  strictEqual(versions.package, '0.1.0')
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
