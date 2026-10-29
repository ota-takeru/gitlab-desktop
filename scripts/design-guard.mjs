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
// Spacing follows the 4px grid: multiples of 0.5 in sx, with 0.25 allowed as a 2px optical nudge inside a row.
const spacingPattern = /(?:\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|rowGap|columnGap)\s*:\s*-?|\bspacing=\{)(\d+\.\d+)\b/gu
// Between stacked rows a 2px margin starts every row after it off the grid; an icon may still be nudged.
const rowNudgePattern = /\b(?:m|my|mt|mb|rowGap)\s*:\s*-?0\.25\b|\bspacing=\{0\.25\}/gu
// Line boxes and row heights stay on the 4px grid, so text, chips and buttons in one row share pixel edges.
// A line height is gridLine(n), px on the grid, or 1 for a lone glyph; a ratio such as 1.45 makes a 17.4px
// line, and sx drops a theme key such as 'caption.lineHeight' as an invalid value. Heights from 16px up are
// multiples of 4; smaller ones are marks (dots, bars, icons) centred in a grid-sized box.
const lineHeightPattern = /\blineHeight\s*:\s*(?:(\d+(?:\.\d+)?)\b|(['"`])(\d+(?:\.\d+)?)px\2|(['"`])normal\4|(['"`])[\w$.{}]+\.lineHeight\5)/gu
const heightPattern = /\b(?:height|minHeight|maxHeight)\s*:\s*(?:(\d+(?:\.\d+)?)\b|(['"`])(\d+(?:\.\d+)?)px\2)/gu
// A border adds its width to the box, so the rows after it start off the grid; hairline(), frame() and
// panelFrame() draw over the edge instead. A box taken out of the flow (absolute, fixed, a pseudo-element)
// may keep a border, and a line marked `grid-exempt` (Markdown table cells) is left alone.
const borderPattern = /\bborder(?:Top|Bottom|Left|Right)?(?:Width)?\s*:\s*(?:[1-9]|[\w.]+\s*\?\s*[1-9]|(['"`])[1-9][^'"`]*\1|`[1-9])/gu

/** The text of the innermost { … } around an index, and the key it is the value of. */
function enclosingObject(source, index) {
  let start = index
  for (let depth = 0; start > 0; start -= 1) {
    const char = source[start - 1]
    if (char === '}') depth += 1
    else if (char === '{') {
      if (depth === 0) break
      depth -= 1
    }
  }
  let end = index
  for (let depth = 0; end < source.length; end += 1) {
    const char = source[end]
    if (char === '{') depth += 1
    else if (char === '}') {
      if (depth === 0) break
      depth -= 1
    }
  }
  return { key: source.slice(Math.max(0, start - 80), start - 1), text: source.slice(start, end) }
}

const exempted = (source, index) => {
  const lineStart = source.lastIndexOf('\n', index - 1)
  const previousLine = lineStart < 0 ? '' : source.slice(source.lastIndexOf('\n', lineStart - 1) + 1, lineStart)
  return /grid-exempt/u.test(previousLine) || /grid-exempt/u.test(source.slice(lineStart, source.indexOf('\n', index)))
}
// Development-only screens, loaded only in development builds; MockMarkdown is also used by the client.
const typographyExempt = (path) => /\.test\.tsx?$/u.test(path) || path.startsWith(join('src', 'pages')) || (path.startsWith(join('src', 'components', 'mock')) && !path.endsWith('MockMarkdown.tsx'))
// Interface text lives in src/i18n/messages; Japanese left in code is text that skipped translation.
// Development screens and fixtures stay Japanese. Comments are removed first; strings are matched
// alongside them so a // inside a string does not start a comment.
const textExempt = (path) => typographyExempt(path) || path.startsWith(join('src', 'mock')) || path.startsWith(join('src', 'components', 'mock')) || path.startsWith(join('src', 'i18n'))
const commentOrStringPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/gu
const japanesePattern = /[\u3000-\u30ff\u3400-\u9fff\uff01-\uff60]+/gu
const withoutComments = (source) => source.replace(commentOrStringPattern, (token) => token.startsWith('//') || token.startsWith('/*') ? token.replace(/[^\n]/gu, ' ') : token)
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
        for (const match of source.matchAll(lineHeightPattern)) {
          if (match[1] === '1' || (match[3] !== undefined && Number(match[3]) % 4 === 0)) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: line height ${match[0]}; use gridLine(n) from the theme or px in 4px steps`)
        }
        for (const match of source.matchAll(borderPattern)) {
          const { key, text } = enclosingObject(source, match.index)
          if (/position\s*:\s*'(?:absolute|fixed)'/u.test(text) || /::(?:after|before)['"`]?\s*\]?\s*:\s*(?:[\w.]+\s*\?\s*)?$/u.test(key) || exempted(source, match.index)) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: border ${match[0]}; it adds to the box and moves the rows after it off the grid, so use hairline(), frame() or panelFrame() from components/hairline`)
        }
        for (const match of source.matchAll(rowNudgePattern)) {
          const tag = source.slice(source.lastIndexOf('<', match.index), source.indexOf('>', match.index))
          if (/^<\w+Icon\b/u.test(tag) || (match[0].startsWith('spacing') && /direction=(?:"row"|\{\{[^}]*'row')/u.test(tag))) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: ${match[0]} between stacked rows; use 0 or multiples of 0.5 so the rows after it stay on the 4px grid`)
        }
        for (const match of source.matchAll(heightPattern)) {
          const value = Number(match[1] ?? match[3])
          if (value < 16 || value % 4 === 0) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: height ${match[0]}; use multiples of 4px`)
        }
        for (const match of source.matchAll(spacingPattern)) {
          const value = Number(match[1])
          if (Number.isInteger(value * 2) || value === 0.25) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: spacing ${match[0]}; use multiples of 0.5 (4px)`)
        }
      }
    }
    if (/\.tsx?$/u.test(entry) && !textExempt(relativePath)) {
      const code = withoutComments(source)
      for (const match of code.matchAll(japanesePattern)) {
        violations.push(`${relativePath}:${lineOf(code, match.index)}: untranslated text ${match[0]}; add it to src/i18n/messages and use t() or translate()`)
      }
    }
    for (const match of source.matchAll(networkPattern)) {
      violations.push(`${relativePath}: direct network access ${match[0]}`)
    }
  }
}

visit(sourceRoot)

// Tauri hashes inline <style>/<script> of index.html into the CSP; a hash disables 'unsafe-inline',
// which blocks every style Emotion injects and leaves the app unstyled.
const indexHtml = readFileSync(join(projectRoot, 'index.html'), 'utf8')
for (const match of indexHtml.matchAll(/<style\b|<script\b(?![^>]*\bsrc=)/giu)) {
  violations.push(`index.html:${lineOf(indexHtml, match.index)}: inline ${match[0]}; load it from a file instead`)
}

if (violations.length > 0) {
  console.error('Design guard failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('Design guard passed: colors and type sizes stay in src/theme.ts, line boxes and rows stay on the 4px grid, interface text is in the message files, and no direct network calls are present.')
}
