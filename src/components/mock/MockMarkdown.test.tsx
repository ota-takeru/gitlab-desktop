import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MockMarkdown } from './MockMarkdown'

describe('local Markdown preview', () => {
  it('renders common review formatting and task lists', () => {
    const { container } = render(<MockMarkdown body={'**確認**\n\n- [x] 完了\n- [ ] 保留\n\n```ts\nconst value = 1\n```'} />)
    expect(container.querySelector('strong')).toHaveTextContent('確認')
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(container.querySelector('pre code')).toHaveTextContent('const value = 1')
  })

  it('does not render raw HTML, executable links or remote image requests', () => {
    const { container } = render(<MockMarkdown body={'<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n![private](https://example.test/private.png)\n\n[docs](https://docs.gitlab.com/)'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('link', { name: 'unsafe' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows GitLab emoji names as emoji, but not in code or when the name is unknown', async () => {
    const { container } = render(<MockMarkdown body={':red_circle: :white_circle: :large_blue_circle: :+1: :no_such_emoji: 10:30:00\n\n`:red_circle:`\n\n```\n:black_circle:\n```'} />)
    expect(await screen.findByText('🔴 ⚪ 🔵 👍 :no_such_emoji: 10:30:00')).toBeInTheDocument()
    expect(container.querySelector('p > code')).toHaveTextContent(':red_circle:')
    expect(container.querySelector('pre code')).toHaveTextContent(':black_circle:')
  })
})
