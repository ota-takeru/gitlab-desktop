import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const sourceRoot = join(projectRoot, 'src')
const colorPattern = /#[0-9a-f]{3,8}\b|\brgba?\s*\(/giu
const networkPattern = /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/gu
const violations = []

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      visit(path)
      continue
    }
    if (!/\.(?:ts|tsx|css)$/.test(entry)) continue

    const source = readFileSync(path, 'utf8')
    const relativePath = relative(projectRoot, path)
    if (relativePath !== join('src', 'theme.ts')) {
      for (const match of source.matchAll(colorPattern)) {
        violations.push(`${relativePath}: raw color ${match[0]}`)
      }
    }
    for (const match of source.matchAll(networkPattern)) {
      violations.push(`${relativePath}: direct network access ${match[0]}`)
    }
  }
}

visit(sourceRoot)

if (violations.length > 0) {
  console.error('Design guard failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('Design guard passed: colors stay in src/theme.ts and no direct network calls are present.')
}
