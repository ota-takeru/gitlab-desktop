import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import MergeTypeOutlinedIcon from '@mui/icons-material/MergeTypeOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

export type PageKey =
  | 'overview'
  | 'merge-requests'
  | 'issues'
  | 'pipelines'
  | 'catalog'

interface AppShellProps {
  children: ReactNode
  mode: 'light' | 'dark'
  onModeChange: () => void
  onPageChange: (page: PageKey) => void
  page: PageKey
}

const primaryNav = [
  { key: 'overview', label: 'Overview', caption: '環境と入口', icon: InsightsOutlinedIcon },
  {
    key: 'merge-requests',
    label: 'Merge requests',
    caption: 'レビュー待ち',
    icon: MergeTypeOutlinedIcon,
  },
  { key: 'issues', label: 'Issues', caption: '課題を整理', icon: ReportProblemOutlinedIcon },
  { key: 'pipelines', label: 'Pipelines', caption: '実行履歴', icon: TimelineOutlinedIcon },
] as const satisfies ReadonlyArray<{
  key: PageKey
  label: string
  caption: string
  icon: typeof InsightsOutlinedIcon
}>

export function AppShell({
  children,
  mode,
  onModeChange,
  onPageChange,
  page,
}: AppShellProps) {
  return (
    <Box sx={{ bgcolor: 'background.default', display: 'flex', minHeight: '100vh' }}>
      <Drawer
        slotProps={{ paper: { component: 'aside' } }}
        sx={{
          flexShrink: 0,
          width: 248,
          '& .MuiDrawer-paper': {
            bgcolor: 'background.paper',
            borderColor: 'divider',
            boxSizing: 'border-box',
            width: 248,
          },
        }}
        variant="permanent"
      >
        <Stack sx={{ height: '100%', p: 2 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, py: 1.25 }}>
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: 'primary.main',
                borderRadius: 1.5,
                color: 'primary.contrastText',
                display: 'flex',
                height: 32,
                justifyContent: 'center',
                width: 32,
              }}
            >
              <HubOutlinedIcon fontSize="small" />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800 }} variant="body1">
                GitLab Desktop
              </Typography>
              <Typography color="text.secondary" variant="caption">
                personal client
              </Typography>
            </Box>
          </Stack>

          <Box component="nav" aria-label="Workspace navigation" sx={{ flex: 1, mt: 3 }}>
            <Typography
              color="text.secondary"
              sx={{ px: 1.5, mb: 1, textTransform: 'uppercase' }}
              variant="caption"
            >
              Workspace
            </Typography>
            <List disablePadding>
              {primaryNav.map(({ caption, icon: Icon, key, label }) => (
                <ListItemButton
                  aria-current={page === key ? 'page' : undefined}
                  key={key}
                  onClick={() => onPageChange(key)}
                  selected={page === key}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={label}
                    secondary={caption}
                    slotProps={{
                      primary: { sx: { fontSize: 13, fontWeight: 700 } },
                      secondary: { sx: { fontSize: 11 } },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />
            <Typography
              color="text.secondary"
              sx={{ px: 1.5, mb: 1, textTransform: 'uppercase' }}
              variant="caption"
            >
              Foundation
            </Typography>
            <List disablePadding>
              <ListItemButton
                aria-current={page === 'catalog' ? 'page' : undefined}
                onClick={() => onPageChange('catalog')}
                selected={page === 'catalog'}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <SettingsOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="UI catalog"
                  secondary="コンポーネント一覧"
                  slotProps={{
                    primary: { sx: { fontSize: 13, fontWeight: 700 } },
                    secondary: { sx: { fontSize: 11 } },
                  }}
                />
              </ListItemButton>
            </List>
          </Box>

          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              borderTop: 1,
              borderColor: 'divider',
              justifyContent: 'space-between',
              pt: 1.5,
              px: 1,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <DesktopWindowsOutlinedIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
              <Typography color="text.secondary" variant="caption">
                Rust + Tauri
              </Typography>
            </Stack>
            <Tooltip title={mode === 'dark' ? 'ライトモード' : 'ダークモード'}>
              <IconButton
                aria-label={mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
                onClick={onModeChange}
                size="small"
              >
                {mode === 'dark' ? (
                  <LightModeOutlinedIcon fontSize="small" />
                ) : (
                  <DarkModeOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Drawer>

      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
            display: 'flex',
            height: 64,
            justifyContent: 'space-between',
            px: { sm: 3, md: 5 },
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography color="text.secondary" variant="body2">
              Personal workspace
            </Typography>
            <Typography color="text.disabled" variant="body2">
              /
            </Typography>
            <Typography sx={{ fontWeight: 700 }} variant="body2">
              {page === 'catalog' ? 'UI catalog' : 'GitLab project space'}
            </Typography>
          </Stack>
          <Typography color="text.secondary" variant="caption">
            ローカル優先の開発中クライアント
          </Typography>
        </Box>
        <Box component="main" sx={{ flex: 1, px: { sm: 3, md: 5 }, py: 4 }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
