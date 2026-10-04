import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

function readCargoVersion(path) {
  const contents = readFileSync(path, 'utf8')
  const packageStart = contents.indexOf('[package]')
  const afterPackage = packageStart >= 0 ? contents.slice(packageStart + '[package]'.length) : ''
  const nextSection = afterPackage.search(/\r?\n\[/)
  const packageSection = nextSection >= 0 ? afterPackage.slice(0, nextSection) : afterPackage
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  if (!version) {
    throw new Error(`Could not find [package].version in ${path}`)
  }
  return version
}

export function readProjectVersions(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const packageJson = readJson(resolve(root, 'package.json'))
  const tauriConfig = readJson(resolve(root, 'src-tauri', 'tauri.conf.json'))
  const versions = {
    package: packageJson.version,
    cargo: readCargoVersion(resolve(root, 'src-tauri', 'Cargo.toml')),
    tauri: tauriConfig.version,
  }

  for (const [source, version] of Object.entries(versions)) {
    if (typeof version !== 'string' || !SEMVER.test(version)) {
      throw new Error(`${source} version is missing or is not a supported SemVer value: ${String(version)}`)
    }
  }

  const uniqueVersions = new Set(Object.values(versions))
  if (uniqueVersions.size !== 1) {
    throw new Error(`Project versions do not match: ${JSON.stringify(versions)}`)
  }

  return versions
}

export function validateReleaseTag(tag, version) {
  if (!tag) {
    return
  }
  if (!TAG.test(tag)) {
    throw new Error(`Release tag must use v<version> (received ${tag})`)
  }
  const expected = `v${version}`
  if (tag !== expected) {
    throw new Error(`Release tag ${tag} does not match project version ${version}`)
  }
}

export function assertTagPointsAtHead(tag) {
  try {
    const tags = execFileSync('git', ['tag', '--points-at', 'HEAD', '--list', tag], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (tags !== tag) {
      throw new Error(`Release tag ${tag} does not point at the checked-out commit`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Release tag ')) {
      throw error
    }
    throw new Error(`Could not verify release tag ${tag}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

export function validateRelease(root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), tag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME) {
  const versions = readProjectVersions(root)
  const normalizedTag = tag?.trim() || undefined
  validateReleaseTag(normalizedTag, versions.package)

  if (normalizedTag && process.env.VERIFY_TAG_AT_HEAD === 'true') {
    assertTagPointsAtHead(normalizedTag)
  }

  return { ...versions, tag: normalizedTag ?? null }
}

function main() {
  const result = validateRelease()
  console.log(`Validated ${result.tag ?? 'working tree'} against GitLab Desktop ${result.package}`)
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
