import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'

import { emojiForName, groupReactions, useEmojiCatalog } from '../lib/awardEmoji'
import type { AwardEmoji } from '../types/gitlab'
import { EmojiPicker } from './EmojiPicker'

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
  onToggle: (name: string, add: boolean) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // Loaded here too, so reactions others gave with less common emoji display as emoji.
  const { catalog } = useEmojiCatalog()
  const groups = groupReactions(awards, currentUserId)
  const mine = new Set(groups.filter((group) => group.mine).map((group) => group.name))
  const choose = (name: string) => {
    setAnchor(null)
    onToggle(name, !mine.has(name))
  }
  return <Stack direction="row" sx={{ alignItems: 'center', columnGap: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
    {groups.map((group) => {
      const emoji = emojiForName(group.name, catalog)
      const names = group.users.map((user) => user.name).join('、')
      return <Tooltip describeChild key={group.name} title={`${names}${group.mine ? '（クリックで外す）' : '（クリックで付ける）'}`}>
        <Chip
          aria-label={`${emoji} ${group.users.length}人`}
          aria-pressed={group.mine}
          clickable
          color={group.mine ? 'primary' : 'default'}
          disabled={disabled}
          label={`${emoji} ${group.users.length}`}
          onClick={() => onToggle(group.name, !group.mine)}
          size="small"
          variant="outlined"
        />
      </Tooltip>
    })}
    <Tooltip title="リアクションを追加">
      <span>
        <IconButton aria-haspopup="dialog" aria-label={`${label}にリアクションを追加`} disabled={disabled} onClick={(event) => setAnchor(event.currentTarget)} size="small">
          <AddReactionOutlinedIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <EmojiPicker anchorEl={anchor} label={label} mine={mine} onClose={() => setAnchor(null)} onPick={choose} />
  </Stack>
}
