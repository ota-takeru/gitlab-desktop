import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Advisories that may stay while no fixed version exists. Each needs a reason, and is removed once a fix is out.
 * GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS, no patched version yet; it reaches only the dev tools vite and vitest.
 */
export const IGNORED_ADVISORIES = new Set(['GHSA-fc5q-39xc-vjpf'])

const BLOCKING = new Set(['high', 'critical'])

/** The high or critical advisories in `npm audit --json` output that are not ignored, as "package: url". */
export function blockingAdvisories(report, ignored = IGNORED_ADVISORIES) {
  const found = new Set()
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // A string names the package the advisory came through; that package's own entry holds the advisory.
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue
      const id = String(via.url ?? '').split('/').pop()
      if (!ignored.has(id)) found.add(`${name}: ${via.url ?? via.title ?? via.source}`)
    }
  }
  return [...found]
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    console.error(result.stderr || 'npm audit printed no JSON')
    process.exit(1)
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`)
    process.exit(1)
  }
  const blocking = blockingAdvisories(report)
  if (blocking.length) {
    console.error(`High or critical npm advisories:\n${blocking.map((line) => `  ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`No high or critical npm advisories other than the ignored ${[...IGNORED_ADVISORIES].join(', ')}.`)
}
