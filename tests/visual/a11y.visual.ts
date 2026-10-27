import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Accessibility checks of the real client screens, backed by the development-only fixture IPC.
// axe runs in the browser, so colour contrast is measured on the rendered theme.
const screens = [
  { name: 'MR list', hash: '#client/mrs?reviewer=self&state=opened', ready: 'MR一覧の検索結果をSQLiteキャッシュから再利用する' },
  { name: 'MR overview', hash: '#client/mrs?reviewer=self&state=opened&mr=101-42', ready: '説明' },
  { name: 'MR discussion', hash: '#client/mrs?reviewer=self&state=opened&mr=101-42&tab=discussion', ready: '一覧キャッシュの期限が切れたあとも' },
  { name: 'MR changes', hash: '#client/mrs?reviewer=self&state=opened&mr=101-42&tab=changes', ready: 'src/lib/review-cache.ts' },
  { name: 'projects', hash: '#client/projects', ready: 'Desktop Client' },
  { name: 'code', hash: '#client/code?projectId=101&projectName=Desktop%20Client', ready: 'README.md' },
  { name: 'settings', hash: '#client/settings', ready: 'GitLab接続' },
] as const

async function open(page: Page, hash: string, ready: string) {
  await page.clock.setFixedTime(new Date('2026-01-10T18:00:00+09:00'))
  await page.goto(`/?fixture=ready${hash}`)
  await expect(page.getByText(ready).first()).toBeVisible()
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} accessibility`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1280, height: 840 } })

    for (const screen of screens) {
      test(screen.name, async ({ page }) => {
        await open(page, `${screen.hash}${screen.hash.includes('?') ? '&' : '?'}theme=${theme}`, screen.ready)
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        const violations = results.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length}) ${violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join(' | ')}`)
        expect(violations).toEqual([])
      })
    }
  })
}
