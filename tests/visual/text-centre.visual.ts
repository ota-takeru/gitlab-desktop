import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// Latin and CJK text share one centre in the middle of the line box (public/boot.css,
// scripts/build-fonts.py). Latin text is Segoe UI with rebalanced metrics, CJK text is App Sans JP, SC,
// TC and KR, Noto Sans CJK moved down to Segoe UI's centre. This draws each language's interface text
// with the real fonts and checks both halves: the fonts share one centre, and the line puts it as near
// the middle as a whole-pixel baseline can. A Windows or font update that moves either shows up here.

const languages = [
  { family: 'App Sans JP', locale: 'ja' },
  { family: 'App Sans SC', locale: 'zh-Hans' },
  { family: 'App Sans TC', locale: 'zh-Hant' },
  { family: 'App Sans KR', locale: 'ko' },
] as const
const latin = '"Segoe UI Variable Balanced", "Segoe UI Balanced"'
// The text variants' sizes and line heights in the theme.
const lines = [[11, 16], [12, 20], [13, 20], [14, 24], [15, 20], [15, 24], [18, 24]] as const

/** The kanji, kana and hangul of a language's interface text, with how often each appears. */
function letters(locale: string) {
  const counts = new Map<string, number>()
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const char of value) if (/[぀-ヿ㐀-䶿一-鿿가-힣]/u.test(char)) counts.set(char, (counts.get(char) ?? 0) + 1)
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  const directory = join('src', 'i18n', 'messages', locale)
  for (const file of readdirSync(directory)) walk(JSON.parse(readFileSync(join(directory, file), 'utf8')))
  return [...counts]
}

test.describe('text centre', () => {
  test.use({ viewport: { width: 800, height: 600 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/?fixture=ready#client/settings')
    await page.evaluate(async ({ latin, families }) => {
      for (const weight of [400, 600, 700]) {
        await document.fonts.load(`${weight} 20px ${latin}`)
        for (const family of families) await document.fonts.load(`${weight} 20px "${family}"`, '国あ한')
      }
    }, { latin, families: languages.map((language) => language.family) })
  })

  for (const { family, locale } of languages) {
    test(`${family} shares Latin text's centre`, async ({ page }) => {
      // In em, measured at 200px: Latin as half way between cap height and x-height, CJK as the
      // frequency-weighted middle of each letter's ink.
      const { latinCentre, cjkCentre } = await page.evaluate(({ latin, family, letters }) => {
        const context = document.createElement('canvas').getContext('2d')!
        context.font = `400 200px ${latin}`
        const latinCentre = (context.measureText('H').actualBoundingBoxAscent + context.measureText('x').actualBoundingBoxAscent) / 4 / 200
        context.font = `400 200px "${family}"`
        let total = 0
        let weight = 0
        for (const [char, count] of letters) {
          const metrics = context.measureText(char)
          total += (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2 / 200 * count
          weight += count
        }
        return { latinCentre, cjkCentre: total / weight }
      }, { latin, family, letters: letters(locale) })
      // 0.005em is a tenth of a pixel at 20px.
      expect(Math.abs(cjkCentre - latinCentre), `${family} ${cjkCentre.toFixed(4)}em, Latin ${latinCentre.toFixed(4)}em`).toBeLessThan(0.005)
    })
  }

  test('the shared centre sits in the middle of the line box', async ({ page }) => {
    const offsets = await page.evaluate(({ latin, lines }) => lines.map(([size, lineHeight]) => {
      const box = document.createElement('div')
      box.style.cssText = `position: absolute; left: 0; top: 0; font: 400 ${size}px/${lineHeight}px ${latin}, "App Sans JP"; white-space: nowrap`
      box.innerHTML = 'Hx 国あ<span style="display: inline-block; width: 0; height: 0; vertical-align: baseline"></span>'
      document.body.append(box)
      const baseline = box.lastElementChild!.getBoundingClientRect().top - box.getBoundingClientRect().top
      box.remove()
      // Segoe UI's centre is 0.300em above its baseline: (cap height 1434 + x-height 1024) / 4 / 2048.
      return { line: `${size}/${lineHeight}`, offset: baseline - 0.3 * size - lineHeight / 2 }
    }), { latin, lines })
    // Baselines fall on whole pixels, so half a pixel is the limit (reached at 15px, whose middle is a half pixel).
    for (const { line, offset } of offsets) expect(Math.abs(offset), `${line}: ${offset.toFixed(2)}px`).toBeLessThanOrEqual(0.5)
  })
})
