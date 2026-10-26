import { describe, expect, it } from 'vitest'

import { chooseReadmeFile } from './ProjectReadmePreview'
import type { TreeEntry } from '../../types/gitlab'

const entry = (name: string, type: TreeEntry['type'] = 'blob'): TreeEntry => ({ id: 'abcdef', name, path: name, type })

describe('chooseReadmeFile', () => {
  it('prefers README.md across case variants', () => {
    expect(chooseReadmeFile([entry('readme.txt'), entry('README.markdown'), entry('README.md')])?.name).toBe('README.md')
  })
  it('ignores directories and non-README files', () => {
    expect(chooseReadmeFile([entry('README.md', 'tree'), entry('notes.md')])).toBeUndefined()
  })
})
