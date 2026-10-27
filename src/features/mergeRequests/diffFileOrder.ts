import type { Diff } from '../../types/gitlab'

export interface FileEntry { diff: Diff; path: string }

export interface DirectoryNode { kind: 'directory'; name: string; path: string; children: TreeNode[] }
export interface FileNode { kind: 'file'; name: string; entry: FileEntry }
export type TreeNode = DirectoryNode | FileNode

/** The files in the order the tree lists them: folders first, then by name. */
export function fileTreeOrder(entries: FileEntry[]): FileEntry[] {
  const files: FileEntry[] = []
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'file') files.push(node.entry)
      else visit(node.children)
    }
  }
  visit(buildFileTree(entries))
  return files
}

export function buildFileTree(entries: FileEntry[]): TreeNode[] {
  const root: DirectoryNode = { children: [], kind: 'directory', name: '', path: '' }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let directory = root
    for (const part of parts.slice(0, -1)) {
      const path = directory.path ? `${directory.path}/${part}` : part
      let child = directory.children.find((node): node is DirectoryNode => node.kind === 'directory' && node.path === path)
      if (!child) {
        child = { children: [], kind: 'directory', name: part, path }
        directory.children.push(child)
      }
      directory = child
    }
    directory.children.push({ entry, kind: 'file', name: parts[parts.length - 1] })
  }
  return finish(root.children)
}

function finish(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === 'file') return node
    let directory = node
    while (directory.children.length === 1 && directory.children[0].kind === 'directory') {
      const only: DirectoryNode = directory.children[0]
      directory = { ...only, name: `${directory.name}/${only.name}` }
    }
    return { ...directory, children: finish(directory.children) }
  }).sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1)
}

export type FileListMode = 'tree' | 'list'
export const FILE_LIST_MODE_KEY = 'gitlab-desktop:diff-file-list'

export function readFileListMode(): FileListMode {
  try {
    return globalThis.localStorage?.getItem(FILE_LIST_MODE_KEY) === 'list' ? 'list' : 'tree'
  } catch {
    return 'tree'
  }
}

/** The files of a diff page in the order the file list shows them: as the folder tree, or as returned in the list view. */
export function diffFileOrder(diffs: Diff[]): Diff[] {
  const entries = diffs.map((diff) => ({ diff, path: diff.newPath || diff.oldPath }))
  return (readFileListMode() === 'list' ? entries : fileTreeOrder(entries)).map(({ diff }) => diff)
}
