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

import type { MessageKey } from '../i18n/i18n'
import { hairline } from './hairline'
import { useT } from '../i18n/useT'
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
  { key: 'overview', label: 'common.shell.overview', icon: InsightsOutlinedIcon },
  { key: 'merge-requests', label: 'common.shell.mergeRequests', icon: RateReviewOutlinedIcon },
  { key: 'issues', label: 'common.shell.issues', icon: ReportProblemOutlinedIcon },
  { key: 'pipelines', label: 'common.shell.pipelines', icon: TimelineOutlinedIcon },
] as const satisfies ReadonlyArray<{ key: PageKey; label: MessageKey; icon: typeof InsightsOutlinedIcon }>

/** Development-only frame around the UI catalog, laid out like the client's navigation. */
export function AppShell({ children, mode, onModeChange, onPageChange, page }: AppShellProps) {
  const t = useT()
  return (
    <Box sx={{ bgcolor: 'background.default', display: 'flex', minHeight: '100vh' }}>
      <Box component="aside" sx={{ bgcolor: 'surface.nav', ...hairline('right', { position: false }), display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh', position: 'sticky', px: 1, py: 1, top: 0, width: 208 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 36, mb: 1, pl: 1 }}>
          <Typography component="div" noWrap variant="h3">GitLab Desktop</Typography>
        </Stack>
        <Box component="nav" aria-label={t('common.shell.devNavigation')} sx={{ flex: 1 }}>
          <List disablePadding>
            {primaryNav.map(({ icon: Icon, key, label }) => (
              <ClientNavItem collapsed={false} icon={<Icon />} key={key} label={t(label)} onClick={() => onPageChange(key)} selected={page === key} title={t(label)} />
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <List disablePadding>
            <ClientNavItem collapsed={false} icon={<WidgetsOutlinedIcon />} label={t('common.shell.catalog')} onClick={() => onPageChange('catalog')} selected={page === 'catalog'} title={t('common.shell.catalog')} />
          </List>
        </Box>
        <Stack direction="row" sx={{ alignItems: 'center', ...hairline('top'), justifyContent: 'space-between', pl: 1, pt: 1 }}>
          <Typography color="textSecondary" variant="caption">{t('common.shell.devScreen')}</Typography>
          <Tooltip title={mode === 'dark' ? t('common.shell.switchToLight') : t('common.shell.switchToDark')}>
            <IconButton aria-label={mode === 'dark' ? t('common.shell.switchToLight') : t('common.shell.switchToDark')} onClick={onModeChange}>
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
