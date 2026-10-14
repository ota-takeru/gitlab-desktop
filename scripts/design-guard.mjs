import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const sourceRoot = join(projectRoot, 'src')
const colorPattern = /#[0-9a-f]{3,8}\b|\brgba?\s*\(/giu
const networkPattern = /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/gu
// A text-sized number (under 14; larger numbers size icons) or a px size, or a font name.
// A theme key such as 'fontFamily' or 'code.fontFamily' is allowed; sx does not resolve a
// 'typography.' prefix, so that is reported too.
const typographyPattern = /\bfontSize\s*:\s*(?:(?:\d|1[0-3])(?:\.\d+)?\b|(['"`])\d+(?:\.\d+)?(?:px|r?em)\1)|\bfontFamily\s*:\s*(['"`])(?!(?:[a-z0-9]+\.)?fontFamily\2)[^'"`]*\2|\bfontWeight\s*:\s*[89]00\b|\bletterSpacing\s*:\s*(['"`])-?[\d.]+(?:px|r?em)\3/giu
// Radii are 4 or 8: `borderRadius: 1` or `2` in sx (the theme's shape is 4), or '50%' for circles.
const radiusPattern = /\bborderRadius\s*:\s*(?:(\d+(?:\.\d+)?)\b|(['"`])\d+(?:\.\d+)?px\2)/gu
// Spacing follows the 4px grid: multiples of 0.5 in sx, with 0.25 allowed as a 2px optical nudge.
const spacingPattern = /(?:\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|rowGap|columnGap)\s*:\s*-?|\bspacing=\{)(\d+\.\d+)\b/gu
// Development-only screens, loaded only in development builds; MockMarkdown is also used by the client.
const typographyExempt = (path) => /\.test\.tsx?$/u.test(path) || path.startsWith(join('src', 'pages')) || (path.startsWith(join('src', 'components', 'mock')) && !path.endsWith('MockMarkdown.tsx'))
const violations = []
const lineOf = (source, index) => source.slice(0, index).split('\n').length

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
    // The theme's contrast tests compare literal colours.
    if (relativePath !== join('src', 'theme.ts') && relativePath !== join('src', 'theme.test.ts')) {
      for (const match of source.matchAll(colorPattern)) {
        violations.push(`${relativePath}:${lineOf(source, match.index)}: raw color ${match[0]}`)
      }
      if (!typographyExempt(relativePath)) {
        for (const match of source.matchAll(typographyPattern)) {
          violations.push(`${relativePath}:${lineOf(source, match.index)}: raw ${match[0]}; use a theme typography variant (variant="caption", fontSize: 'body2.fontSize', fontFamily: 'code.fontFamily') or an icon fontSize prop`)
        }
        for (const match of source.matchAll(radiusPattern)) {
          if (match[1] !== undefined && ['0', '1', '2'].includes(match[1])) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: radius ${match[0]}; use borderRadius 1 (4px), 2 (8px) or '50%'`)
        }
        for (const match of source.matchAll(spacingPattern)) {
          const value = Number(match[1])
          if (Number.isInteger(value * 2) || value === 0.25) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: spacing ${match[0]}; use multiples of 0.5 (4px)`)
        }
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
  console.log('Design guard passed: colors and type sizes stay in src/theme.ts and no direct network calls are present.')
}
