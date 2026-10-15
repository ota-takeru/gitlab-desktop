// Builds src/lib/emojiData.json, the emoji the reaction picker offers.
//
// Names and categories come from GitLab's own emoji list, so every name the
// picker sends is one GitLab accepts. Japanese labels and search words come
// from emojibase-data (CLDR annotations), matched by the emoji character.
//
//   curl -o emojis.json https://gitlab.com/-/emojis/4/emojis.json
//   node scripts/generate-emoji-data.mjs emojis.json
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** GitLab's category names, in the order the picker shows them. */
const CATEGORIES = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags']
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/u

const source = process.argv[2]
if (!source) throw new Error('Usage: node scripts/generate-emoji-data.mjs <gitlab emojis.json>')
const gitlab = JSON.parse(readFileSync(source, 'utf8'))
const japanese = createRequire(import.meta.url)('emojibase-data/ja/compact.json')

const withoutVariation = (text) => text.replace(/️/gu, '')
const annotations = new Map(japanese.map((entry) => [withoutVariation(entry.unicode), entry]))

const emoji = []
for (const entry of gitlab) {
  const category = CATEGORIES.indexOf(entry.c)
  // GitLab's "Component" entries are skin tones and hair styles, not reactions.
  if (category < 0) continue
  const toned = SKIN_TONE.test(entry.e)
  const annotation = annotations.get(withoutVariation(entry.e))
  if (!toned && !annotation) throw new Error(`No Japanese annotation for ${entry.n} ${entry.e}`)
  // Skin-tone variants and flags are kept so other people's reactions display, but the picker
  // leaves them out (Windows has no country flag glyphs): they are the entries with only a name,
  // a character and a category.
  if (toned || entry.c === 'Flags') {
    emoji.push([entry.n, entry.e, category])
    continue
  }
  const words = [entry.n.replaceAll('_', ' '), entry.d, annotation.label, ...(annotation.tags ?? [])].join(' ').toLowerCase()
  emoji.push([entry.n, entry.e, category, annotation.label, words])
}

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/emojiData.json')
writeFileSync(target, `${JSON.stringify({ emoji })}\n`, 'utf8')
console.log(`Wrote ${emoji.length} emoji to ${target}`)
