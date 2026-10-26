import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'

import { createAppTheme } from '../../theme'
import { parseDiff } from './diffParser'
import { MarkdownDiffPreview } from './MarkdownDiffPreview'

function renderDiff(content: string) {
  const parsed = parseDiff(content, 'docs/README.md', 'docs/README.md')
  expect(parsed.status).toBe('valid')
  return render(<ThemeProvider theme={createAppTheme('light')}><MarkdownDiffPreview layout="unified" lines={parsed.lines} /></ThemeProvider>)
}

describe('MarkdownDiffPreview', () => {
  it('shows rendered deleted and added headings without unchanged context', () => {
    renderDiff('@@ -1,4 +1,4 @@\n # Context title\n-## Before\n+## **After**\n unchanged body\n end\n')
    const preview = screen.getByRole('region', { name: 'Markdown差分プレビュー' })
    const oldPart = within(preview).getByRole('region', { name: '削除 2行' })
    const newPart = within(preview).getByRole('region', { name: '追加 2行' })
    expect(within(oldPart).getByRole('heading', { name: 'Before' })).toBeInTheDocument()
    expect(within(newPart).getByRole('heading', { name: 'After' })).toBeInTheDocument()
    expect(within(newPart).getByText('After').closest('strong')).not.toBeNull()
    expect(within(preview).queryByText('Context title')).not.toBeInTheDocument()
    expect(within(preview).queryByText('unchanged body')).not.toBeInTheDocument()
    expect(oldPart).toHaveAttribute('data-kind', 'remove')
    expect(newPart).toHaveAttribute('data-kind', 'add')
  })

  it('renders an insertion without duplicating whole-file content', () => {
    renderDiff('@@ -7,1 +7,2 @@\n text already present\n+- **New item**\n')
    const preview = screen.getByRole('region', { name: 'Markdown差分プレビュー' })
    expect(within(preview).getByText('New item')).toBeInTheDocument()
    expect(within(preview).queryByText('text already present')).not.toBeInTheDocument()
    expect(within(preview).queryByLabelText(/^削除/u)).not.toBeInTheDocument()
  })
})
