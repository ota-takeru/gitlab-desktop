import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    __gridAudit?: () => string[]
  }
}

// The 4px grid of the real client screens, backed by the development-only fixture IPC. The grid audit
// (src/lib/gridAudit.ts, exposed by the development GridOverlay) reports boxes whose height has a stray
// fraction, rows whose items are not centred, and stacked rows that start between grid lines. Each screen
// is scrolled through, since only what is on screen is measured. 125% is the common Windows scaling, where
// a CSS border is 0.8px.
const screens = [
  { name: 'MR list', hash: '#client/mrs?reviewer=self&state=opened', ready: 'MR一覧の検索結果をSQLiteキャッシュから再利用する' },
  { name: 'MR overview', hash: '#client/mrs?reviewer=self&state=opened&mr=101-42', ready: '説明' },
  { name: 'MR discussion', hash: '#client/mrs?reviewer=self&state=opened&mr=101-42&tab=discussion', ready: '一覧キャッシュの期限が切れたあとも' },
  { name: 'MR changes', hash: '#client/mrs?reviewer=self&state=opened&mr=101-42&tab=changes', ready: 'src/lib/review-cache.ts' },
  { name: 'projects', hash: '#client/projects', ready: 'Desktop Client' },
  { name: 'code', hash: '#client/code?projectId=101&projectName=Desktop%20Client', ready: 'README.md' },
  { name: 'branches', hash: '#client/branches?projectId=101&projectName=platform%2Fdesktop-client', ready: 'feat/reuse-mr-cache' },
  { name: 'settings', hash: '#client/settings', ready: 'GitLab接続' },
] as const

async function open(page: Page, hash: string, ready: string) {
  await page.clock.setFixedTime(new Date('2026-01-10T18:00:00+09:00'))
  await page.goto(`/?fixture=ready${hash}`)
  await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 })
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
  await page.waitForFunction(() => typeof window.__gridAudit === 'function')
}

/** The audit at every scroll position of each scrolling pane. */
async function auditScrolled(page: Page) {
  return page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const issues = new Set(window.__gridAudit?.() ?? [])
    const panes = [...document.querySelectorAll<HTMLElement>('*')].filter((element) => /auto|scroll/u.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 8 && element.clientHeight > 200)
    for (const pane of panes) {
      for (let top = 0; top < pane.scrollHeight; top += Math.floor(pane.clientHeight * 0.8)) {
        pane.scrollTop = top
        await frame()
        for (const issue of window.__gridAudit?.() ?? []) issues.add(issue)
      }
      pane.scrollTop = 0
    }
    return [...issues]
  })
}

for (const scale of [1, 1.25]) {
  test.describe(`grid at ${scale * 100}%`, () => {
    test.use({ deviceScaleFactor: scale, viewport: { width: 1280, height: 840 } })

    for (const screen of screens) {
      test(screen.name, async ({ page }) => {
        await open(page, screen.hash, screen.ready)
        expect(await auditScrolled(page)).toEqual([])
      })
    }
  })
}
