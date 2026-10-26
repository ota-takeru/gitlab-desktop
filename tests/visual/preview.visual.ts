import { expect, test } from '@playwright/test'

// Screenshots of actual React/Tauri front-end views using development-only
// fixture IPC. Nothing is sent to a GitLab server.
test.use({ viewport: { width: 1280, height: 840 }, colorScheme: 'light' })

const root = '/?fixture=ready&theme=light'
const mr = '#client/mrs?reviewer=self&state=opened&mr=101-42'

test('preview README on project overview', async ({ page }, testInfo) => {
  await page.goto(`${root}#client/projects`)
  const project = page.getByRole('button', { name: /Desktop Client（platform\/desktop-client）/ })
  await expect(project).toBeVisible()
  await project.click()
  await expect(page.getByRole('tab', { name: '概要' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('READMEプレビュー · README.md')).toBeVisible()
  await expect(page.getByText('主な機能')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('01-project-readme.png'), animations: 'disabled' })
})

test('preview diff timeline, Blame and associated MR', async ({ page }, testInfo) => {
  await page.goto(`${root}${mr}`)
  await page.getByRole('tab', { name: '変更' }).click()
  await expect(page.getByRole('button', { name: 'Blame' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('02-commit-timeline.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Blame' }).click()
  const gutter = page.locator('[data-side="new"] .blame-action').filter({ hasText: /^[0-9a-f]{8}$/ }).first()
  await expect(gutter).toBeVisible()
  await gutter.click()
  await expect(page.getByRole('dialog', { name: 'Blameのコミット詳細' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^!42 MR一覧の検索結果/ })).toBeVisible()
  // A single diff viewer owns the code; the popover shows metadata only.
  await expect(page.getByRole('region', { name: 'Blameの行履歴' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('03-blame-related-mr.png'), animations: 'disabled' })
})

test('preview rendered Markdown file and source switch', async ({ page }, testInfo) => {
  await page.goto(`${root}#client/code?projectId=101&projectName=Desktop%20Client`)
  await page.getByRole('button', { name: 'README.md' }).click()
  await expect(page.getByRole('button', { name: 'Markdownのソースを表示' })).toBeVisible()
  await expect(page.getByText('主な機能')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('04-markdown-rendered.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Markdownのソースを表示' }).click()
  await expect(page.getByTestId('file-line').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('05-markdown-source.png'), animations: 'disabled' })
})
