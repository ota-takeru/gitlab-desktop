import { useEffect, useState } from 'react'

import type { MessageKey } from '../i18n/i18n'
import type { AwardEmoji, GitLabUser } from '../types/gitlab'

/** The reactions 「よく使う」 offers before the user has picked any. */
export const REACTION_CHOICES = ['thumbsup', 'thumbsdown', 'smile', 'tada', 'confused', 'heart', 'rocket', 'eyes'] as const

/** The picker's categories, in the order of GitLab's emoji list (see scripts/generate-emoji-data.mjs). */
export const EMOJI_CATEGORIES = ['common.emoji.category.faces', 'common.emoji.category.people', 'common.emoji.category.nature', 'common.emoji.category.food', 'common.emoji.category.travel', 'common.emoji.category.activities', 'common.emoji.category.objects', 'common.emoji.category.symbols'] as const satisfies readonly MessageKey[]

export interface EmojiChoice {
  name: string
  emoji: string
  category: number
  /** The Japanese name shown in the picker's preview. */
  label: string
  /** GitLab's name, the English description and the Japanese words, lower-cased. */
  words: string
}

export interface EmojiCatalog {
  /** Every GitLab emoji name, skin-tone variants included, to its character. */
  byName: ReadonlyMap<string, string>
  /** The emoji the picker offers, without skin-tone variants and flags. */
  choices: readonly EmojiChoice[]
  choiceByName: ReadonlyMap<string, EmojiChoice>
}

type EmojiRow = [string, string, number] | [string, string, number, string, string]

let catalog: EmojiCatalog | null = null
let loading: Promise<EmojiCatalog> | null = null

/** Loads the full emoji list once; it is a separate chunk so startup stays small. */
export function loadEmojiCatalog(): Promise<EmojiCatalog> {
  loading ??= import('./emojiData.json').then(({ default: data }) => {
    const rows = data.emoji as EmojiRow[]
    const byName = new Map(rows.map((row) => [row[0], row[1]]))
    const choices: EmojiChoice[] = []
    for (const row of rows) {
      // GitLab's list gives a few names twice (man_in_tuxedo, beetle, cricket); the picker offers the one the name shows as.
      if (row.length === 5 && byName.get(row[0]) === row[1]) choices.push({ category: row[2], emoji: row[1], label: row[3], name: row[0], words: row[4] })
    }
    catalog = {
      byName,
      choiceByName: new Map(choices.map((choice) => [choice.name, choice])),
      choices,
    }
    return catalog
  }, (error: unknown) => {
    // The next caller tries again.
    loading = null
    throw error
  })
  return loading
}

/**
 * The emoji list, or null while it loads or when it failed to load; names
 * then fall back to the common ones below.
 */
export function useEmojiCatalog(): { catalog: EmojiCatalog | null; failed: boolean } {
  const [state, setState] = useState({ catalog, failed: false })
  useEffect(() => {
    if (state.catalog) return
    let active = true
    loadEmojiCatalog().then(
      (value) => { if (active) setState({ catalog: value, failed: false }) },
      () => { if (active) setState({ catalog: null, failed: true }) },
    )
    return () => { active = false }
  }, [state.catalog])
  return state
}

/**
 * The choices whose words contain every space-separated term of the query,
 * those whose name or Japanese name starts with the query first.
 */
export function searchEmoji(choices: readonly EmojiChoice[], query: string): EmojiChoice[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  if (!terms.length) return []
  const matches = choices.filter((choice) => terms.every((term) => choice.words.includes(term)))
  const first = terms[0]
  const leading = (choice: EmojiChoice) => choice.name.startsWith(first) || choice.label.toLowerCase().startsWith(first)
  return [...matches.filter(leading), ...matches.filter((choice) => !leading(choice))]
}

const RECENT_KEY = 'gitlab-desktop.recentReactions'
const RECENT_LIMIT = 24

/** The names the user picked most recently, newest first. */
export function readRecentReactions(): string[] {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

export function rememberRecentReaction(name: string) {
  const next = [name, ...readRecentReactions().filter((recent) => recent !== name)].slice(0, RECENT_LIMIT)
  try { globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* Recent reactions are a convenience only. */ }
}

/** Common GitLab emoji names, shown before the full list has loaded; any other name is shown as `:name:`. */
const EMOJI: Record<string, string> = {
  '+1': '👍',
  '-1': '👎',
  '100': '💯',
  clap: '👏',
  confused: '😕',
  eyes: '👀',
  fire: '🔥',
  heart: '❤️',
  joy: '😂',
  laughing: '😆',
  ok_hand: '👌',
  pray: '🙏',
  raised_hands: '🙌',
  rocket: '🚀',
  slight_smile: '🙂',
  smile: '😄',
  smiley: '😃',
  sparkles: '✨',
  tada: '🎉',
  thinking: '🤔',
  thumbsdown: '👎',
  thumbsup: '👍',
  wave: '👋',
  white_check_mark: '✅',
  x: '❌',
}

export function emojiForName(name: string, loaded: EmojiCatalog | null = catalog): string {
  return loaded?.byName.get(name) ?? EMOJI[name] ?? `:${name}:`
}

export interface ReactionGroup {
  name: string
  users: AwardEmoji['user'][]
  mine: boolean
}

/** One entry per emoji, in the order each was first given. */
export function groupReactions(awards: readonly AwardEmoji[], currentUserId: string): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>()
  for (const award of awards) {
    const group = groups.get(award.name) ?? { mine: false, name: award.name, users: [] }
    group.users.push(award.user)
    if (award.user.id === currentUserId) group.mine = true
    groups.set(award.name, group)
  }
  return [...groups.values()]
}

/** The reactions after GitLab accepted the user adding or removing their own `name`. */
export function applyOwnReaction(awards: readonly AwardEmoji[], name: string, add: boolean, user: GitLabUser): AwardEmoji[] {
  const others = awards.filter((award) => !(award.name === name && award.user.id === user.id))
  return add ? [...others, { name, user }] : others
}
