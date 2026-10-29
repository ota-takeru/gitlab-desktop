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
// A 2px margin, gap or padding starts the text or the rows after it off the grid. 2px stays for nudging a
// mark (pt on an icon or avatar wrapper), inside controls that centre their content in a fixed height
// (toggle and list buttons), in a centred row that does not wrap, and in an inline span of running text.
const rowNudgePattern = /\b(?:m|my|mt|mb|p|py|pb|rowGap)\s*:\s*-?0\.25\b|\bspacing=\{0\.25\}/gu
// Lengths written as strings: vertical px off the grid, em or rem (which follow the font size), and calc().
const lengthStringPattern = /\b(padding|margin|paddingTop|paddingBottom|marginTop|marginBottom|paddingBlock|marginBlock|height|minHeight|maxHeight)\s*:\s*(['"`])([^'"`]+)\2/gu
// Line boxes and row heights stay on the 4px grid, so text, chips and buttons in one row share pixel edges.
// A line height is gridLine(n), px on the grid, or 1 for a lone glyph; a ratio such as 1.45 makes a 17.4px
// line, and sx drops a theme key such as 'caption.lineHeight' as an invalid value. Heights from 16px up are
// multiples of 4; smaller ones are marks (dots, bars, icons) centred in a grid-sized box.
const lineHeightPattern = /\blineHeight\s*:\s*(?:(\d+(?:\.\d+)?)\b|(['"`])(\d+(?:\.\d+)?)px\2|(['"`])normal\4|(['"`])[\w$.{}]+\.lineHeight\5)/gu
const heightPattern = /\b(?:height|minHeight|maxHeight)\s*:\s*(?:(\d+(?:\.\d+)?)\b|(['"`])(\d+(?:\.\d+)?)px\2)/gu
// A border adds its width to the box, so the rows after it start off the grid; hairline(), frame() and
// panelFrame() draw over the edge instead. A box taken out of the flow (absolute, fixed, a pseudo-element)
// may keep a border, and a line marked `grid-exempt` with its reason is left alone.
// A frameless control at the start or end of a row is pulled out to the edge line by edgeRow() from
// components/edges, which reads the control's own --edge-inset. A screen writing a negative side margin
// itself drifts from the others; a line marked `edge-exempt` with its reason is left alone.
const sideMarginPattern = /\b(?:m|mx|ml|mr|marginLeft|marginRight|marginInline(?:Start|End)?)\s*:\s*(?:-\d|(['"`])-)/gu
// Icons come in a few sizes: 14 beside caption text and in chips, 16 as a list or row marker, 18 in a control,
// 20 and 24 as MUI's small and medium, 32 large, 40 for an empty state. Numbers from 14 up size icons (and
// emoji glyphs); smaller ones are text, which the typography rule covers.
const iconSizePattern = /\bfontSize\s*:\s*(\d+)\b(?!\.)/gu
// Button sizes and their quiet look are the theme's (size="dense", variant="quiet"); a screen re-sizing a
// button by MUI's size classes makes one that matches nothing beside it.
const buttonSizePattern = /MuiButton-size\w*|MuiIconButton-size\w*/gu
const iconSizes = new Set([14, 16, 18, 20, 24, 32, 40])
// Rows align one way (components/rows): one-line items centre, a mark beside content that wraps sits on its
// first line (alignTop with firstLine(n)), cells that fill the row stretch. Baseline alignment stretches the
// row off the grid, top alignment written by hand skips the first-line rule, and a row that says nothing
// stretches its items to the top by default.
const baselinePattern = /\balignItems\s*:\s*(['"`])baseline\1/gu
const topPattern = /\balignItems\s*:\s*(['"`])(?:flex-)?start\1/gu
const rowStackPattern = /<Stack\b/gu
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
  // Nested objects (a pseudo-element, a hover state) are left out of the text, so their keys do not count.
  let text = source.slice(start, end)
  for (let previous = ''; previous !== text;) {
    previous = text
    text = text.replace(/\{[^{}]*\}/gu, '{}')
  }
  return { key: source.slice(Math.max(0, start - 80), start - 1), text }
}

/** The JSX opening tag around an index, read past the `=>` and braces inside its attributes. */
function enclosingTag(source, index) {
  const start = source.lastIndexOf('<', index)
  let depth = 0
  for (let end = start; end < source.length; end += 1) {
    const char = source[end]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '>' && depth === 0) return source.slice(start, end)
  }
  return source.slice(start)
}

/** Grid rules, shared by the components and the theme's own overrides. */
function gridChecks(source, relativePath) {
  const at = (match) => `${relativePath}:${lineOf(source, match.index)}`
  for (const match of source.matchAll(lineHeightPattern)) {
    if (match[1] === '1' || (match[3] !== undefined && Number(match[3]) % 4 === 0)) continue
    violations.push(`${at(match)}: line height ${match[0]}; use gridLine(n) from the theme or px in 4px steps`)
  }
  for (const match of source.matchAll(borderPattern)) {
    const { key, text } = enclosingObject(source, match.index)
    if (/position\s*:\s*'(?:absolute|fixed)'/u.test(text) || /::(?:after|before)['"`]?\s*\]?\s*:\s*(?:[\w.]+\s*\?\s*)?$/u.test(key) || exempted(source, match.index)) continue
    violations.push(`${at(match)}: border ${match[0]}; it adds to the box and moves the rows after it off the grid, so use hairline(), frame() or panelFrame() from components/hairline`)
  }
  for (const match of source.matchAll(rowNudgePattern)) {
    const tag = enclosingTag(source, match.index)
    const { text } = enclosingObject(source, match.index)
    if (/^<(?:\w+Icon|ToggleButton|ListItemButton|Avatar)\b/u.test(tag)) continue
    if (match[0].startsWith('spacing') && /direction=(?:"row"|\{\{[^}]*'row')/u.test(tag)) continue
    if (/^(?:p|py|pb)\b/u.test(match[0]) && ((/alignItems\s*:\s*'center'/u.test(text) && !/flexWrap\s*:\s*'wrap'/u.test(text)) || /verticalAlign/u.test(text))) continue
    violations.push(`${at(match)}: ${match[0]} moves the text or the rows after it off the grid; use 0 or multiples of 0.5`)
  }
  for (const match of source.matchAll(heightPattern)) {
    const value = Number(match[1] ?? match[3])
    if (value < 16 || value % 4 === 0) continue
    violations.push(`${at(match)}: height ${match[0]}; use multiples of 4px`)
  }
  for (const match of source.matchAll(lengthStringPattern)) {
    const [, property, , value] = match
    const tokens = value.trim().split(/\s+/u)
    const vertical = /^(?:padding|margin)$/u.test(property) ? [tokens[0], tokens[2] ?? tokens[0]] : property.endsWith('Block') ? [tokens[0], tokens[1] ?? tokens[0]] : [tokens[0]]
    // A height may follow the window (calc with vh) or be a mark under 16px, as with the numeric heights.
    const isHeight = /height$/iu.test(property)
    const off = vertical.filter((token) => token !== undefined && (/r?em$/u.test(token) || (!isHeight && /^calc\(/u.test(token)) || (/^-?[\d.]+px$/u.test(token) && Number.parseFloat(token) % 4 !== 0 && !(isHeight && Number.parseFloat(token) < 16))))
    if (off.length && !exempted(source, match.index)) violations.push(`${at(match)}: ${property} '${value}'; vertical lengths are px in 4px steps (or gridLine(n)), not em, rem or calc()`)
  }
}

/** One way to do a thing: edges, row alignment, icon sizes and button sizes come from the shared rules, not from each screen. */
function consistencyChecks(source, relativePath) {
  const at = (match) => `${relativePath}:${lineOf(source, match.index)}`
  if (relativePath !== join('src', 'components', 'edges.ts')) {
    for (const match of source.matchAll(sideMarginPattern)) {
      if (exempted(source, match.index, 'edge-exempt')) continue
      violations.push(`${at(match)}: ${match[0]} pulls a control by hand; give its row edgeRow from components/edges (the control declares --edge-inset)`)
    }
  }
  for (const match of source.matchAll(iconSizePattern)) {
    const value = Number(match[1])
    if (value < 14 || iconSizes.has(value)) continue
    violations.push(`${at(match)}: icon size ${value}; use one of the icon sizes ${[...iconSizes].join(', ')}`)
  }
  for (const match of source.matchAll(baselinePattern)) {
    violations.push(`${at(match)}: baseline alignment; centre the row (alignItems: 'center'), see components/rows`)
  }
  if (relativePath !== join('src', 'components', 'rows.ts')) {
    for (const match of source.matchAll(topPattern)) {
      const tag = enclosingTag(source, match.index)
      const { text } = enclosingObject(source, match.index)
      const column = /flexDirection\s*:\s*'column'/u.test(text) || (/^<Stack\b/u.test(tag) && (!/\bdirection=/u.test(tag) || /direction="column"/u.test(tag)))
      if (column) continue
      violations.push(`${at(match)}: top alignment in a row; use alignTop with firstLine(n) around the mark, from components/rows`)
    }
  }
  for (const match of source.matchAll(rowStackPattern)) {
    const tag = enclosingTag(source, match.index + 1)
    if (!/\bdirection="row"/u.test(tag) || /alignItems|alignTop|firstLine\(/u.test(tag)) continue
    violations.push(`${at(match)}: a row that leaves its vertical alignment unsaid; centre it (alignItems: 'center'), or use alignTop or 'stretch' (components/rows)`)
  }
  for (const match of source.matchAll(buttonSizePattern)) {
    violations.push(`${at(match)}: ${match[0]} re-sizes a button by hand; use size="dense" or variant="quiet" from the theme, or a theme override`)
  }
}

const exempted = (source, index, mark = 'grid-exempt') => {
  const lineStart = source.lastIndexOf('\n', index - 1)
  const previousLine = lineStart < 0 ? '' : source.slice(source.lastIndexOf('\n', lineStart - 1) + 1, lineStart)
  return previousLine.includes(mark) || source.slice(lineStart, source.indexOf('\n', index)).includes(mark)
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
        gridChecks(source, relativePath)
        for (const match of source.matchAll(spacingPattern)) {
          const value = Number(match[1])
          if (Number.isInteger(value * 2) || value === 0.25) continue
          violations.push(`${relativePath}:${lineOf(source, match.index)}: spacing ${match[0]}; use multiples of 0.5 (4px)`)
        }
        consistencyChecks(source, relativePath)
      }
    } else if (relativePath === join('src', 'theme.ts')) {
      // The theme keeps its literal colours and type sizes, but its overrides follow the same grid.
      gridChecks(source, relativePath)
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
  console.log('Design guard passed: colors and type sizes stay in src/theme.ts, line boxes and rows stay on the 4px grid, edges, row alignment, icon sizes and button sizes come from the shared rules, interface text is in the message files, and no direct network calls are present.')
}
