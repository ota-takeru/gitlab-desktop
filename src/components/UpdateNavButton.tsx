import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'

import { useT } from '../i18n/useT'

export interface UpdateNavButtonProps {
  collapsed: boolean
  /** Why installing must wait; the button stays visible but disabled. */
  disabledReason?: string
  onClick: () => void
  version: string
}

/** The navigation's install action for a found update: always in view, above the settings. */
export function UpdateNavButton({ collapsed, disabledReason, onClick, version }: UpdateNavButtonProps) {
  const t = useT()
  const label = t('common.update.navLabel', { version })
  const hint = disabledReason ?? t('common.update.installHint')
  return (
    <Tooltip placement="right" title={collapsed ? t('common.update.navTooltip', { label, hint }) : hint}>
      <Box component="span" sx={{ display: 'flex', flexShrink: 0, mt: 1 }}>
        <Button
          aria-label={t('common.update.navAriaLabel', { version })}
          disabled={Boolean(disabledReason)}
          fullWidth
          onClick={onClick}
          startIcon={collapsed ? undefined : <RestartAltRoundedIcon />}
          sx={collapsed ? { minWidth: 0, px: 0 } : { justifyContent: 'flex-start' }}
          variant="contained"
        >
          {collapsed ? <RestartAltRoundedIcon fontSize="small" /> : label}
        </Button>
      </Box>
    </Tooltip>
  )
}
