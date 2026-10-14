import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'

import { REACTION_CHOICES, emojiForName, groupReactions } from '../lib/awardEmoji'
import type { AwardEmoji } from '../types/gitlab'

/**
 * Emoji reactions under a comment or a description: one chip per emoji with
 * its count (the user's own selected; the names in the tooltip) and a button
 * that offers the common reactions. A chip toggles the user's own reaction.
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
  const groups = groupReactions(awards, currentUserId)
  const choose = (name: string) => {
    setAnchor(null)
    onToggle(name, !groups.some((group) => group.name === name && group.mine))
  }
  return <Stack direction="row" sx={{ alignItems: 'center', columnGap: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
    {groups.map((group) => {
      const emoji = emojiForName(group.name)
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
        <IconButton aria-haspopup="menu" aria-label={`${label}にリアクションを追加`} disabled={disabled} onClick={(event) => setAnchor(event.currentTarget)} size="small">
          <AddReactionOutlinedIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <Menu anchorEl={anchor} onClose={() => setAnchor(null)} open={Boolean(anchor)}>
      {REACTION_CHOICES.map((name) => {
        const mine = groups.some((group) => group.name === name && group.mine)
        return <MenuItem key={name} onClick={() => choose(name)} selected={mine}>{emojiForName(name)} {name}{mine ? '（付けています）' : ''}</MenuItem>
      })}
    </Menu>
  </Stack>
}
