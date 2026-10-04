import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

import { validateRelease } from './release-guard.mjs'

export const RELEASE_REPOSITORY = Object.freeze({ owner: 'ota-takeru', name: 'gitlab-desktop' })
export const UPDATER_ENDPOINT = `https://github.com/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.name}/releases/latest/download/latest.json`

function publicKeyFromEnvironment() {
  const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim()
  if (!publicKey) {
    throw new Error('TAURI_UPDATER_PUBKEY is required to generate the release updater configuration')
  }
  if (/\s/.test(publicKey) || !/^[A-Za-z0-9+/=_-]{32,}$/.test(publicKey)) {
    throw new Error('TAURI_UPDATER_PUBKEY must be a single base64-like public key value')
  }
  return publicKey
}

export function createReleaseConfig(publicKey) {
  if (typeof publicKey !== 'string' || !publicKey.trim()) {
    throw new Error('A non-empty updater public key is required')
  }

  return {
    bundle: {
      active: true,
      createUpdaterArtifacts: true,
      targets: ['nsis'],
    },
    plugins: {
      updater: {
        endpoints: [UPDATER_ENDPOINT],
        pubkey: publicKey.trim(),
      },
    },
  }
}

export function writeReleaseConfig(outputPath, publicKey) {
  const absolutePath = resolve(outputPath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, `${JSON.stringify(createReleaseConfig(publicKey), null, 2)}\n`, 'utf8')
  return absolutePath
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const outputPath = process.env.TAURI_RELEASE_CONFIG ?? resolve(root, 'src-tauri', 'tauri.release.conf.json')
  const release = validateRelease(root)
  const output = writeReleaseConfig(outputPath, publicKeyFromEnvironment())
  console.log(`Generated ${output} for ${release.tag ?? `v${release.package}`}`)
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
