import Box from '@mui/material/Box'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import type { ReactNode } from 'react'

/** A place in the client's navigation: icon and label, or the icon alone with a tooltip while collapsed. */
export function ClientNavItem({ collapsed, disabled = false, icon, label, onClick, selected, title }: { collapsed: boolean; disabled?: boolean; icon: ReactNode; label: string; onClick: () => void; selected: boolean; title: string }) {
  // A disabled button gets no pointer events, so the tooltip listens on a wrapper.
  return <Tooltip placement="right" title={disabled ? 'GitLabに接続すると使えます' : collapsed || title !== label ? title : ''}>
    <Box component="span" sx={{ display: 'block' }}>
    <ListItemButton aria-current={selected ? 'page' : undefined} aria-label={title} disabled={disabled} onClick={onClick} selected={selected} sx={{ color: selected ? 'text.primary' : 'text.secondary', justifyContent: collapsed ? 'center' : 'initial', minHeight: 32, px: collapsed ? 0 : 1, py: 0.5, '&:hover': { color: 'text.primary' }, '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' }, '&.Mui-selected .MuiListItemIcon-root': { color: 'primary.main' } }}>
      <ListItemIcon sx={{ justifyContent: 'center', minWidth: collapsed ? 0 : 30, '& .MuiSvgIcon-root': { fontSize: 18 } }}>{icon}</ListItemIcon>
      {collapsed ? null : <ListItemText primary={label} slotProps={{ primary: { noWrap: true, sx: { fontWeight: selected ? 600 : 500 }, variant: 'body2' } }} sx={{ m: 0 }} />}
    </ListItemButton>
    </Box>
  </Tooltip>
}
