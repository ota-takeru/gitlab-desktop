import { deepEqual, strictEqual, throws } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createReleaseConfig, UPDATER_ENDPOINT } from './release-config.mjs'
import { readProjectVersions, validateReleaseTag } from './release-guard.mjs'
import { decideRelease, isDocumentationOnly, isOutsideApplication } from './release-main.mjs'
import { createUpdaterManifest, writeReleaseAssets } from './updater-manifest.mjs'
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

test('pushes that change only tests, baselines, CI or test settings are not released', () => {
  const unchangedApp = ['tests/visual/a11y.visual.ts', 'tests/visual/screenshots/sidebar-dark-960x640.png', 'src/features/App.test.tsx', 'src/test/setup.ts', 'src-tauri/src/native/tests.rs', '.github/workflows/ci.yml', '.github/dependabot.yml', 'vitest.config.ts', 'playwright.config.ts', 'scripts/release-config.test.mjs']
  strictEqual(decideRelease({ ...mainPush, changedPaths: unchangedApp }).shouldRelease, false)
  for (const shipped of ['src/features/App.tsx', 'src-tauri/src/native.rs', 'package.json', 'package-lock.json', 'src-tauri/Cargo.lock', 'vite.config.ts', 'scripts/release-main.mjs', 'src-tauri/tauri.conf.json']) {
    strictEqual(decideRelease({ ...mainPush, changedPaths: [...unchangedApp, shipped] }).autoBump, true, shipped)
  }
  strictEqual(isOutsideApplication([]), false)
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

test('the updater manifest points both Windows keys at the uploaded installer', () => {
  const manifest = createUpdaterManifest({ version: '0.7.0', assetName: 'GitLab.Desktop_0.7.0_x64-setup.exe', signature: 'c2lnbmF0dXJl\n', pubDate: '2026-10-13T08:55:37.051Z' })
  const platform = { signature: 'c2lnbmF0dXJl', url: 'https://github.com/ota-takeru/gitlab-desktop/releases/download/v0.7.0/GitLab.Desktop_0.7.0_x64-setup.exe' }
  deepEqual(manifest, {
    version: '0.7.0',
    notes: '署名済み Windows NSIS インストーラーと自動更新メタデータです。',
    pub_date: '2026-10-13T08:55:37.051Z',
    platforms: { 'windows-x86_64': platform, 'windows-x86_64-nsis': platform },
  })
  throws(() => createUpdaterManifest({ version: '0.7.0', assetName: 'a.exe', signature: ' ', pubDate: '' }), /signature is empty/)
})

test('release assets use the names GitHub gives uploaded files', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-assets-'))
  try {
    const installer = join(root, 'GitLab Desktop_0.7.0_x64-setup.exe')
    writeFileSync(installer, 'installer')
    writeFileSync(`${installer}.sig`, 'c2lnbmF0dXJl')
    const output = join(root, 'out')
    strictEqual(writeReleaseAssets(installer, output, '0.7.0', 'now'), 'GitLab.Desktop_0.7.0_x64-setup.exe')
    deepEqual(readdirSync(output).sort(), ['GitLab.Desktop_0.7.0_x64-setup.exe', 'GitLab.Desktop_0.7.0_x64-setup.exe.sig', 'latest.json'])
    const manifest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'))
    strictEqual(manifest.platforms['windows-x86_64'].url.endsWith('/v0.7.0/GitLab.Desktop_0.7.0_x64-setup.exe'), true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
