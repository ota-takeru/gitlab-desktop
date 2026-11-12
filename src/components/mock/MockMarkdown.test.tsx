import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownLinkProvider } from '../MarkdownLinks'
import { finishedMermaidDiagram, renderMermaidDiagram } from '../../lib/mermaidDiagram'
import { resolveMarkdownUrl } from '../../lib/markdownLinks'
import { MockMarkdown } from './MockMarkdown'
import { clearParsedMarkdown } from './parsedMarkdown'

const mermaidRender = vi.hoisted(() => vi.fn())
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: mermaidRender } }))
vi.mock('../../lib/markdownLinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/markdownLinks')>()
  return { ...actual, resolveMarkdownUrl: vi.fn(actual.resolveMarkdownUrl) }
})

describe('local Markdown preview', () => {
  it('parses a body again only after logout, account replacement or an explicit clear', () => {
    const body = '[参照](https://gitlab.example/cache-check)'
    const parses = () => vi.mocked(resolveMarkdownUrl).mock.calls.filter(([url]) => url === 'https://gitlab.example/cache-check').length
    render(<MockMarkdown body={body} />).unmount()
    const first = parses()
    expect(first).toBeGreaterThan(0)
    render(<MockMarkdown body={body} />).unmount()
    expect(parses()).toBe(first)
    globalThis.dispatchEvent(new Event('gitlab-explicit-logout'))
    render(<MockMarkdown body={body} />).unmount()
    expect(parses()).toBe(first * 2)
    globalThis.dispatchEvent(new Event('gitlab-account-replaced'))
    render(<MockMarkdown body={body} />).unmount()
    expect(parses()).toBe(first * 3)
    clearParsedMarkdown()
    render(<MockMarkdown body={body} />).unmount()
    expect(parses()).toBe(first * 4)
  })

  it('forgets drawn diagrams after logout or account replacement', async () => {
    for (const event of ['gitlab-explicit-logout', 'gitlab-account-replaced']) {
      mermaidRender.mockResolvedValueOnce({ svg: '<svg/>' })
      await renderMermaidDiagram(`graph TD
  ${event}`, false)
      expect(finishedMermaidDiagram(`graph TD
  ${event}`, false)).toBeTruthy()
      globalThis.dispatchEvent(new Event(event))
      expect(finishedMermaidDiagram(`graph TD
  ${event}`, false)).toBeUndefined()
    }
  })

  it('draws a mermaid block as an image, keeping its source lines for a reviewed file', async () => {
    mermaidRender.mockResolvedValueOnce({ svg: '<svg><text>確認</text></svg>' })
    const source = 'graph TD\n    A["軽量版"] -->|読む| B[("Sp")]'
    const review = { addedLines: new Set<number>(), removedByAnchor: new Map(), consistent: true }
    const { container } = render(<MockMarkdown body={`\`\`\`mermaid\n${source}\n\`\`\``} review={review} />)
    expect(container.querySelector('pre code')).toHaveTextContent('graph TD')
    const image = await screen.findByRole('img')
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toBe('data:image/svg+xml;charset=utf-8,<svg><text>確認</text></svg>')
    expect(mermaidRender.mock.lastCall?.[1]).toBe(`${source}\n`)
    expect(container.querySelector('[data-mermaid-diagram]')).toHaveAttribute('data-source-start', '1')
    expect(container.querySelector('pre')).toBeNull()
  })

  it('keeps the source of a mermaid block that cannot be drawn', async () => {
    mermaidRender.mockRejectedValueOnce(new Error('Parse error'))
    const { container } = render(<MockMarkdown body={'```mermaid\nnot a diagram\n```'} />)
    expect(await screen.findByText('図を描画できないため、ソースを表示しています。')).toBeInTheDocument()
    expect(container.querySelector('pre code')).toHaveTextContent('not a diagram')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('leaves other code blocks to the code renderer', () => {
    mermaidRender.mockClear()
    const { container } = render(<MockMarkdown body={'```\ngraph TD\n```'} />)
    expect(container.querySelector('pre code')).toHaveTextContent('graph TD')
    expect(mermaidRender).not.toHaveBeenCalled()
  })

  it('renders common review formatting and task lists', () => {
    const { container } = render(<MockMarkdown body={'**確認**\n\n- [x] 完了\n- [ ] 保留\n\n```ts\nconst value = 1\n```'} />)
    expect(container.querySelector('strong')).toHaveTextContent('確認')
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(container.querySelector('pre code')).toHaveTextContent('const value = 1')
  })

  it('keeps short table cells on one line and scrolls each table by itself', () => {
    const sentence = '環境変数が未設定のときは既定値を使うこと'
    const { container } = render(<MockMarkdown body={`| ID | 内容 |\n| --- | :--- |\n| PO-19 | ${sentence} |\n| **1234567890123456** | [12345678901234567](https://example.test/) |`} />)
    expect(container.querySelector('[data-table-scroll] > table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'ID' })).toHaveAttribute('data-short-cell')
    expect(screen.getByRole('cell', { name: 'PO-19' })).toHaveAttribute('data-short-cell')
    expect(screen.getByRole('cell', { name: '1234567890123456' })).toHaveAttribute('data-short-cell')
    expect(screen.getByRole('cell', { name: sentence })).not.toHaveAttribute('data-short-cell')
    expect(screen.getByRole('cell', { name: '12345678901234567' })).not.toHaveAttribute('data-short-cell')
    expect(screen.getByRole('cell', { name: sentence })).toHaveStyle({ textAlign: 'left' })
  })

  it('keeps the source lines of a table in a reviewed file', () => {
    const review = { addedLines: new Set<number>(), removedByAnchor: new Map(), consistent: true }
    const { container } = render(<MockMarkdown body={'| ID |\n| --- |\n| PO-19 |'} review={review} />)
    expect(container.querySelector('[data-table-scroll] > table')).toHaveAttribute('data-source-start', '1')
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
