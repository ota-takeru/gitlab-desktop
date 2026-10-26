/** Choose the preferred root README without fetching every project file. */
import type { TreeEntry } from '../../types/gitlab'

export function chooseReadmeFile(entries: readonly TreeEntry[]): TreeEntry | undefined {
  const files = entries.filter((entry) => entry.type === 'blob' && /^readme(?:\.(?:md|markdown|mdown|txt))?$/iu.test(entry.name))
  const priority = (name: string) => name.toLowerCase() === 'readme.md' ? 0 : /\.(?:md|markdown|mdown)$/iu.test(name) ? 1 : 2
  return [...files].sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name))[0]
}
