import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTheme, type Theme } from '@mui/material/styles'
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { useT } from '../i18n/useT'
import { hairline } from './hairline'
import { EMOJI_CATEGORIES, REACTION_CHOICES, readRecentReactions, rememberRecentReaction, searchEmoji, useEmojiCatalog, type EmojiCatalog, type EmojiChoice } from '../lib/awardEmoji'
import { Row } from './Row'

const COLUMNS = 9
const CELL = 34
/** The cells a tab shows before it is scrolled: the grid's seven visible rows and one more. */
const FIRST_CELLS = COLUMNS * 8
/** One emoji per category for its tab, in EMOJI_CATEGORIES order. */
const CATEGORY_ICONS = ['😀', '🙋', '🐱', '🍔', '🚗', '⚽', '💡', '💕']
const RECENT = 'recent'

/**
 * Picks an emoji reaction: a search over GitLab's names and Japanese words,
 * category tabs and a grid. The user's own reactions are marked; picking one
 * of them asks the caller to remove it. Arrow keys move through the grid.
 */
export function EmojiPicker({ anchorEl, keepFocus = false, label, mine, onClose, onPick }: {
  anchorEl: HTMLElement | null
  /** Leaves the focus where onPick put it instead of returning it to the anchor. */
  keepFocus?: boolean
  /** What the reaction is for, for the dialog's accessible name. */
  label: string
  /** The names the user has already given. */
  mine: ReadonlySet<string>
  onClose: () => void
  onPick: (name: string) => void
}) {
  const t = useT()
  const { catalog } = useEmojiCatalog()
  useEffect(() => {
    if (catalog) warmGlyphs(catalog)
  }, [catalog])
  return <Popover
    anchorEl={anchorEl}
    anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
    disableRestoreFocus={keepFocus}
    onClose={onClose}
    open={Boolean(anchorEl)}
    slotProps={{ paper: { 'aria-label': t('common.emoji.dialog', { label }), role: 'dialog' } }}
  >
    {/* Mounted only while open, so the search and the tab start fresh each time. */}
    {anchorEl ? <PickerBody mine={mine} onPick={(name) => {
      rememberRecentReaction(name)
      onPick(name)
    }} /> : null}
  </Popover>
}

function PickerBody({ mine, onPick }: { mine: ReadonlySet<string>; onPick: (name: string) => void }) {
  const { catalog, failed } = useEmojiCatalog()
  const t = useT()
  const [query, setQuery] = useState('')
  const theme = useTheme()
  const [tab, setTab] = useState<number | typeof RECENT>(RECENT)
  // The grid takes a new tab once the indicator has moved to it: drawing a tab's emoji holds the next frames,
  // and the indicator would otherwise jump instead of moving.
  const [shownTab, setShownTab] = useState(tab)
  useEffect(() => {
    if (shownTab === tab) return
    const timer = setTimeout(() => setShownTab(tab), theme.transitions.duration.standard)
    return () => clearTimeout(timer)
  }, [shownTab, tab, theme])
  const [active, setActive] = useState(0)
  const [previewed, setPreviewed] = useState<EmojiChoice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const recent = useMemo(() => [...new Set([...readRecentReactions(), ...REACTION_CHOICES])], [])

  const searching = query.trim() !== ''
  const shown = useMemo(() => {
    if (!catalog) return []
    if (searching) return searchEmoji(catalog.choices, query)
    if (shownTab === RECENT) return recent.flatMap((name) => catalog.choiceByName.get(name) ?? [])
    return catalog.choices.filter((choice) => choice.category === shownTab)
  }, [catalog, query, recent, searching, shownTab])

  const focusCell = (index: number) => {
    const next = Math.max(0, Math.min(shown.length - 1, index))
    setActive(next)
    const cell = gridRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]
    cell?.focus()
    cell?.scrollIntoView?.({ block: 'nearest' })
  }
  const moveInGrid = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: COLUMNS, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, End: shown.length, Home: -shown.length }[event.key]
    if (step === undefined) return
    event.preventDefault()
    if (event.key === 'ArrowUp' && active < COLUMNS) {
      searchRef.current?.focus()
      return
    }
    focusCell(active + step)
  }
  const leaveSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter while an IME is converting confirms the conversion, not a pick.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' && shown.length) {
      event.preventDefault()
      focusCell(0)
    } else if (event.key === 'Enter' && searching && shown[0]) {
      event.preventDefault()
      onPick(shown[0].name)
    }
  }
  const preview = previewed ?? shown[active] ?? null

  return <Stack sx={{ width: COLUMNS * CELL + 40 }}>
    <Box sx={{ pt: 1.5, px: 1.5 }}>
      <TextField
        autoFocus
        fullWidth
        inputRef={searchRef}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={leaveSearch}
        placeholder={t('common.emoji.searchPlaceholder')}
        size="small"
        slotProps={{
          htmlInput: { 'aria-label': t('common.emoji.search') },
          input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> },
        }}
        value={query}
      />
    </Box>
    <Tabs
      aria-label={t('common.emoji.categories')}
      onChange={(_, value: number | typeof RECENT) => {
        setTab(value)
        setQuery('')
        setActive(0)
      }}
      // The indicator moves on a layer of its own, so its frames do not repaint the emoji in the tabs.
      sx={{ ...hairline('bottom'), minHeight: 36, px: 1, '& .MuiTab-root': { fontSize: 18, minHeight: 36, minWidth: 0, px: 0 }, '& .MuiTabs-indicator': { willChange: 'transform' } }}
      value={searching ? false : tab}
      variant="fullWidth"
    >
      <Tab aria-label={t('common.emoji.recent')} icon={<HistoryRoundedIcon fontSize="small" />} title={t('common.emoji.recent')} value={RECENT} />
      {EMOJI_CATEGORIES.map((name, index) => <Tab aria-label={t(name)} key={name} label={CATEGORY_ICONS[index]} title={t(name)} value={index} />)}
    </Tabs>
    {/* Scrolled by the compositor, which moves the rows' layers instead of painting the emoji again. */}
    <Box onKeyDown={moveInGrid} ref={gridRef} sx={{ height: CELL * 7 + 16, overflowY: 'auto', px: 1.5, py: 1, scrollbarGutter: 'stable', willChange: 'scroll-position' }}>
      {!catalog ? <Stack spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        {failed
          ? <Typography color="error" variant="body2">{t('common.emoji.loadFailed')}</Typography>
          : <><CircularProgress size={20} /><Typography color="textSecondary" variant="caption">{t('common.emoji.loading')}</Typography></>}
      </Stack> : shown.length === 0 ? <Typography color="textSecondary" sx={{ pt: 2, textAlign: 'center' }} variant="body2">
        {t('common.emoji.noResults', { query: query.trim() })}
      </Typography> : <Box aria-label={searching ? t('common.emoji.results') : shownTab === RECENT ? t('common.emoji.recent') : t(EMOJI_CATEGORIES[shownTab])} role="group" sx={gridSx}>
        <EmojiCells active={active} mine={mine} onPick={onPick} setActive={setActive} setPreviewed={setPreviewed} shown={shown} />
        <Box aria-hidden sx={hoverSx} style={hoveredAt(previewed ? shown.indexOf(previewed) : -1)} />
      </Box>}
    </Box>
    <Row spacing={1} sx={{ ...hairline('top'), minHeight: 48, px: 1.5, py: 0.5 }}>
      {preview ? <>
        <Box aria-hidden sx={{ fontSize: 32, lineHeight: 1 }}>{preview.emoji}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap variant="body2">{mine.has(preview.name) ? t('common.emoji.previewGiven', { label: preview.label }) : preview.label}</Typography>
          <Typography color="textSecondary" noWrap sx={{ display: 'block', fontFamily: 'code.fontFamily' }} variant="caption">:{preview.name}:</Typography>
        </Box>
      </> : null}
    </Row>
  </Stack>
}

let warming = false

/**
 * Lays out the picker's emoji once, a few at a time while the app is idle, the first rows of each tab first.
 * Showing an emoji for the first time loads its glyph (about 1.4 ms each in WebView2 on Windows), which held a
 * tab opened cold for hundreds of milliseconds; laid out once anywhere, the grid lays them out in a few.
 */
function warmGlyphs(catalog: EmojiCatalog) {
  if (warming || typeof requestIdleCallback !== 'function') return
  warming = true
  const byCategory = EMOJI_CATEGORIES.map((_, category) => catalog.choices.filter((choice) => choice.category === category))
  const queue = [...byCategory.flatMap((choices) => choices.slice(0, FIRST_CELLS)), ...byCategory.flatMap((choices) => choices.slice(FIRST_CELLS))].map((choice) => choice.emoji)
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;white-space:pre;font-size:20px`
  document.body.append(box)
  let next = 0
  const step = (deadline: IdleDeadline) => {
    while (next < queue.length && deadline.timeRemaining() > 4) {
      box.textContent = queue.slice(next, next + 4).join(' ')
      void box.offsetHeight
      next += 4
    }
    if (next < queue.length) requestIdleCallback(step)
    else box.remove()
  }
  requestIdleCallback(step)
}

/**
 * The grid's buttons, apart from the picker so that hovering, which changes
 * only the preview, does not render a category's hundreds of cells again.
 */
const EmojiCells = memo(function EmojiCells({ active, mine, onPick, setActive, setPreviewed, shown }: {
  active: number
  mine: ReadonlySet<string>
  onPick: (name: string) => void
  setActive: (index: number) => void
  setPreviewed: (choice: EmojiChoice | null) => void
  shown: readonly EmojiChoice[]
}) {
  const t = useT()
  const cell = (choice: EmojiChoice, index: number) => {
    const given = mine.has(choice.name)
    return <button
      aria-label={t(given ? 'common.emoji.choiceGiven' : 'common.emoji.choice', { emoji: choice.emoji, label: choice.label, name: choice.name })}
      aria-pressed={given}
      key={choice.name}
      onClick={() => onPick(choice.name)}
      onFocus={() => setActive(index)}
      onMouseEnter={() => setPreviewed(choice)}
      onMouseLeave={() => setPreviewed(null)}
      tabIndex={index === active ? 0 : -1}
      type="button"
    >{choice.emoji}</button>
  }
  const rows = []
  for (let start = 0; start < shown.length; start += COLUMNS) rows.push(<div key={start}>{shown.slice(start, start + COLUMNS).map((choice, offset) => cell(choice, start + offset))}</div>)
  return rows
})

/** The rows' and cells' style, given once on the grid rather than built for each of up to hundreds of cells. */
const gridSx = {
  isolation: 'isolate',
  position: 'relative',
  // A color emoji is slow to rasterize and is not kept as a bitmap, so each row is a layer of its own: a row is
  // rasterized once, and scrolling, hovering or a neighbouring row's focus do not paint its emoji again.
  '& > div': { alignItems: 'center', display: 'flex', willChange: 'transform' },
  '& > div > button': {
    alignItems: 'center',
    bgcolor: 'transparent',
    border: 0,
    borderRadius: 1,
    color: 'text.primary',
    cursor: 'pointer',
    display: 'flex',
    fontSize: 20,
    height: CELL,
    justifyContent: 'center',
    p: 0,
    width: CELL,
    // Before the hover and focus styles, which show over a given emoji as they did per cell.
    '&[aria-pressed="true"]': {
      bgcolor: 'action.selected',
      boxShadow: (theme: Theme) => `inset 0 0 0 1px ${theme.palette.primary.main}`,
    },
    '&:focus': { outline: 'none' },
    '&:focus-visible': { boxShadow: (theme: Theme) => `inset 0 0 0 2px ${theme.palette.primary.main}` },
  },
} as const

/** The hover highlight: one box behind the rows, moved to the cell under the pointer without painting the cells. */
const hoverSx = {
  bgcolor: 'action.hover',
  borderRadius: 1,
  height: CELL,
  left: 0,
  pointerEvents: 'none',
  position: 'absolute',
  top: 0,
  width: CELL,
  willChange: 'transform',
  zIndex: -1,
} as const

const hoveredAt = (index: number) => index < 0 ? { opacity: 0 } : { transform: `translate(${(index % COLUMNS) * CELL}px, ${Math.floor(index / COLUMNS) * CELL}px)` }
