import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Stack from '@mui/material/Stack'
import type { ReactNode } from 'react'

interface ListRowProps {
  selected?: boolean
  disabled?: boolean
  onOpen: () => void
  /** Main content of the row. It becomes the accessible name of the open button. */
  children: ReactNode
  /** Secondary actions. They appear on hover, focus or selection and never open the row. */
  actions?: ReactNode
  /** Leading visual such as a state marker. */
  leading?: ReactNode
  ariaLabel?: string
}

/**
 * One row of a list pane. The whole row opens the item; trailing actions sit
 * outside the open button so they never trigger navigation.
 */
export function ListRow({ selected = false, disabled = false, onOpen, children, actions, leading, ariaLabel }: ListRowProps) {
  return (
    <Box
      component="li"
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        listStyle: 'none',
        position: 'relative',
        '&:hover .list-row-actions, &:focus-within .list-row-actions': { opacity: 1 },
        '&::before': selected ? { bgcolor: 'primary.main', borderRadius: 1, bottom: 6, content: '""', left: 0, position: 'absolute', top: 6, width: 3 } : undefined,
      }}
    >
      <ButtonBase
        aria-current={selected ? 'true' : undefined}
        aria-label={ariaLabel}
        data-list-row="true"
        data-mr-open="true"
        data-selected={selected ? 'true' : undefined}
        disabled={disabled}
        onClick={onOpen}
        sx={{
          alignItems: 'flex-start',
          bgcolor: selected ? 'surface.selected' : 'transparent',
          display: 'flex',
          gap: 1,
          justifyContent: 'flex-start',
          px: 1.5,
          py: 1,
          textAlign: 'left',
          width: '100%',
          '&:hover': { bgcolor: selected ? 'surface.selected' : 'action.hover' },
          '&:focus-visible': { outlineOffset: -2 },
          '&.Mui-disabled': { opacity: 0.6 },
        }}
      >
        {leading ? <Box sx={{ display: 'flex', flexShrink: 0, pt: 0.25 }}>{leading}</Box> : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </ButtonBase>
      {actions ? (
        <Stack className="list-row-actions" direction="row" sx={{ alignItems: 'center', bgcolor: 'surface.raised', border: 1, borderColor: 'divider', borderRadius: 1, bottom: 6, opacity: 0, position: 'absolute', right: 8, transition: 'opacity 100ms', '@media (hover: none)': { opacity: 1 } }}>
          {actions}
        </Stack>
      ) : null}
    </Box>
  )
}
