import Box from '@mui/material/Box'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import { alpha } from '@mui/material/styles'
import type { MouseEvent, ReactNode } from 'react'

import type { PlacePalette } from '../theme'

/**
 * A place in the client's navigation: icon and label, or the icon alone with a tooltip while collapsed.
 * With `expanded` it opens a panel over the page instead of going to a place.
 * `trailing` sits at the end of the row while the label shows, such as a count.
 * `place` colours the icon, and the selected row with a tint of it, so each place is found by colour too.
 */
export function ClientNavItem({ collapsed, disabled = false, expanded, icon, label, onClick, place, selected, title, trailing }: { collapsed: boolean; disabled?: boolean; expanded?: boolean; icon: ReactNode; label: string; onClick: (event: MouseEvent<HTMLElement>) => void; place?: keyof PlacePalette; selected: boolean; title: string; trailing?: ReactNode }) {
  // A disabled button gets no pointer events, so the tooltip listens on a wrapper.
  return <Tooltip placement="right" title={disabled ? 'GitLabに接続すると使えます' : collapsed || title !== label ? title : ''}>
    <Box component="span" sx={{ display: 'block' }}>
    <ListItemButton aria-current={selected && expanded === undefined ? 'page' : undefined} aria-expanded={expanded} aria-haspopup={expanded === undefined ? undefined : 'dialog'} aria-label={title} disabled={disabled} onClick={onClick} selected={selected} sx={{ color: selected ? 'text.primary' : 'text.secondary', justifyContent: collapsed ? 'center' : 'initial', minHeight: 32, px: collapsed ? 0 : 1, py: 0.5, '&:hover': { color: 'text.primary' }, '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' }, '&.Mui-selected .MuiListItemIcon-root': { color: 'primary.main' }, ...(place ? { '& .MuiListItemIcon-root, &.Mui-selected .MuiListItemIcon-root': { color: `place.${place}` }, '&.Mui-selected, &.Mui-selected:hover': { bgcolor: (theme) => theme.palette.place ? alpha(theme.palette.place[place], 0.14) : theme.palette.action.selected } } : {}) }}>
      <ListItemIcon sx={{ justifyContent: 'center', minWidth: collapsed ? 0 : 30, '& .MuiSvgIcon-root': { fontSize: 18 } }}>{icon}</ListItemIcon>
      {collapsed ? null : <ListItemText primary={label} slotProps={{ primary: { noWrap: true, sx: { fontWeight: selected ? 600 : 500 }, variant: 'body2' } }} sx={{ m: 0 }} />}
      {collapsed || !trailing ? null : <Box component="span" sx={{ display: 'flex', flexShrink: 0, ml: 1 }}>{trailing}</Box>}
    </ListItemButton>
    </Box>
  </Tooltip>
}
