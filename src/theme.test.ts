import { alpha, decomposeColor, getContrastRatio, type PaletteMode } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'

import { createAppTheme } from './theme'

/** A translucent colour as it appears over an opaque background. */
function flatten(color: string, background: string) {
  const top = decomposeColor(color)
  const bottom = decomposeColor(background).values
  const opacity = top.values[3] ?? 1
  return `rgb(${top.values.slice(0, 3).map((value, index) => Math.round(value * opacity + bottom[index] * (1 - opacity))).join(', ')})`
}

describe.each<PaletteMode>(['light', 'dark'])('%s theme contrast', (mode) => {
  const theme = createAppTheme(mode)
  const { palette } = theme
  const bases = [palette.background.default, palette.background.paper, palette.surface.nav, palette.surface.list, palette.surface.raised]
  // Rows sit on the list and nav surfaces, selected or hovered.
  const surfaces = [...bases, ...[palette.surface.nav, palette.surface.list, palette.background.default].flatMap((base) => [flatten(palette.surface.selected, base), flatten(palette.action.hover, base)])]

  it.each(['text.primary', 'text.secondary', 'primary', 'secondary', 'success', 'warning', 'error', 'info'])('%s is readable as small text on every surface', (name) => {
    const color = name.startsWith('text.') ? palette.text[name.slice(5) as 'primary' | 'secondary'] : palette[name as 'primary'].main
    for (const surface of surfaces) expect(getContrastRatio(color, surface), `${color} on ${surface}`).toBeGreaterThanOrEqual(4.5)
  })

  it('outlines inputs at 3:1 against the input and the surfaces around it', () => {
    const root = theme.components?.MuiOutlinedInput?.styleOverrides?.root as Record<string, { borderColor: string }>
    const border = root['& .MuiOutlinedInput-notchedOutline'].borderColor
    for (const surface of bases) expect(getContrastRatio(border, surface), `${border} on ${surface}`).toBeGreaterThanOrEqual(3)
  })

  it('keeps white text readable on the primary fill', () => {
    for (const fill of [palette.fill.primary, palette.fill.primaryHover]) expect(getContrastRatio(palette.fill.primaryText, fill), fill).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the contrast text readable on the main colours', () => {
    expect(getContrastRatio(palette.primary.contrastText, palette.primary.main)).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio(palette.secondary.contrastText, palette.secondary.main)).toBeGreaterThanOrEqual(4.5)
  })

  it('orders the primary shades from dark to light', () => {
    const luminance = (color: string) => getContrastRatio(color, '#000000')
    expect(luminance(palette.primary.dark)).toBeLessThan(luminance(palette.primary.main))
    expect(luminance(palette.primary.light)).toBeGreaterThan(luminance(palette.primary.main))
  })

  it('keeps initial avatars and search matches readable', () => {
    for (const tone of palette.avatar) expect(getContrastRatio(tone.text, tone.background), tone.text).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio(palette.diff.searchMatchText, palette.diff.searchMatchBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('outlines editors at 3:1 against the surfaces around them', () => {
    for (const surface of bases) expect(getContrastRatio(palette.surface.inputBorder, surface)).toBeGreaterThanOrEqual(3)
  })

  it('keeps syntax comments readable on the diff backgrounds', () => {
    for (const background of [palette.diff.addedBackground, palette.diff.deletedBackground]) {
      for (const color of [palette.syntax.comment, palette.syntax.title]) expect(getContrastRatio(color, background), `${color} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the place colours visible on the navigation and on their selected tint', () => {
    for (const colour of Object.values(palette.place)) {
      expect(getContrastRatio(colour, palette.surface.nav)).toBeGreaterThanOrEqual(4.5)
      expect(getContrastRatio(colour, flatten(alpha(colour, 0.14), palette.surface.nav))).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps a filled success notice readable', () => {
    expect(getContrastRatio(mode === 'dark' ? palette.surface.nav : '#ffffff', palette.success.main)).toBeGreaterThanOrEqual(4.5)
  })

  it('follows the system reduced-motion setting', () => {
    expect(theme.motion.reducedMotion).toBe('system')
  })
})

describe('language fonts', () => {
  it('puts the language font before the Japanese one for Chinese and Korean', () => {
    const family = (locale: Parameters<typeof createAppTheme>[1]) => createAppTheme('dark', locale).typography.fontFamily ?? ''
    expect(family('zh-Hans').indexOf('Microsoft YaHei UI')).toBeLessThan(family('zh-Hans').indexOf('Yu Gothic UI'))
    expect(family('zh-Hant').indexOf('Microsoft JhengHei UI')).toBeLessThan(family('zh-Hant').indexOf('Yu Gothic UI'))
    expect(family('ko').indexOf('Malgun Gothic')).toBeLessThan(family('ko').indexOf('Yu Gothic UI'))
    expect(family('en')).toBe(family('ja'))
    expect(family('ja')).not.toContain('YaHei')
  })
})
