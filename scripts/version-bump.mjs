import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

import { readProjectVersions } from './release-guard.mjs'

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Returns the next version for `patch` / `minor` / `major`, or validates an explicit x.y.z. */
export function nextVersion(current, kind) {
  if (RELEASE.test(kind)) return kind
  const match = RELEASE.exec(current)
  if (!match) throw new Error(`Cannot bump ${current}; only x.y.z versions are bumped`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Version kind must be patch, minor, major or x.y.z (received ${kind})`)
}

function replaceOnce(path, pattern, replacement) {
  const contents = readFileSync(path, 'utf8')
  if (!pattern.test(contents)) throw new Error(`Could not find the version in ${path}`)
  writeFileSync(path, contents.replace(pattern, replacement), 'utf8')
}

/** Writes one version to every file that carries the application version, keeping their formatting. */
export function writeProjectVersion(root, version) {
  const current = readProjectVersions(root).package
  replaceOnce(resolve(root, 'package.json'), /("version":\s*")[^"]+(")/, `$1${version}$2`)
  // The lockfile repeats the version at the top and in the root package entry.
  replaceOnce(resolve(root, 'package-lock.json'), /^(\{\s*"name":\s*"gitlab-desktop",\s*"version":\s*")[^"]+(")/, `$1${version}$2`)
  replaceOnce(resolve(root, 'package-lock.json'), /("packages":\s*\{\s*"":\s*\{\s*"name":\s*"gitlab-desktop",\s*"version":\s*")[^"]+(")/, `$1${version}$2`)
  replaceOnce(resolve(root, 'src-tauri', 'tauri.conf.json'), /("version":\s*")[^"]+(")/, `$1${version}$2`)
  replaceOnce(resolve(root, 'src-tauri', 'Cargo.toml'), /(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`)
  replaceOnce(resolve(root, 'src-tauri', 'Cargo.lock'), /(\[\[package\]\]\r?\nname = "gitlab-desktop"\r?\nversion = ")[^"]+(")/, `$1${version}$2`)
  const written = readProjectVersions(root)
  if (written.package !== version) throw new Error(`Version update failed: ${JSON.stringify(written)}`)
  return { from: current, to: version }
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const kind = process.argv[2]
  if (!kind) throw new Error('Usage: npm run version:bump -- <patch|minor|major|x.y.z>')
  const { from, to } = writeProjectVersion(root, nextVersion(readProjectVersions(root).package, kind))
  console.log(`Version ${from} -> ${to}`)
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
