import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import type { Discussion } from '../../types/gitlab'
import { isUnresolvedDiscussion } from './discussionStatus'

/** Unresolved threads of the loaded discussions; choosing one scrolls the list to it. */
export function UnresolvedThreadNav({ discussions, olderNotLoaded, onSelect }: { discussions: Discussion[]; olderNotLoaded: boolean; onSelect: (discussionId: string) => void }) {
  const threads = discussions.filter(isUnresolvedDiscussion)
  return (
    <Stack aria-label="未解決のスレッド" component="nav" sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', borderBottom: 1, borderColor: 'divider', px: 1.25, py: 0.5 }}>
        <Typography color="text.secondary" variant="overline">未解決のスレッド</Typography>
        <Typography color="text.secondary" sx={{ ml: 'auto' }} variant="caption">{threads.length}件</Typography>
      </Stack>
      {threads.length === 0 ? <Typography color="text.secondary" sx={{ px: 1.25, py: 1 }} variant="caption">表示中の議論に未解決のスレッドはありません。</Typography> : (
        <List disablePadding sx={{ py: 0.5 }}>
          {threads.map((discussion) => {
            const first = discussion.notes.find((note) => !note.system)
            const position = discussion.notes.find((note) => note.position)?.position
            const place = position ? `${position.newPath.slice(position.newPath.lastIndexOf('/') + 1)}:${position.newLine ?? position.oldLine ?? 'file'}` : 'MR全体'
            return (
              <ListItemButton key={discussion.id} onClick={() => onSelect(discussion.id)} sx={{ alignItems: 'stretch', flexDirection: 'column', px: 1.25, py: 0.5 }}>
                <Typography color="text.secondary" noWrap sx={{ fontFamily: position ? 'typography.code.fontFamily' : undefined }} title={position?.newPath} variant="caption">{place}{first ? ` · ${first.author.name}` : ''}</Typography>
                <Typography sx={{ display: '-webkit-box', overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{first ? excerpt(first.body) : ''}</Typography>
              </ListItemButton>
            )
          })}
        </List>
      )}
      {olderNotLoaded ? <Typography color="text.secondary" sx={{ borderTop: 1, borderColor: 'divider', px: 1.25, py: 0.5 }} variant="caption">読み込んでいない以前の議論は含みません。</Typography> : null}
    </Stack>
  )
}

/** The start of a comment as plain text: link and emphasis markers are dropped. */
function excerpt(body: string): string {
  return body
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gmu, '')
    .replace(/[`*~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160)
}
