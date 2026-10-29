import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    __gridAudit?: () => string[]
  }
}

// The 4px grid of the real client screens, backed by the development-only fixture IPC. The grid audit
// (src/lib/gridAudit.ts, exposed by the development GridOverlay) reports boxes whose height has a stray
// fraction or is not whole grid steps, text that starts between grid lines, rows whose items are not
// centred, and stacked rows that start between grid lines. Each screen is scrolled through, since only
// what is on screen is measured. 125% is the common Windows scaling, where a CSS border is 0.8px.
const queue = '#client/mrs?reviewer=self&state=opened'
const detail = `${queue}&mr=101-42`
const screens = [
  { name: 'MR list', hash: queue, ready: 'MR一覧の検索結果をSQLiteキャッシュから再利用する' },
  { name: 'MR overview', hash: detail, ready: '説明' },
  { name: 'MR discussion', hash: `${detail}&tab=discussion`, ready: '一覧キャッシュの期限が切れたあとも' },
  { name: 'MR changes', hash: `${detail}&tab=changes`, ready: 'src/lib/review-cache.ts' },
  { name: 'MR pipelines', hash: `${detail}&tab=pipelines`, ready: 'test:unit' },
  { name: 'projects', hash: '#client/projects', ready: 'Desktop Client' },
  { name: 'code', hash: '#client/code?projectId=101&projectName=Desktop%20Client', ready: 'README.md' },
  { name: 'branches', hash: '#client/branches?projectId=101&projectName=platform%2Fdesktop-client', ready: 'feat/reuse-mr-cache' },
  { name: 'user', hash: '#client/user?username=akari.t', ready: '作成したMR' },
  { name: 'settings', hash: '#client/settings', ready: 'GitLab接続' },
] as const

const fetchStates = [
  { state: 'loading', hash: `${detail}&tab=discussion`, ready: 'MRを読み込み中…' },
  { state: 'error', hash: `${detail}&tab=discussion`, ready: '接続を確認してから再試行してください。' },
  { state: 'empty', hash: queue, ready: '条件に一致するMRがありません' },
  { state: 'stale', hash: `${detail}&tab=discussion`, ready: '保存済みの議論を表示中です。' },
] as const

async function open(page: Page, hash: string, ready: string, fixture = 'ready') {
  await page.clock.setFixedTime(new Date('2026-01-10T18:00:00+09:00'))
  await page.goto(`/?fixture=${fixture}${hash}`)
  await expect(page.getByText(ready, { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
  await page.waitForFunction(() => typeof window.__gridAudit === 'function')
}

/** The audit at every scroll position of each scrolling pane. */
async function auditScrolled(page: Page) {
  return page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const issues = new Set(window.__gridAudit?.() ?? [])
    const panes = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) => /auto|scroll/u.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 8 && element.clientHeight > 120)
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

const sizes = [
  { scale: 1, viewport: { width: 1280, height: 840 } },
  { scale: 1.25, viewport: { width: 1280, height: 840 } },
  { scale: 1.25, viewport: { width: 960, height: 640 } },
] as const

for (const { scale, viewport } of sizes) {
  test.describe(`grid at ${scale * 100}% ${viewport.width}x${viewport.height}`, () => {
    test.use({ deviceScaleFactor: scale, viewport })

    for (const screen of screens) {
      test(screen.name, async ({ page }) => {
        await open(page, screen.hash, screen.ready)
        expect(await auditScrolled(page)).toEqual([])
      })
    }
  })
}

// States reached by fetching and by opening editors, dialogs and panels, at the scaling where borders and
// fractions show most.
test.describe('grid of states at 125%', () => {
  test.use({ deviceScaleFactor: 1.25, viewport: { width: 1280, height: 840 } })

  for (const { state, hash, ready } of fetchStates) {
    test(`fetch ${state}`, async ({ page }) => {
      await open(page, hash, ready, state)
      expect(await auditScrolled(page)).toEqual([])
    })
  }

  test('reply editor, rich and Markdown source', async ({ page }) => {
    await open(page, `${detail}&tab=discussion`, '一覧キャッシュの期限が切れたあとも')
    await page.getByRole('button', { name: '返信', exact: true }).first().click()
    await expect(page.locator('.ProseMirror').first()).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
    await page.getByRole('button', { name: 'Markdown', exact: true }).first().click()
    await expect(page.locator('textarea').first()).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })

  test('suggestion dialog with a multiline message', async ({ page }) => {
    await open(page, `${detail}&tab=discussion`, '一覧キャッシュの期限が切れたあとも')
    await page.getByRole('button', { name: '提案を適用', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })

  test('people editor with an autocomplete', async ({ page }) => {
    await open(page, detail, '説明')
    await page.getByRole('button', { name: /^担当: /u }).first().click()
    await expect(page.getByRole('combobox').first()).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })

  test('keyboard shortcuts dialog', async ({ page }) => {
    await open(page, queue, 'MR一覧の検索結果をSQLiteキャッシュから再利用する')
    await page.keyboard.press('Shift+Slash')
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })

  test('notifications panel', async ({ page }) => {
    await open(page, queue, 'MR一覧の検索結果をSQLiteキャッシュから再利用する')
    await page.getByRole('button', { name: /^通知/u }).first().click()
    await expect(page.getByRole('button', { name: 'すべて既読', exact: true })).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })

  test('job log', async ({ page }) => {
    await open(page, `${detail}&tab=pipelines`, 'test:unit')
    await page.getByText('test:unit', { exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'ログ', exact: true })).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })

  test('tooltip', async ({ page }) => {
    await open(page, detail, '説明')
    await page.getByRole('button', { name: /^担当: /u }).first().hover()
    await expect(page.getByRole('tooltip')).toBeVisible()
    expect(await auditScrolled(page)).toEqual([])
  })
})
