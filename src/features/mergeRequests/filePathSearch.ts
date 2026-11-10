/**
 * Whether a changed file's path answers what was typed in the file search, ignoring case.
 * Either may hold the other, and a pasted location may also share only its start or end with the path,
 * as long as the shared part lines up with a folder or file name:
 * `DiffViewer.tsx:223` finds `src/mergeRequests/DiffViewer.tsx`, and `…/blob/main/src/features` finds the files under `src/features/`.
 */
export function matchesFilePath(path: string, search: string): boolean {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return true
  const lowerPath = path.toLocaleLowerCase()
  if (lowerPath.includes(query) || query.includes(lowerPath)) return true
  for (let slash = lowerPath.indexOf('/'); slash >= 0; slash = lowerPath.indexOf('/', slash + 1)) {
    // The text starts with the path from a folder or file name to its end, and the name does not run on.
    const tail = lowerPath.slice(slash + 1)
    if (tail && query.startsWith(tail) && !/^[\w.-]/u.test(query.slice(tail.length))) return true
    // The text ends with the path's folders from the top, and starts the first one there.
    const head = lowerPath.slice(0, slash)
    const rest = query.replace(/\/+$/u, '')
    if (head && rest.endsWith(head) && !/[\w.-]$/u.test(rest.slice(0, -head.length))) return true
  }
  return false
}
