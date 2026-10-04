import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined'
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined'
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

export type MockSection = 'review' | 'projects' | 'search' | 'catalog'

interface MockSidebarProps {
  collapsed?: boolean
  mode: 'light' | 'dark'
  section: MockSection
  onModeChange: () => void
  onSectionChange: (section: MockSection) => void
  onBackToFoundation: () => void
  onToggleCollapsed?: () => void
}

const navigation = [
  { key: 'review' as const, label: 'レビュー', caption: '確認が必要なMR', icon: RateReviewOutlinedIcon },
  { key: 'projects' as const, label: 'プロジェクト', caption: '対象を切り替える', icon: FolderOpenOutlinedIcon },
  { key: 'search' as const, label: 'MRを検索', caption: '過去の変更を探す', icon: SearchOutlinedIcon },
]

export function MockSidebar({
  collapsed = false,
  mode,
  section,
  onModeChange,
  onSectionChange,
  onBackToFoundation,
  onToggleCollapsed,
}: MockSidebarProps) {
  return (
    <Box
      component="aside"
      sx={{
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        width: collapsed ? 48 : 152,
        '@media (max-width: 1100px)': { width: 48 },
      }}
    >
      <Stack sx={{ minHeight: 0, p: 1, flex: 1 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            minHeight: 36,
            px: 0.5,
            py: 0.25,
            '@media (max-width: 1100px)': { display: 'none' },
          }}
        >
          {!collapsed ? <Typography noWrap sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold', minWidth: 0 }}>GitLab Desktop</Typography> : null}
          <Tooltip title={collapsed ? 'ナビゲーションを展開' : 'ナビゲーションを折りたたむ'}>
            <IconButton
              aria-label={collapsed ? 'ナビゲーションを展開' : 'ナビゲーションを折りたたむ'}
              onClick={onToggleCollapsed}
              size="small"
            >
              {collapsed ? <ChevronRightOutlinedIcon sx={{ fontSize: 18 }} /> : <ChevronLeftOutlinedIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Box component="nav" aria-label="モック画面のナビゲーション" sx={{ mt: 0.75 }}>
          <List disablePadding>
            {navigation.map(({ caption, icon: Icon, key, label }) => (
              <Tooltip key={key} placement="right" title={label} disableHoverListener={false}>
                <ListItemButton
                  aria-current={section === key ? 'page' : undefined}
                  aria-label={`${label} ${caption}`}
                  onClick={() => onSectionChange(key)}
                  selected={section === key}
                  sx={{
                    minHeight: 36,
                    px: 1,
                    py: 0,
                    '&.Mui-selected': {
                      bgcolor: 'action.selected',
                      color: 'primary.main',
                    },
                    ...(collapsed ? { justifyContent: 'center', px: 0 } : {}),
                    '@media (max-width: 1100px)': { justifyContent: 'center', px: 0 },
                  }}
                >
                  <ListItemIcon sx={{ color: 'inherit', minWidth: 30, '@media (max-width: 1100px)': { minWidth: 0 }, ...(collapsed ? { minWidth: 0 } : {}) }}>
                    <Icon sx={{ fontSize: 19 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={label}
                    sx={{ m: 0, ...(collapsed ? { display: 'none' } : {}), '@media (max-width: 1100px)': { display: 'none' } }}
                    slotProps={{ primary: { sx: { fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' } } }}
                  />
                </ListItemButton>
              </Tooltip>
            ))}
          </List>
        </Box>

        <Box sx={{ flex: 1 }} />
        <Tooltip placement="right" title="UIカタログ">
          <ListItemButton
            aria-current={section === 'catalog' ? 'page' : undefined}
            aria-label="UIカタログ 共通パターン"
            onClick={() => onSectionChange('catalog')}
            selected={section === 'catalog'}
            sx={{ color: 'text.secondary', flex: '0 0 auto', minHeight: 36, px: 1, py: 0, ...(collapsed ? { justifyContent: 'center', px: 0 } : {}), '@media (max-width: 1100px)': { justifyContent: 'center', px: 0 } }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: 30, '@media (max-width: 1100px)': { minWidth: 0 }, ...(collapsed ? { minWidth: 0 } : {}) }}>
              <BookmarkBorderOutlinedIcon sx={{ fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary="UIカタログ"
              sx={{ m: 0, ...(collapsed ? { display: 'none' } : {}), '@media (max-width: 1100px)': { display: 'none' } }}
              slotProps={{ primary: { sx: { fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' } } }}
            />
          </ListItemButton>
        </Tooltip>
      </Stack>

      <Stack spacing={0.5} sx={{ borderTop: 1, borderColor: 'divider', p: 0.5 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            ...(collapsed ? { flexDirection: 'column' } : {}),
            '@media (max-width: 1100px)': { flexDirection: 'column', justifyContent: 'center' },
          }}
        >
          <Tooltip title="基盤画面へ戻る">
            <IconButton aria-label="基盤画面へ戻る" onClick={onBackToFoundation} size="small">
              <HistoryOutlinedIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={mode === 'dark' ? 'ライトモード' : 'ダークモード'}>
            <IconButton
              aria-label={mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
              onClick={onModeChange}
              size="small"
            >
              {mode === 'dark' ? <LightModeOutlinedIcon sx={{ fontSize: 17 }} /> : <DarkModeOutlinedIcon sx={{ fontSize: 17 }} />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  )
}
