import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Stack from '@mui/material/Stack'
import type { ReactNode } from 'react'
import { paneGutter } from './paneSx'

interface ListRowProps {
  selected?: boolean
  disabled?: boolean
  onOpen: () => void
  /** Main content of the row. It becomes the accessible name of the open button. */
  children: ReactNode
  /** Secondary actions. They appear on hover or focus and never open the row. */
  actions?: ReactNode
  /** An action that stays visible, to the right of the others, because it also shows a state (such as a pinned row's pin). */
  stickyActions?: ReactNode
  /** Space on the row shows a preview instead of opening it. */
  onPreview?: () => void
  onFocus?: () => void
  /** The row whose preview is shown beside the list. */
  previewing?: boolean
  /** Leading visual such as a state marker. */
  leading?: ReactNode
  ariaLabel?: string
  /** The MR the row opens, as `<projectId>-<iid>`, so the list can find the row again on return. */
  mrId?: string
  /**
   * Keeps room for one action button on the right of the content, so revealed actions never cover its text.
   * On by default when the row has actions; turn it off when the content reserves its own room.
   */
  reserveActionsSpace?: boolean
}

/**
 * One row of a list pane. The whole row opens the item; trailing actions sit
 * outside the open button so they never trigger navigation.
 */
export function ListRow({ selected = false, disabled = false, onOpen, children, actions, stickyActions, onPreview, onFocus, previewing = false, leading, ariaLabel, mrId, reserveActionsSpace = true }: ListRowProps) {
  const reserve = reserveActionsSpace && Boolean(actions || stickyActions)
  return (
    <Box
      component="li"
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        listStyle: 'none',
        position: 'relative',
        '&:hover .list-row-actions, &:focus-within .list-row-actions': { bgcolor: 'surface.raised', borderColor: 'divider' },
        '&:hover .list-row-hover-actions, &:focus-within .list-row-hover-actions': { maxWidth: 240, opacity: 1 },
        // The previewed row keeps its buttons where they were, so the one that opened the preview closes it without moving the pointer.
        ...(previewing ? { '& .list-row-actions': { bgcolor: 'surface.raised', borderColor: 'divider' }, '& .list-row-hover-actions': { maxWidth: 240, opacity: 1 } } : {}),
        // Selected is a solid bar; previewed is a dashed outline, so the two differ in shape as well as colour.
        '&::before': selected ? { bgcolor: 'primary.main', borderRadius: 1, bottom: 6, content: '""', left: 0, position: 'absolute', top: 6, width: 3 } : undefined,
        '&::after': previewing ? { border: 1, borderColor: 'text.secondary', borderRadius: 1, borderStyle: 'dashed', content: '""', inset: 2, pointerEvents: 'none', position: 'absolute' } : undefined,
      }}
    >
      <ButtonBase
        aria-current={selected ? 'true' : undefined}
        aria-label={ariaLabel}
        data-list-row="true"
        data-mr-id={mrId}
        data-mr-open="true"
        data-selected={selected ? 'true' : undefined}
        disabled={disabled}
        onClick={onOpen}
        onFocus={onFocus}
        // A button opens on the release of Space, so both halves of the key press are taken.
        onKeyDown={onPreview ? (event) => { if (event.key === ' ') { event.preventDefault(); onPreview() } } : undefined}
        onKeyUp={onPreview ? (event) => { if (event.key === ' ') event.preventDefault() } : undefined}
        sx={{
          alignItems: 'flex-start',
          bgcolor: selected ? 'surface.selected' : previewing ? 'action.hover' : 'transparent',
          display: 'flex',
          gap: 1,
          justifyContent: 'flex-start',
          px: paneGutter,
          py: 1,
          textAlign: 'left',
          width: '100%',
          '&:hover': { bgcolor: selected ? 'surface.selected' : 'action.hover' },
          '&:focus-visible': { outlineOffset: -2 },
          '&.Mui-disabled': { opacity: 0.6 },
        }}
      >
        {leading ? <Box sx={{ display: 'flex', flexShrink: 0, pt: 0.25 }}>{leading}</Box> : null}
        <Box sx={{ flex: 1, minWidth: 0, pr: reserve ? ACTIONS_SPACE : 0 }}>{children}</Box>
      </ButtonBase>
      {actions || stickyActions ? (
        <Stack className="list-row-actions" direction="row" sx={{ alignItems: 'center', border: 1, borderColor: 'transparent', borderRadius: 1, bottom: 6, position: 'absolute', right: 8 }}>
          {/* Hidden by width rather than display, so keyboard focus can still reach them. */}
          {actions ? <Stack className="list-row-hover-actions" direction="row" sx={{ alignItems: 'center', maxWidth: 0, opacity: 0, overflow: 'hidden', transition: 'opacity 100ms', '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, '@media (hover: none)': { maxWidth: 240, opacity: 1 } }}>{actions}</Stack> : null}
          {stickyActions}
        </Stack>
      ) : null}
    </Box>
  )
}

/** One 32px action button with its border and the 8px inset, less the row's own 16px padding, plus a gap. */
const ACTIONS_SPACE = 4.5
