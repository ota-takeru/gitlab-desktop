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
import { useReorder } from '../../components/useReorder'
import { useConnection } from '../connections/connectionContext'
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
  const tab = (ref: MrRef, pinned: boolean, reorder: Reorder) => <MergeRequestTab collapsed={collapsed} key={mrRefKey(ref)} meta={workspace.tabs[mrRefKey(ref)]} mrRef={ref} onClose={pinned ? undefined : () => close(ref)} onOpen={() => onOpen(ref)} onTogglePin={() => pinned ? workspace.unpinToOpen(ref) : workspace.togglePinned(ref)} pinned={pinned} reorder={reorder} selected={mrRefKey(ref) === selectedKey} />
  return <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, mx: -1, overflowX: 'hidden', overflowY: 'auto', px: 1 }}>
    {workspace.pinned.length ? <TabSection items={workspace.pinned} label="固定したMR" onMove={workspace.moveTab} subheader={collapsed ? <Divider component="li" sx={{ my: 1 }} /> : <SectionHeading>固定</SectionHeading>}>{(reorder) => workspace.pinned.map((ref) => tab(ref, true, reorder))}</TabSection> : null}
    <TabSection items={workspace.open} label="開いているMR" onMove={workspace.moveTab} subheader={collapsed ? <Divider component="li" sx={{ my: 1 }} /> : <SectionHeading action={workspace.open.length ? <Button onClick={closeAll} size="small" sx={{ minHeight: 24, minWidth: 0, px: 0.5 }}><Typography color="inherit" component="span" variant="caption">すべて閉じる</Typography></Button> : undefined}>開いているMR</SectionHeading>}>
      {(reorder) => <>
        {workspace.open.map((ref) => tab(ref, false, reorder))}
        {!collapsed && workspace.open.length === 0 ? <Typography color="textSecondary" component="li" sx={{ display: 'block', px: 1, py: 0.5 }} variant="caption">MRを開くとここにタブが並びます。</Typography> : null}
      </>}
    </TabSection>
  </Box>
}

export type Reorder = ReturnType<typeof useReorder>

/** One section of tabs, reordered by dragging a tab or with Alt+↑/↓. */
function TabSection({ children, items, label, onMove, subheader }: { children: (reorder: Reorder) => React.ReactNode; items: MrRef[]; label: string; onMove: (ref: MrRef, toIndex: number) => void; subheader: React.ReactNode }) {
  const keys = items.map(mrRefKey)
  const reorder = useReorder({ axis: 'y', keys, onMove: (key, toIndex) => { const ref = items.find((item) => mrRefKey(item) === key); if (ref) onMove(ref, toIndex) } })
  return <List aria-label={label} disablePadding {...reorder.containerProps} subheader={subheader}>{children(reorder)}</List>
}

function SectionHeading({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return <Stack component="li" direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 24, pl: 1, pt: 1.5 }}>
    <Typography color="textSecondary" variant="overline">{children}</Typography>
    {action}
  </Stack>
}

/** One sidebar tab; exported for the UI catalog. */
export function MergeRequestTab({ collapsed, meta, mrRef, onClose, onOpen, onTogglePin, pinned, reorder, selected }: { collapsed: boolean; meta?: TabMeta; mrRef: MrRef; onClose?: () => void; onOpen: () => void; onTogglePin: () => void; pinned: boolean; reorder: Reorder; selected: boolean }) {
  const name = meta?.title || `!${mrRef.iid}`
  // The last part of the project path tells similar titles apart without taking a line of its own.
  const project = meta?.projectPath ? meta.projectPath.slice(meta.projectPath.lastIndexOf('/') + 1) : ''
  const fullName = `${meta?.projectPath || `プロジェクト ${mrRef.projectId}`} !${mrRef.iid}${meta?.title ? ` ${meta.title}` : ''}`
  const selectedSx = { '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }
  if (collapsed) {
    return <Tooltip placement="right" title={fullName}>
      <ListItemButton aria-current={selected ? 'page' : undefined} aria-label={pinned ? `固定: ${fullName}` : fullName} onClick={onOpen} selected={selected} sx={{ color: selected ? 'text.primary' : 'text.secondary', flexDirection: 'column', minHeight: 36, position: 'relative', px: 0, py: 0.25, ...selectedSx }}>
        {/* Pinned tabs keep a pin mark, so they read apart from open ones when only the number fits. */}
        {pinned ? <PushPinIcon aria-hidden sx={{ color: 'primary.main', fontSize: 14, position: 'absolute', right: 0, top: 0 }} /> : null}
        {/* The state tells merged and open MRs apart even when only the number fits. */}
        {meta ? <MergeRequestStateIcon state={meta.state} /> : null}
        <Typography sx={{ fontFamily: 'code.fontFamily', fontWeight: selected ? 600 : 500, letterSpacing: 0, lineHeight: 1.4, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} variant="overline">{mrRef.iid}</Typography>
      </ListItemButton>
    </Tooltip>
  }
  const key = mrRefKey(mrRef)
  // The whole row, with its buttons, moves while dragged.
  const { style, ...item } = reorder.itemProps(key)
  const dragging = reorder.draggingKey === key
  return <Box component="li" style={style} sx={{ bgcolor: dragging ? 'surface.raised' : undefined, borderRadius: 1, boxShadow: dragging ? 4 : 'none', listStyle: 'none', position: 'relative', '&:hover .tab-actions, &:focus-within .tab-actions': { opacity: 1 } }}>
    <Tooltip enterDelay={600} placement="right" title={fullName}>
      <ListItemButton aria-current={selected ? 'page' : undefined} aria-description="Alt+↑/↓で並べ替え" aria-label={fullName} component="div" onClick={onOpen} selected={selected} {...item} sx={{ alignItems: 'flex-start', cursor: reorder.draggingKey ? 'grabbing' : undefined, color: selected ? 'text.primary' : 'text.secondary', gap: 1, minHeight: 30, pl: 1, pr: 0.5, py: 0.5, '&:hover': { color: 'text.primary' }, ...selectedSx }}>
        <Box sx={{ display: 'flex', flexShrink: 0, pt: 0.25 }}>{meta ? <MergeRequestStateIcon state={meta.state} /> : <Box sx={{ width: 16 }} />}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ display: '-webkit-box', fontSize: 'body2.fontSize', fontWeight: selected ? 600 : 500, lineHeight: 1.35, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>{name}</Typography>
          {project ? <Typography color="textSecondary" noWrap sx={{ lineHeight: 1.4, pr: onClose ? 6 : 3 }} variant="caption">{project} !{mrRef.iid}</Typography> : null}
        </Box>
      </ListItemButton>
    </Tooltip>
    <Stack className="tab-actions" data-no-reorder direction="row" sx={{ alignItems: 'center', bottom: 1, opacity: selected || pinned ? 1 : 0, position: 'absolute', right: 2, transition: 'opacity 100ms', '@media (hover: none)': { opacity: 1 }, '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
      <Tooltip title={pinned ? '固定を外す' : 'サイドバーに固定'}><IconButton aria-label={pinned ? `!${mrRef.iid}の固定を外す` : `!${mrRef.iid}をサイドバーに固定`} color={pinned ? 'primary' : 'default'} onClick={onTogglePin} size="small" sx={tabActionSx}>{pinned ? <PushPinIcon fontSize="inherit" /> : <PushPinOutlinedIcon fontSize="inherit" />}</IconButton></Tooltip>
      {onClose ? <Tooltip title="閉じる"><IconButton aria-label={`!${mrRef.iid}を閉じる`} onClick={onClose} size="small" sx={tabActionSx}><CloseRoundedIcon fontSize="inherit" /></IconButton></Tooltip> : null}
    </Stack>
  </Box>
}

/** Pin and close keep a small icon in a 24px target. */
const tabActionSx = { fontSize: 14, height: 24, width: 24 }
