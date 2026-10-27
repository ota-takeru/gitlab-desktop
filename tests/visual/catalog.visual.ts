import { expect, test, type Page } from '@playwright/test'

const themes = ['light', 'dark'] as const
const viewports = [
  { width: 960, height: 640 },
  { width: 1280, height: 840 },
] as const

// Relative times in the samples and fixtures are computed from the current clock.
const fixedNow = new Date('2026-01-10T18:00:00+09:00')

const queue = '#client/mrs?reviewer=self&state=opened'
const detail = `${queue}&mr=101-42&tab=discussion`
const detailTitle = 'MR一覧の検索結果をSQLiteキャッシュから再利用する'

async function open(page: Page, url: string) {
  await page.clock.setFixedTime(fixedNow)
  await page.goto(url)
  await expect(page.getByText('画面を読み込み中…')).toHaveCount(0)
}

for (const theme of themes) {
  for (const viewport of viewports) {
    const suffix = `${theme}-${viewport.width}x${viewport.height}`

    test.describe(suffix, () => {
      test.use({ viewport, colorScheme: theme })

      // Every element with a `catalog-*` id is captured, so new catalog sections are covered automatically.
      test('UI catalog sections', async ({ page }) => {
        await open(page, `/#foundation/catalog?theme=${theme}`)
        const sections = page.locator('[id^="catalog-"]')
        await expect(sections.first()).toBeVisible()
        const ids = await sections.evaluateAll((elements) => elements.map((element) => element.id))
        for (const id of ids) {
          await expect.soft(page.locator(`#${id}`)).toHaveScreenshot(`${id.replace(/^catalog-/u, '')}-${suffix}.png`)
        }
      })

      // The real client screens, backed by the development-only fixture IPC.
      test('client MR list and detail', async ({ page }) => {
        await open(page, `/?fixture=ready&theme=${theme}${queue}`)
        await expect(page.getByText(detailTitle).first()).toBeVisible()
        await expect.soft(page).toHaveScreenshot(`client-mr-list-${suffix}.png`)

        await open(page, `/?fixture=ready&theme=${theme}${detail}`)
        await expect(page.getByRole('tab', { name: /議論/u })).toBeVisible()
        await expect(page.getByText('一覧キャッシュの期限が切れたあとも').first()).toBeVisible()
        await expect.soft(page).toHaveScreenshot(`client-mr-discussion-${suffix}.png`)

        await page.getByRole('tab', { name: '変更' }).click()
        await expect(page.getByText('src/lib/review-cache.ts').first()).toBeVisible()
        await expect.soft(page).toHaveScreenshot(`client-mr-changes-${suffix}.png`)

        await open(page, `/?fixture=ready&theme=${theme}#client/branches?projectId=101&projectName=platform%2Fdesktop-client`)
        await expect(page.getByText('feat/reuse-mr-cache').first()).toBeVisible()
        await expect.soft(page).toHaveScreenshot(`client-project-branches-${suffix}.png`)

        await open(page, `/?fixture=ready&theme=${theme}#client/settings`)
        await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
        await expect.soft(page).toHaveScreenshot(`client-settings-${suffix}.png`)
      })
    })
  }
}

// Fetch states are layout-independent enough to capture at the normal size only.
const states = [
  { state: 'loading', url: detail, text: 'MRを読み込み中…' },
  { state: 'error', url: detail, text: '接続を確認してから再試行してください。' },
  { state: 'empty', url: queue, text: '条件に一致するMRがありません' },
  { state: 'stale', url: detail, text: '保存済みの議論を表示中です。' },
] as const

for (const theme of themes) {
  test.describe(`${theme} fetch states`, () => {
    test.use({ viewport: viewports[1], colorScheme: theme })

    for (const { state, url, text } of states) {
      test(`client ${state}`, async ({ page }) => {
        await open(page, `/?fixture=${state}&theme=${theme}${url}`)
        // The list kept under an open MR is hidden; look only at what is shown.
        await expect(page.getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible()
        await expect(page).toHaveScreenshot(`client-${state}-${theme}-1280x840.png`)
      })
    }
  })
}
