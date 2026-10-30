import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownLinkProvider } from '../MarkdownLinks'
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

  it('hides GitLab image attributes written after an image', () => {
    const { container } = render(<MockMarkdown body={'![shot](/uploads/a/shot.png){width=640 height=480} 後ろ {keep}'} />)
    expect(container).toHaveTextContent('[画像: shot · 表示できません] 後ろ {keep}')
    expect(container).not.toHaveTextContent('width')
  })

  it('links GitLab references and relative links, and opens links through the app', () => {
    const open = vi.fn()
    render(<MarkdownLinkProvider instanceUrl="https://gitlab.example" open={open} projectUrl="https://gitlab.example/team/desktop">
      <MockMarkdown body={'See !12, #34 and team/other!5 by @alice.\n\nNot a@b.com, x#1, `!9` or [!7](https://docs.example/) twice.\n\n[upload](/uploads/abc/log.txt)'} />
    </MarkdownLinkProvider>)
    expect(screen.getByRole('link', { name: '!12' })).toHaveAttribute('href', 'https://gitlab.example/team/desktop/-/merge_requests/12')
    expect(screen.getByRole('link', { name: '#34' })).toHaveAttribute('href', 'https://gitlab.example/team/desktop/-/issues/34')
    expect(screen.getByRole('link', { name: 'team/other!5' })).toHaveAttribute('href', 'https://gitlab.example/team/other/-/merge_requests/5')
    expect(screen.getByRole('link', { name: '@alice' })).toHaveAttribute('href', 'https://gitlab.example/alice')
    expect(screen.getByRole('link', { name: '!7' })).toHaveAttribute('href', 'https://docs.example/')
    expect(screen.getByRole('link', { name: 'upload' })).toHaveAttribute('href', 'https://gitlab.example/team/desktop/uploads/abc/log.txt')
    // An e-mail address is a mail link, not a user reference.
    expect(screen.getByRole('link', { name: 'a@b.com' })).toHaveAttribute('href', 'mailto:a@b.com')
    expect(screen.getAllByRole('link')).toHaveLength(7)

    fireEvent.click(screen.getByRole('link', { name: '!12' }))
    expect(open).toHaveBeenCalledWith('https://gitlab.example/team/desktop/-/merge_requests/12')
  })

  it('leaves references as text when the project is unknown', () => {
    render(<MockMarkdown body="See !12 and #34" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows GitLab emoji names as emoji, but not in code or when the name is unknown', async () => {
    const { container } = render(<MockMarkdown body={':red_circle: :white_circle: :large_blue_circle: :+1: :no_such_emoji: 10:30:00\n\n`:red_circle:`\n\n```\n:black_circle:\n```'} />)
    expect(await screen.findByText('🔴 ⚪ 🔵 👍 :no_such_emoji: 10:30:00')).toBeInTheDocument()
    expect(container.querySelector('p > code')).toHaveTextContent(':red_circle:')
    expect(container.querySelector('pre code')).toHaveTextContent(':black_circle:')
  })
})
