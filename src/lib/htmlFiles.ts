/** HTML files the read-only file viewers can show rendered. */
export function isHtmlFilePath(path: string | null | undefined): boolean {
  return Boolean(path && /\.html?$/iu.test(path))
}
