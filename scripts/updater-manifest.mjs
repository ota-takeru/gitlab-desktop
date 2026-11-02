import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { RELEASE_REPOSITORY } from './release-config.mjs'
import { readProjectVersions } from './release-guard.mjs'

const ASSETS_NOTE = 'Signed Windows NSIS installer and auto-update metadata.'

/** The GitHub Release text: the changes from `latest.json`, then what the assets are. */
export function releaseBody(notes) {
  return notes?.trim() ? `## Changes\n\n${notes.trim()}\n\n${ASSETS_NOTE}` : ASSETS_NOTE
}

/** GitHub stores uploaded assets with spaces replaced by dots, so the updater URL must use that name. */
export function releaseAssetName(fileName) {
  return fileName.replaceAll(' ', '.')
}

/** The `latest.json` the updater reads from the latest GitHub Release; the app shows its `notes` before updating. */
export function createUpdaterManifest({ version, assetName, signature, pubDate, notes = '' }) {
  if (!signature.trim()) throw new Error('The installer signature is empty')
  const platform = {
    signature: signature.trim(),
    url: `https://github.com/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.name}/releases/download/v${version}/${assetName}`,
  }
  return {
    version,
    notes: notes.trim(),
    pub_date: pubDate,
    platforms: {
      'windows-x86_64': platform,
      'windows-x86_64-nsis': platform,
    },
  }
}

/** Copies the installer and its signature under their release names and writes `latest.json` beside them. */
export function writeReleaseAssets(installerPath, outputDir, version, pubDate = new Date().toISOString(), notes = process.env.VITE_RELEASE_NOTES ?? '') {
  const assetName = releaseAssetName(basename(installerPath))
  const signature = readFileSync(`${installerPath}.sig`, 'utf8')
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(installerPath, join(outputDir, assetName))
  copyFileSync(`${installerPath}.sig`, join(outputDir, `${assetName}.sig`))
  const manifest = createUpdaterManifest({ version, assetName, signature, pubDate, notes })
  writeFileSync(join(outputDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return assetName
}

function main() {
  const [installerPath, outputDir] = process.argv.slice(2)
  if (!installerPath || !outputDir) throw new Error('Usage: node scripts/updater-manifest.mjs <installer.exe> <output-dir>')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const version = readProjectVersions(root).package
  if (!basename(installerPath).includes(`_${version}_`)) throw new Error(`Installer ${basename(installerPath)} is not version ${version}`)
  const assetName = writeReleaseAssets(resolve(installerPath), resolve(outputDir), version)
  console.log(`Prepared ${assetName}, its signature and latest.json for v${version}`)
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
