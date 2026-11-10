import { describe, expect, it } from 'vitest'
import { matchesFilePath } from './filePathSearch'

const path = 'src/features/mergeRequests/DiffViewer.tsx'

describe('matchesFilePath', () => {
  it('matches every path for an empty search, and a path that holds the text or is held by it', () => {
    expect(matchesFilePath(path, '  ')).toBe(true)
    expect(matchesFilePath(path, 'viewer')).toBe(true)
    expect(matchesFilePath(path, `https://gitlab.example/-/blob/main/${path}#L5`)).toBe(true)
  })

  it('matches a text that starts with the end of the path from a folder or file name', () => {
    expect(matchesFilePath(path, 'DiffViewer.tsx:223')).toBe(true)
    expect(matchesFilePath(path, 'mergerequests/diffviewer.tsx#L5')).toBe(true)
    expect(matchesFilePath(path, 'DiffViewer.tsx')).toBe(true)
    // The shared part starts inside a name, or the name runs on.
    expect(matchesFilePath(path, 'Viewer.tsx:223')).toBe(false)
    expect(matchesFilePath(path, 'DiffViewer.tsxx')).toBe(false)
  })

  it('matches a text that ends with the path folders from the top', () => {
    expect(matchesFilePath(path, 'https://gitlab.example/-/tree/main/src/features')).toBe(true)
    expect(matchesFilePath(path, 'tree/main/src/features/')).toBe(true)
    // The shared part starts inside a folder name.
    expect(matchesFilePath(path, 'tree/main/mysrc/features')).toBe(false)
  })

  it('does not match on a shared folder or extension alone', () => {
    expect(matchesFilePath(path, 'src/other/Thing.tsx')).toBe(false)
    expect(matchesFilePath(path, 'lib/DiffViewer')).toBe(false)
  })
})
