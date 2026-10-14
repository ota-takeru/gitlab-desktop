import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined'
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

import { ClientNavItem } from './ClientNavItem'

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
  { key: 'overview', label: '概要', icon: InsightsOutlinedIcon },
  { key: 'merge-requests', label: 'MR', icon: RateReviewOutlinedIcon },
  { key: 'issues', label: 'イシュー', icon: ReportProblemOutlinedIcon },
  { key: 'pipelines', label: 'パイプライン', icon: TimelineOutlinedIcon },
] as const satisfies ReadonlyArray<{ key: PageKey; label: string; icon: typeof InsightsOutlinedIcon }>

/** Development-only frame around the UI catalog, laid out like the client's navigation. */
export function AppShell({ children, mode, onModeChange, onPageChange, page }: AppShellProps) {
  return (
    <Box sx={{ bgcolor: 'background.default', display: 'flex', minHeight: '100vh' }}>
      <Box component="aside" sx={{ bgcolor: 'surface.nav', borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh', position: 'sticky', px: 1, py: 1, top: 0, width: 208 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 36, mb: 1, pl: 1 }}>
          <Typography component="div" noWrap variant="h3">GitLab Desktop</Typography>
        </Stack>
        <Box component="nav" aria-label="開発用ナビゲーション" sx={{ flex: 1 }}>
          <List disablePadding>
            {primaryNav.map(({ icon: Icon, key, label }) => (
              <ClientNavItem collapsed={false} icon={<Icon />} key={key} label={label} onClick={() => onPageChange(key)} selected={page === key} title={label} />
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <List disablePadding>
            <ClientNavItem collapsed={false} icon={<WidgetsOutlinedIcon />} label="UIカタログ" onClick={() => onPageChange('catalog')} selected={page === 'catalog'} title="UIカタログ" />
          </List>
        </Box>
        <Stack direction="row" sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', justifyContent: 'space-between', pl: 1, pt: 1 }}>
          <Typography color="textSecondary" variant="caption">開発用の画面</Typography>
          <Tooltip title={mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}>
            <IconButton aria-label={mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'} onClick={onModeChange}>
              {mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { md: 3, xs: 2 }, py: 3 }}>
        {children}
      </Box>
    </Box>
  )
}
