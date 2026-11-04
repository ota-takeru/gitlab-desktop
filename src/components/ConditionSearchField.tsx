import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, RefObject } from 'react'

import { panelFrame } from './hairline'

/** An applied condition, shown as a tag in the field: the tag opens its editor, ✕ removes it. */
export interface ConditionTag {
  key: string
  label: string
  code?: boolean
  onOpen?: (event: MouseEvent<HTMLElement>) => void
  /** Without it the tag is fixed, such as the list's own project, and neutral in colour. */
  onRemove?: () => void
  removeLabel?: string
}

/** Conditions that can be added, listed when the field is clicked or on Down. */
interface ConditionMenu<Kind extends string> {
  id: string
  label: string
  title: string
  options: readonly { kind: Kind; label: string }[]
  onChoose: (kind: Kind, anchor: HTMLElement) => void
}

interface ConditionSearchFieldProps<Kind extends string> {
  appliedLabel?: string
  inputRef: RefObject<HTMLInputElement | null>
  label: string
  /** Without it the field is a plain search box. */
  menu?: ConditionMenu<Kind>
  onChange: (value: string) => void
  placeholder: string
  readOnly?: boolean
  submitLabel: string
  submitTooltip: string
  tags?: readonly ConditionTag[]
  value: string
}

/** The search field of a list: a word, applied conditions as tags inside it, and a menu of conditions to add. Goes inside the list's form. */
export function ConditionSearchField<Kind extends string>({ appliedLabel, inputRef, label, menu, onChange, placeholder, readOnly, submitLabel, submitTooltip, tags = [], value }: ConditionSearchFieldProps<Kind>) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [opened, setOpened] = useState<{ anchor: HTMLElement; keyboard: boolean; width: number } | null>(null)
  const openedAnchor = opened?.anchor
  useEffect(() => {
    // The options stay as wide as the field when the pane is resized while they are open.
    if (!openedAnchor || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setOpened((current) => current && current.width !== openedAnchor.clientWidth ? { ...current, width: openedAnchor.clientWidth } : current))
    observer.observe(openedAnchor)
    return () => observer.disconnect()
  }, [openedAnchor])
  const open = (keyboard: boolean) => {
    const anchor = fieldRef.current
    if (anchor && menu?.options.length) setOpened({ anchor, keyboard, width: anchor.clientWidth })
  }
  // The options close when focus leaves both the field and the options.
  const closeOnBlur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null
    if (next && (fieldRef.current?.contains(next) || optionsRef.current?.contains(next))) return
    setOpened(null)
  }
  return <>
    <TextField
      fullWidth
      inputRef={inputRef}
      onChange={(event) => {
        setOpened(null)
        onChange(event.target.value)
      }}
      placeholder={placeholder}
      ref={fieldRef}
      slotProps={{
        htmlInput: menu ? {
          // A text field that opens the conditions menu; as a combobox its open state may be announced.
          role: 'combobox',
          'aria-controls': opened ? menu.id : undefined,
          'aria-expanded': Boolean(opened),
          'aria-haspopup': 'menu',
          'aria-label': label,
          readOnly,
          onBlur: closeOnBlur,
          onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              open(true)
            } else if (event.key === 'Escape') setOpened(null)
          },
        } : { 'aria-label': label },
        input: {
          // Clicking the field, but not a tag in it, lists the conditions that can be added.
          onClick: menu ? (event) => { if (!(event.target as Element).closest('.MuiChip-root, button')) open(false) } : undefined,
          startAdornment: <>
            <InputAdornment position="start"><SearchRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} /></InputAdornment>
            {tags.length ? <Box aria-label={appliedLabel} role="group" sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: '100%', mr: 0.5, py: 0.5 }}>
              {tags.map((tag) => <Chip color={tag.onRemove ? 'primary' : 'default'} deleteIcon={tag.onRemove ? <CancelRoundedIcon aria-label={tag.removeLabel} /> : undefined} key={tag.key} label={tag.label} onClick={tag.onOpen} onDelete={tag.onRemove} size="small" sx={{ fontFamily: tag.code ? 'code.fontFamily' : undefined, maxWidth: '100%' }} variant="outlined" />)}
            </Box> : null}
          </>,
          endAdornment: <InputAdornment position="end"><Tooltip title={submitTooltip}><IconButton aria-label={submitLabel} edge="end" type="submit"><KeyboardReturnRoundedIcon /></IconButton></Tooltip></InputAdornment>,
          sx: { flexWrap: 'wrap', '& .MuiInputBase-input': { flex: 1, minWidth: 160, width: 'auto' } },
        },
      }}
      value={value}
    />
    {menu ? <Popper anchorEl={opened?.anchor} open={Boolean(opened)} placement="bottom-start" sx={{ maxWidth: 'calc(100vw - 16px)', width: opened?.width, zIndex: 'modal' }}>
      <Paper ref={optionsRef} sx={{ ...panelFrame(), boxShadow: 8, mt: 0.5, py: 0.5 }}>
        <Typography color="textSecondary" sx={{ display: 'block', px: 1.5 }} variant="overline">{menu.title}</Typography>
        <MenuList
          aria-label={menu.label}
          autoFocusItem={opened?.keyboard}
          dense
          id={menu.id}
          onBlur={closeOnBlur}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            setOpened(null)
            inputRef.current?.focus()
          }}
        >
          {menu.options.map(({ kind, label: optionLabel }) => <MenuItem key={kind} onClick={() => {
            setOpened(null)
            if (opened) menu.onChoose(kind, opened.anchor)
          }}>{optionLabel}</MenuItem>)}
        </MenuList>
      </Paper>
    </Popper> : null}
  </>
}
