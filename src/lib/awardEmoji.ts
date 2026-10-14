import type { AwardEmoji } from '../types/gitlab'

/** The reactions offered by 「リアクションを追加」, in GitLab's names. */
export const REACTION_CHOICES = ['thumbsup', 'thumbsdown', 'smile', 'tada', 'confused', 'heart', 'rocket', 'eyes'] as const

/** Common GitLab emoji names; any other name is shown as `:name:`. */
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

export function emojiForName(name: string): string {
  return EMOJI[name] ?? `:${name}:`
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
