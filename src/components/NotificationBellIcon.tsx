import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

function countLabel(count: number, more: boolean): string {
  return count > 9 ? '9+' : more ? `${count || ''}+` : String(count)
}

/** A small quiet tag in the place it belongs, rather than a badge on a corner. Narrow enough for "9+" in the collapsed navigation. */
function CountTag({ children }: { children: ReactNode }) {
  return <Box aria-hidden component="span" sx={{ alignItems: 'center', bgcolor: 'action.selected', borderRadius: 2, display: 'inline-flex', gap: 0.25, height: 20, justifyContent: 'center', minWidth: 20, px: 0.5, '&& .MuiSvgIcon-root': { fontSize: 14 } }}>{children}</Box>
}

/**
 * The notification bell. An empty bell means none. With notifications the bell is filled, and
 * `withCount` (where no label follows it, as in the collapsed navigation) puts it in a tag beside
 * the count. `more` adds "+" when further notifications were not loaded.
 * The count is decoration: the button around it names it for assistive technology.
 */
export function NotificationBellIcon({ count, more = false, withCount = true }: { count: number; more?: boolean; withCount?: boolean }) {
  if (count === 0 && !more) return <NotificationsNoneRoundedIcon />
  if (!withCount) return <NotificationsRoundedIcon />
  return <CountTag><NotificationsRoundedIcon /><Typography color="inherit" component="span" variant="iconCount">{countLabel(count, more)}</Typography></CountTag>
}

/** The count alone, at the end of a labelled row; nothing when there are none. */
export function NotificationCount({ count, more = false }: { count: number; more?: boolean }) {
  if (count === 0 && !more) return null
  return <CountTag><Typography color="inherit" component="span" variant="iconCount">{countLabel(count, more)}</Typography></CountTag>
}
