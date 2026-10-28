import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'

import { useT } from '../i18n/useT'
import { applyOwnReaction, emojiForName, groupReactions, useEmojiCatalog } from '../lib/awardEmoji'
import type { AwardEmoji } from '../types/gitlab'
import { EmojiPicker } from './EmojiPicker'

interface SendingReaction {
  name: string
  add: boolean
  /** The reactions shown when it was sent; once they change, GitLab's answer has arrived. */
  base: readonly AwardEmoji[]
  /** GitLab accepted it; it stays shown, no longer as being sent, until the reactions are read back. */
  accepted: boolean
}

/**
 * Emoji reactions under a comment or a description: one chip per emoji with
 * its count (the user's own selected; the names in the tooltip) and a button
 * that opens the emoji picker. A chip toggles the user's own reaction.
 */
export function ReactionBar({ awards, currentUserId, disabled = false, label, onToggle }: {
  awards: readonly AwardEmoji[]
  currentUserId: string
  disabled?: boolean
  /** What the reactions belong to, for the add button's accessible name. */
  label: string
  /** Resolves to whether GitLab accepted the change; until then the chip already shows it, and reverts if refused. */
  onToggle: (name: string, add: boolean) => Promise<boolean> | void
}) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [sending, setSending] = useState<SendingReaction | null>(null)
  // Loaded here too, so reactions others gave with less common emoji display as emoji.
  const { catalog } = useEmojiCatalog()
  // The change shows at once, like GitLab's own page; the reactions read back from GitLab replace it.
  const pending = sending?.base === awards ? sending : null
  const shown = pending ? applyOwnReaction(awards, pending.name, pending.add, { id: currentUserId, name: t('common.reactions.you'), username: '' }) : awards
  const groups = groupReactions(shown, currentUserId)
  const mine = new Set(groups.filter((group) => group.mine).map((group) => group.name))
  const toggle = (name: string, add: boolean) => {
    const result = onToggle(name, add)
    if (!result) return
    setSending({ accepted: false, add, base: awards, name })
    void result.then((accepted) => setSending((current) => accepted && current ? { ...current, accepted } : null), () => setSending(null))
  }
  const choose = (name: string) => {
    setAnchor(null)
    toggle(name, !mine.has(name))
  }
  return <Stack direction="row" sx={{ alignItems: 'center', columnGap: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
    {groups.map((group) => {
      const emoji = emojiForName(group.name, catalog)
      const names = group.users.map((user) => user.name).join(t('common.list.separator'))
      const isSending = pending?.name === group.name && !pending.accepted
      return <Tooltip describeChild key={group.name} title={group.mine ? t('common.reactions.clickToRemove', { names }) : t('common.reactions.clickToAdd', { names })}>
        <Chip
          aria-busy={isSending || undefined}
          aria-label={t('common.reactions.chip', { emoji, count: group.users.length })}
          aria-pressed={group.mine}
          clickable
          color={group.mine ? 'primary' : 'default'}
          disabled={disabled}
          label={`${emoji} ${group.users.length}`}
          onClick={() => toggle(group.name, !group.mine)}
          size="small"
          variant="outlined"
        />
      </Tooltip>
    })}
    <Tooltip title={t('common.reactions.add')}>
      <span>
        <IconButton aria-haspopup="dialog" aria-label={t('common.reactions.addTo', { label })} disabled={disabled} onClick={(event) => setAnchor(event.currentTarget)} size="small">
          <AddReactionOutlinedIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <EmojiPicker anchorEl={anchor} label={label} mine={mine} onClose={() => setAnchor(null)} onPick={choose} />
  </Stack>
}
