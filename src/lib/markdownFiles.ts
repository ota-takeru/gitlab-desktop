/** All read-only Markdown viewers share the same supported extensions. */
export function isMarkdownFilePath(path: string | null | undefined): boolean {
  return Boolean(path && /\.(?:md|markdown|mdown)$/iu.test(path))
}
