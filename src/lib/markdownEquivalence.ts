import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const parser = unified().use(remarkParse).use(remarkGfm)

/**
 * True when both bodies parse to the same Markdown tree, so GitLab renders
 * them the same even if escapes, list markers or table padding differ.
 */
export function isEquivalentMarkdown(left: string, right: string): boolean {
  return JSON.stringify(parser.parse(left), withoutPosition) === JSON.stringify(parser.parse(right), withoutPosition)
}

function withoutPosition(key: string, value: unknown) {
  return key === 'position' ? undefined : value
}
