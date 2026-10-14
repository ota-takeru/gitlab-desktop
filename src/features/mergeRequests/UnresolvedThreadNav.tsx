import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { Discussion } from '../../types/gitlab'
import { isUnresolvedDiscussion } from './discussionStatus'
import { plainExcerpt } from './discussionText'

/** Unresolved threads of the loaded discussions; choosing one scrolls the list to it. */
export function UnresolvedThreadNav({ discussions, olderNotLoaded, onSelect }: { discussions: Discussion[]; olderNotLoaded: boolean; onSelect: (discussionId: string) => void }) {
  const threads = discussions.filter(isUnresolvedDiscussion)
  return (
    <Stack aria-label="未解決のスレッド" component="nav" sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', borderBottom: 1, borderColor: 'divider', px: 1.5, py: 0.5 }}>
        <Typography color="textSecondary" variant="overline">未解決のスレッド</Typography>
        <Typography color="textSecondary" sx={{ ml: 'auto' }} variant="caption">{threads.length}件</Typography>
      </Stack>
      {threads.length === 0 ? <Typography color="textSecondary" sx={{ px: 1.5, py: 1 }} variant="caption">表示中の議論に未解決のスレッドはありません。</Typography> : (
        <List disablePadding sx={{ py: 0.5 }}>
          {threads.map((discussion) => {
            const first = discussion.notes.find((note) => !note.system)
            const position = discussion.notes.find((note) => note.position)?.position
            const place = position ? `${position.newPath.slice(position.newPath.lastIndexOf('/') + 1)}:${position.newLine ?? position.oldLine ?? 'file'}` : 'MR全体'
            return (
              <ListItemButton key={discussion.id} onClick={() => onSelect(discussion.id)} sx={{ alignItems: 'stretch', flexDirection: 'column', px: 1.5, py: 0.5 }}>
                <Tooltip placement="left" title={`${position ? `${position.newPath}:${position.newLine ?? position.oldLine ?? 'file'}` : place}${first ? ` · ${first.author.name}` : ''}`}><Typography color="textSecondary" noWrap sx={{ fontFamily: position ? 'code.fontFamily' : undefined }} variant="caption">{place}{first ? ` · ${first.author.name}` : ''}</Typography></Tooltip>
                <Typography sx={{ display: '-webkit-box', overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{first ? plainExcerpt(first.body) : ''}</Typography>
              </ListItemButton>
            )
          })}
        </List>
      )}
      {olderNotLoaded ? <Typography color="textSecondary" sx={{ borderTop: 1, borderColor: 'divider', px: 1.5, py: 0.5 }} variant="caption">読み込んでいない以前の議論は含みません。</Typography> : null}
    </Stack>
  )
}

/** The arrows stay as small as the caption beside them, in a 24px target. */
const stepSx = { fontSize: 16, height: 24, width: 24 }

/** Compact previous/next unresolved thread control, usable at any width (also with P / N). */
export function UnresolvedThreadStepper({ count, onStep }: { count: number; onStep: (direction: 1 | -1) => void }) {
  return (
    <Stack aria-label="未解決のスレッドへ移動" direction="row" role="group" sx={{ alignItems: 'center', flexShrink: 0 }}>
      <Typography color="textSecondary" noWrap sx={{ pr: 0.25 }} variant="caption">未解決 {count}件</Typography>
      <Tooltip title="前の未解決スレッド (P)"><IconButton aria-label="前の未解決スレッド" aria-keyshortcuts="P" onClick={() => onStep(-1)} sx={stepSx}><KeyboardArrowUpRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
      <Tooltip title="次の未解決スレッド (N)"><IconButton aria-label="次の未解決スレッド" aria-keyshortcuts="N" onClick={() => onStep(1)} sx={stepSx}><KeyboardArrowDownRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
    </Stack>
  )
}
