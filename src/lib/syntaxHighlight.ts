import type { ElementContent, Root, RootContent } from 'hast'
import apache from 'highlight.js/lib/languages/apache'
import awk from 'highlight.js/lib/languages/awk'
import clojure from 'highlight.js/lib/languages/clojure'
import cmake from 'highlight.js/lib/languages/cmake'
import coffeescript from 'highlight.js/lib/languages/coffeescript'
import dart from 'highlight.js/lib/languages/dart'
import delphi from 'highlight.js/lib/languages/delphi'
import django from 'highlight.js/lib/languages/django'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import dos from 'highlight.js/lib/languages/dos'
import elixir from 'highlight.js/lib/languages/elixir'
import elm from 'highlight.js/lib/languages/elm'
import erb from 'highlight.js/lib/languages/erb'
import erlang from 'highlight.js/lib/languages/erlang'
import fortran from 'highlight.js/lib/languages/fortran'
import fsharp from 'highlight.js/lib/languages/fsharp'
import gherkin from 'highlight.js/lib/languages/gherkin'
import gradle from 'highlight.js/lib/languages/gradle'
import groovy from 'highlight.js/lib/languages/groovy'
import haml from 'highlight.js/lib/languages/haml'
import handlebars from 'highlight.js/lib/languages/handlebars'
import haskell from 'highlight.js/lib/languages/haskell'
import julia from 'highlight.js/lib/languages/julia'
import latex from 'highlight.js/lib/languages/latex'
import lisp from 'highlight.js/lib/languages/lisp'
import nginx from 'highlight.js/lib/languages/nginx'
import nix from 'highlight.js/lib/languages/nix'
import ocaml from 'highlight.js/lib/languages/ocaml'
import pgsql from 'highlight.js/lib/languages/pgsql'
import powershell from 'highlight.js/lib/languages/powershell'
import properties from 'highlight.js/lib/languages/properties'
import protobuf from 'highlight.js/lib/languages/protobuf'
import scala from 'highlight.js/lib/languages/scala'
import scheme from 'highlight.js/lib/languages/scheme'
import stylus from 'highlight.js/lib/languages/stylus'
import tcl from 'highlight.js/lib/languages/tcl'
import twig from 'highlight.js/lib/languages/twig'
import vbscript from 'highlight.js/lib/languages/vbscript'
import vim from 'highlight.js/lib/languages/vim'
import x86asm from 'highlight.js/lib/languages/x86asm'
import { common, createLowlight } from 'lowlight'

// Common languages plus ones seen in build, CI, Windows and config files.
// Importing them one by one keeps the other ~150 grammars out of the bundle.
const lowlight = createLowlight({
  ...common,
  apache, awk, clojure, cmake, coffeescript, dart, delphi, django, dockerfile, dos, elixir, elm, erb, erlang, fortran, fsharp, gherkin,
  gradle, groovy, haml, handlebars, haskell, julia, latex, lisp, nginx, nix, ocaml, pgsql, powershell, properties, protobuf, scala,
  scheme, stylus, tcl, twig, vbscript, vim, x86asm,
})

/** Text with the highlight.js classes that apply to it, if any. */
export interface SyntaxToken {
  className?: string
  text: string
}

/** Above this size a page is shown without highlighting so scrolling stays responsive. */
const MAX_HIGHLIGHT_CHARACTERS = 200_000

/** Extensions that highlight.js does not register as aliases. */
const EXTRA_LANGUAGES: Record<string, string> = {
  asm: 'x86asm',
  bash_profile: 'bash',
  bashrc: 'bash',
  containerfile: 'dockerfile',
  dockerfile: 'dockerfile',
  editorconfig: 'ini',
  gitconfig: 'ini',
  groovy: 'groovy',
  gvy: 'groovy',
  j2: 'django',
  jenkinsfile: 'groovy',
  jl: 'julia',
  lsp: 'lisp',
  npmrc: 'ini',
  psd1: 'powershell',
  psm1: 'powershell',
  sc: 'scala',
  styl: 'stylus',
  vimrc: 'vim',
  zshrc: 'bash',
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

/** File names without a telling extension. */
const FILE_NAME_LANGUAGES: Record<string, string> = {
  'cmakelists.txt': 'cmake',
  containerfile: 'dockerfile',
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  gnumakefile: 'makefile',
  jenkinsfile: 'groovy',
  makefile: 'makefile',
  podfile: 'ruby',
  rakefile: 'ruby',
  vagrantfile: 'ruby',
}

/** Names also used with a suffix, such as `Jenkinsfile.release` or `Dockerfile.dev`. */
const VARIANT_FILE_NAMES = new Set(['containerfile', 'dockerfile', 'jenkinsfile'])

/** The highlight.js language for a file path, or null when none is known. */
export function languageForPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (FILE_NAME_LANGUAGES[name]) return FILE_NAME_LANGUAGES[name]
  const stem = name.split('.')[0]
  if (VARIANT_FILE_NAMES.has(stem)) return FILE_NAME_LANGUAGES[stem]
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
