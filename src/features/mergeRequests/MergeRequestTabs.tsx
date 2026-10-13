import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { MergeRequestStateIcon } from '../../components/MergeRequestStateIcon'
import { useConnection } from '../connections/ConnectionProvider'
import { mrRefKey, usePersonalWorkspace, type MrRef, type TabMeta } from '../shared/personalWorkspace'

/**
 * Open and pinned MRs as tabs in the navigation, like Arc's sidebar: pinned
 * tabs stay at the top, MRs opened from anywhere are added below them.
 */
export function MergeRequestTabs({ collapsed, onOpen, selected }: { collapsed: boolean; onOpen: (ref: MrRef | null) => void; selected: MrRef | null }) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  if (!session) return null
  const selectedKey = selected ? mrRefKey(selected) : null
  const close = (ref: MrRef) => {
    // Closing the shown MR shows its neighbour, as a browser does.
    if (mrRefKey(ref) === selectedKey) {
      const index = workspace.open.findIndex((item) => mrRefKey(item) === selectedKey)
      onOpen(workspace.open[index + 1] ?? workspace.open[index - 1] ?? null)
    }
    workspace.closeTab(ref)
  }
  const closeAll = () => {
    if (selectedKey && workspace.open.some((item) => mrRefKey(item) === selectedKey)) onOpen(null)
    workspace.closeAllTabs()
  }
  const tab = (ref: MrRef, pinned: boolean) => <MergeRequestTab collapsed={collapsed} key={mrRefKey(ref)} meta={workspace.tabs[mrRefKey(ref)]} mrRef={ref} onClose={pinned ? undefined : () => close(ref)} onOpen={() => onOpen(ref)} onTogglePin={() => pinned ? workspace.unpinToOpen(ref) : workspace.togglePinned(ref)} pinned={pinned} selected={mrRefKey(ref) === selectedKey} />
  return <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    {workspace.pinned.length ? <List aria-label="固定したMR" disablePadding subheader={collapsed ? <Divider component="li" sx={{ my: 1 }} /> : <SectionHeading>固定</SectionHeading>}>{workspace.pinned.map((ref) => tab(ref, true))}</List> : null}
    <List aria-label="開いているMR" disablePadding subheader={collapsed ? <Divider component="li" sx={{ my: 1 }} /> : <SectionHeading action={workspace.open.length ? <Button onClick={closeAll} size="small" sx={{ fontSize: 11, minHeight: 0, minWidth: 0, px: 0.5, py: 0 }}>すべて閉じる</Button> : undefined}>開いているMR</SectionHeading>}>
      {workspace.open.map((ref) => tab(ref, false))}
      {!collapsed && workspace.open.length === 0 ? <Typography color="text.secondary" component="li" sx={{ display: 'block', fontSize: 11, px: 1, py: 0.5 }}>MRを開くとここにタブが並びます。</Typography> : null}
    </List>
  </Box>
}

function SectionHeading({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return <Stack component="li" direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 24, pl: 1, pt: 1.5 }}>
    <Typography color="text.secondary" sx={{ fontSize: 11, fontWeight: 600 }}>{children}</Typography>
    {action}
  </Stack>
}

function MergeRequestTab({ collapsed, meta, mrRef, onClose, onOpen, onTogglePin, pinned, selected }: { collapsed: boolean; meta?: TabMeta; mrRef: MrRef; onClose?: () => void; onOpen: () => void; onTogglePin: () => void; pinned: boolean; selected: boolean }) {
  const name = meta?.title || `!${mrRef.iid}`
  const fullName = `${meta?.projectPath || `プロジェクト ${mrRef.projectId}`} !${mrRef.iid}${meta?.title ? ` ${meta.title}` : ''}`
  const selectedSx = { '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }
  if (collapsed) {
    return <Tooltip placement="right" title={fullName}>
      <ListItemButton aria-current={selected ? 'page' : undefined} aria-label={fullName} onClick={onOpen} selected={selected} sx={{ color: selected ? 'text.primary' : 'text.secondary', flexDirection: 'column', minHeight: 32, px: 0, py: 0.25, ...selectedSx }}>
        <Typography sx={{ fontFamily: 'typography.code.fontFamily', fontSize: 10.5, fontWeight: selected ? 600 : 500, lineHeight: 1.4, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mrRef.iid}</Typography>
      </ListItemButton>
    </Tooltip>
  }
  return <Box component="li" sx={{ listStyle: 'none', position: 'relative', '&:hover .tab-actions, &:focus-within .tab-actions': { opacity: 1 } }}>
    <Tooltip enterDelay={600} placement="right" title={fullName}>
      <ListItemButton aria-current={selected ? 'page' : undefined} aria-label={fullName} component="div" onClick={onOpen} selected={selected} sx={{ color: selected ? 'text.primary' : 'text.secondary', gap: 0.75, minHeight: 30, pl: 1, pr: onClose ? 7 : 4, py: 0.25, '&:hover': { color: 'text.primary' }, ...selectedSx }}>
        {meta ? <MergeRequestStateIcon state={meta.state} /> : <Box sx={{ width: 16 }} />}
        <Typography noWrap sx={{ flex: 1, fontSize: 12.5, fontWeight: selected ? 600 : 500, minWidth: 0 }}>{name}</Typography>
      </ListItemButton>
    </Tooltip>
    <Stack className="tab-actions" direction="row" sx={{ alignItems: 'center', opacity: selected ? 1 : 0, position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', transition: 'opacity 100ms', '@media (hover: none)': { opacity: 1 } }}>
      <Tooltip title={pinned ? '固定を解除' : '固定'}><IconButton aria-label={`!${mrRef.iid}を${pinned ? '固定解除' : '固定'}`} color={pinned ? 'primary' : 'default'} onClick={onTogglePin} size="small">{pinned ? <PushPinIcon sx={{ fontSize: 14 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 14 }} />}</IconButton></Tooltip>
      {onClose ? <Tooltip title="閉じる"><IconButton aria-label={`!${mrRef.iid}を閉じる`} onClick={onClose} size="small"><CloseRoundedIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip> : null}
    </Stack>
  </Box>
}
