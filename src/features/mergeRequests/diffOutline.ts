import type { DiffHunk, DiffLineCounts, ParsedLine, ParsedLineKind } from './diffParser'

/** A place in a file's diff the table of contents can jump to. */
export interface OutlineEntry {
  /** Index of the line in the shown lines, as the rows' `data-line-index`. */
  lineIndex: number
  /** The first new-side line at or after it, as the `data-file-anchor` of rendered Markdown blocks; null if there is none. */
  anchorLine: number | null
  /** The line number shown: new side, or old side for a removed line. */
  line: number
  label: string
  kind: 'hunk' | 'definition'
  lineKind: ParsedLineKind
  /** A definition inside a block of code rather than at the file's top level. */
  nested: boolean
  /** Added and removed lines of a hunk. */
  counts?: DiffLineCounts
}

export interface DiffOutline {
  entries: OutlineEntry[]
  /** Entries left out to keep the list short. */
  omitted: number
}

/** Enough to find a place in a long file; more would be a second copy of the file to scroll through. */
const MAX_ENTRIES = 300

/** A definition does not take more than this; longer lines are data or minified code, and are not run through the patterns. */
const MAX_DEFINITION_COLUMNS = 300

const MAX_LABEL_LENGTH = 100

/** Words that say nothing about which definition it is, and would take most of a narrow list's row. */
const MODIFIERS = /^(?:(?:export|default|declare|public|private|protected|internal|static|async|pub)\s+)+/iu

const MARKDOWN_HEADING = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u

/**
 * Lines that start a definition in common languages. A pattern per language would need a parser
 * to be exact; a missed or extra entry only changes what the list offers, not what the diff shows.
 */
const DEFINITIONS = [
  // function, class and the like, after any modifiers.
  /^\s*(?:(?:export|default|declare|public|private|protected|internal|static|final|abstract|sealed|virtual|override|async|partial|pub(?:\([a-z]+\))?|unsafe|inline|extern)\s+)*(?:(?:function\*?|class|interface|enum|struct|trait|def|fn|module|namespace|type|record)\s+[\w$]|func\s+[\w(]|impl[\s<])/iu,
  // const name = () => ... and const name = function ...
  /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+(?:\s*:[^=]+)?\s*=\s*(?:async\s*)?(?:function\b|\(|[\w$]+\s*=>)/u,
  // A method with an access modifier: public void name(
  /^\s*(?:public|private|protected|internal)\s+(?:[\w<>[\],.? ]+\s+)?[\w$]+\s*\(/u,
  // SQL objects.
  /^\s*(?:create|alter)\s+(?:or\s+(?:alter|replace)\s+)?(?:proc|procedure|function|view|table|trigger|index)\b/iu,
]

function definitionLabel(text: string, markdown: boolean): string | null {
  if (text.length > MAX_DEFINITION_COLUMNS) return null
  if (markdown) return MARKDOWN_HEADING.exec(text)?.[1] ?? null
  return DEFINITIONS.some((pattern) => pattern.test(text)) ? text.trim().replace(MODIFIERS, '').replace(/\s*\{$/u, '') : null
}

function shortLabel(text: string): string {
  const label = text.trim()
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH)}…` : label
}

/**
 * The table of contents of the shown lines: each hunk, named by the function or heading Git found
 * or else by its first change, and the definitions inside it. A long new file is one hunk, so the
 * hunks alone would not help with the files where a table of contents matters most.
 */
export function diffOutline(lines: ParsedLine[], hunks: DiffHunk[], markdown: boolean): DiffOutline {
  const entries: OutlineEntry[] = []
  // Walked from the end, so each line knows the next new-side line in one pass.
  const anchors = new Array<number | null>(lines.length)
  let nextNewLine: number | null = null
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    nextNewLine = lines[index].newLine ?? nextNewLine
    anchors[index] = nextNewLine
  }
  let index = 0
  while (index < lines.length) {
    const hunk = lines[index].hunk
    let end = index
    const counts = { added: 0, removed: 0 }
    let firstChange = -1
    for (; end < lines.length && lines[end].hunk === hunk; end += 1) {
      if (lines[end].kind === 'context') continue
      if (firstChange < 0) firstChange = end
      if (lines[end].kind === 'add') counts.added += 1
      else counts.removed += 1
    }
    const first = lines[index]
    const named = firstChange >= 0 ? lines[firstChange] : first
    const hunkLabel = shortLabel((hunk !== undefined ? hunks[hunk]?.section : undefined) ?? definitionLabel(named.text, markdown) ?? named.text)
    // Rendered Markdown shows the changes, not the unchanged lines at the hunk's start.
    entries.push({ anchorLine: anchors[firstChange >= 0 ? firstChange : index], counts, kind: 'hunk', label: hunkLabel, line: first.newLine ?? first.oldLine ?? 0, lineIndex: index, lineKind: 'context', nested: false })
    for (let at = index; at < end; at += 1) {
      const line = lines[at]
      const definition = definitionLabel(line.text, markdown)
      if (definition === null) continue
      const label = shortLabel(definition)
      if (label === hunkLabel) continue
      entries.push({ anchorLine: anchors[at], kind: 'definition', label, line: line.newLine ?? line.oldLine ?? 0, lineIndex: at, lineKind: line.kind, nested: !markdown && /^\s/u.test(line.text) })
    }
    index = end
  }
  if (entries.length <= MAX_ENTRIES) return { entries, omitted: 0 }
  // Too many: the top level says more about the file than what is nested in it.
  const outer = entries.filter((entry) => !entry.nested)
  // Spread over the whole file, so the list still follows the view to its end.
  const kept = outer.length <= MAX_ENTRIES ? outer : Array.from({ length: MAX_ENTRIES }, (_, at) => outer[Math.floor(at * outer.length / MAX_ENTRIES)])
  return { entries: kept, omitted: entries.length - kept.length }
}

/** The entry for a place in the file: the last one at or before it, in the entries' order. */
export function outlineEntryAt(entries: OutlineEntry[], position: number, key: 'lineIndex' | 'anchorLine'): number {
  let found = -1
  for (let index = 0; index < entries.length; index += 1) {
    const place = entries[index][key]
    if (place === null) continue
    if (place > position) break
    found = index
  }
  return found
}
