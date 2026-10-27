import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 960, height: 640 }, { width: 1280, height: 840 }]) {
    const suffix = `${theme}-${viewport.width}x${viewport.height}`
    test.describe(suffix, () => {
      test.use({ viewport, colorScheme: theme })
      test('user links open MR and project lists inside the app', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-01-10T18:00:00+09:00'))
        await page.goto(`/?fixture=ready&theme=${theme}#client/mrs?mr=101-42&tab=discussion`)
        await page.getByRole('link', { name: '高橋 明里', exact: true }).first().click()
        await expect(page.getByRole('tab', { name: '作成したMR', exact: true })).toHaveAttribute('aria-selected', 'true')
        await expect(page).toHaveURL(/#client\/user\?username=akari.t$/u)
        const mrRow = page.locator('[data-screen-active="true"] [data-list-row="true"][data-mr-id="101-42"]')
        await expect(mrRow).toBeVisible()
        await expect(page).toHaveScreenshot(`client-user-mrs-${suffix}.png`)

        const projectTab = page.getByRole('tab', { name: 'プロジェクト', exact: true })
        await projectTab.focus()
        await page.keyboard.press('Enter')
        await expect(projectTab).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByRole('button', { name: /^個人ツール .*akari\.t\/tools/u })).toBeVisible()
        await expect(page).toHaveScreenshot(`client-user-projects-${suffix}.png`)
        await page.getByRole('button', { name: /^個人ツール .*akari\.t\/tools/u }).click()
        await expect(page.getByRole('tab', { name: 'コード', exact: true })).toBeVisible()
        await page.goBack()
        await expect(page.getByRole('tab', { name: 'プロジェクト', exact: true })).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('tab', { name: '作成したMR', exact: true }).click()
        await mrRow.click()
        await expect(page.getByRole('button', { name: '@akari.tに戻る', exact: true })).toBeVisible()
        await page.getByRole('button', { name: '@akari.tに戻る', exact: true }).click()
        await expect(page.getByRole('tab', { name: '作成したMR', exact: true })).toBeVisible()
        await page.goto(`/?theme=${theme}#foundation/catalog?section=user-navigation`)
        await expect(page.locator('#catalog-user-navigation')).toHaveScreenshot(`user-navigation-${suffix}.png`)
      })
    })
  }
}
