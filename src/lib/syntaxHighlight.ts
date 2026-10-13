import type { ElementContent, Root, RootContent } from 'hast'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

/** Text with the highlight.js classes that apply to it, if any. */
export interface SyntaxToken {
  className?: string
  text: string
}

/** Above this size a page is shown without highlighting so scrolling stays responsive. */
const MAX_HIGHLIGHT_CHARACTERS = 200_000

/** Extensions that highlight.js does not register as aliases. */
const EXTRA_LANGUAGES: Record<string, string> = {
  cshtml: 'xml',
  htm: 'xml',
  props: 'xml',
  razor: 'xml',
  svelte: 'xml',
  targets: 'xml',
  vue: 'xml',
  xaml: 'xml',
  csproj: 'xml',
  vbproj: 'xml',
  config: 'xml',
  resx: 'xml',
}

/** The highlight.js language for a file path, or null when none is known. */
export function languageForPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name === 'makefile') return 'makefile'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const extension = name.slice(dot + 1)
  for (const candidate of [extension, EXTRA_LANGUAGES[extension]]) {
    if (candidate && lowlight.registered(candidate)) return candidate
  }
  return null
}

/**
 * Highlights consecutive lines of one file together, so strings and comments
 * spanning lines are coloured correctly, and returns the tokens of each line.
 */
export function highlightLines(lines: readonly string[], language: string | null): SyntaxToken[][] {
  const plain = () => lines.map((text) => [{ text }])
  if (!language || lines.reduce((total, line) => total + line.length + 1, 0) > MAX_HIGHLIGHT_CHARACTERS) return plain()
  let tree: Root
  try {
    tree = lowlight.highlight(language, lines.join('\n'))
  } catch {
    return plain()
  }
  const result: SyntaxToken[][] = [[]]
  // Text takes the classes of its innermost scope: a keyword inside a meta
  // line is a keyword, an interpolation inside a string is not a string.
  const visit = (nodes: (RootContent | ElementContent)[], className: string | undefined) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        node.value.split('\n').forEach((text, index) => {
          if (index > 0) result.push([])
          if (text) result[result.length - 1].push(className ? { className, text } : { text })
        })
      } else if (node.type === 'element') {
        const classes = node.properties.className
        visit(node.children, Array.isArray(classes) && classes.length ? classes.join(' ') : className)
      }
    }
  }
  visit(tree.children, undefined)
  // Keep one entry per input line even if the output ended early.
  while (result.length < lines.length) result.push([])
  return result.slice(0, lines.length)
}
