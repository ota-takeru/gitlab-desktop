import { alpha, createTheme, type PaletteMode } from '@mui/material/styles'

import { frame, hairline, panelFrame } from './components/hairline'
import type { Locale } from './i18n/locales'

interface SyntaxPalette {
  keyword: string
  string: string
  comment: string
  number: string
  title: string
  type: string
  attribute: string
  tag: string
  variable: string
}

interface DiffPalette {
  addedBackground: string
  deletedBackground: string
  addedText: string
  deletedText: string
  /** Text matched by the in-diff search. */
  searchMatchBackground: string
  searchMatchText: string
}

interface SurfacePalette {
  nav: string
  list: string
  raised: string
  selected: string
  borderStrong: string
  /** Outline of text inputs and editors; at least 3:1 against the surfaces around them. */
  inputBorder: string
}

/** Filled controls such as the primary button, the diff comment button and filled chips. */
interface FillPalette {
  primary: string
  primaryHover: string
  /** Text and icons on a primary fill. */
  primaryText: string
}

/** Each place in the navigation has its own colour, so it is found by colour as well as by its icon and name. */
export interface PlacePalette {
  mergeRequests: string
  projects: string
  notifications: string
}

/** Initial avatars use quiet tints that never read as a state colour. */
interface AvatarTone {
  background: string
  text: string
}

declare module '@mui/material/styles' {
  interface Palette {
    diff: DiffPalette
    /** Code token colours for syntax highlighting. */
    syntax: SyntaxPalette
    /** Layered surfaces of the workspace. */
    surface: SurfacePalette
    fill: FillPalette
    avatar: AvatarTone[]
    place: PlacePalette
  }

  interface PaletteOptions {
    diff?: DiffPalette
    syntax?: SyntaxPalette
    surface?: SurfacePalette
    fill?: FillPalette
    avatar?: AvatarTone[]
    place?: PlacePalette
  }

  interface TypographyVariants {
    code: React.CSSProperties
    /** A count shown with an icon, such as the notification bell's. */
    iconCount: React.CSSProperties
  }

  interface TypographyVariantsOptions {
    code?: React.CSSProperties
    iconCount?: React.CSSProperties
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    code: true
    iconCount: true
  }
}

// GitHub-like token colours, readable on both the plain and the added/removed diff backgrounds.
const syntaxTokens: Record<PaletteMode, SyntaxPalette> = {
  light: { keyword: '#cf222e', string: '#0a3069', comment: '#57606a', number: '#0550ae', title: '#7339d0', type: '#953800', attribute: '#0550ae', tag: '#116329', variable: '#953800' },
  dark: { keyword: '#ff7b72', string: '#a5d6ff', comment: '#9da5b0', number: '#79c0ff', title: '#d2a8ff', type: '#ffa657', attribute: '#79c0ff', tag: '#7ee787', variable: '#ffa657' },
}

interface Tokens {
  canvas: string
  nav: string
  list: string
  surface: string
  raised: string
  ink: string
  inkMuted: string
  border: string
  borderStrong: string
  /** Outline of text inputs; at least 3:1 against the input and the surfaces around it. */
  inputBorder: string
  primary: string
  primaryStrong: string
  /** Background of filled primary controls; white text must stay readable on it. */
  primaryFill: string
  /** Darker, opaque hover of the fill, so white text keeps its contrast. */
  primaryFillHover: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  tooltip: string
  diff: DiffPalette
  avatar: AvatarTone[]
  place: PlacePalette
}

/**
 * The layout grid. Every line box, control height and gap is a whole number of steps, so rows built
 * from text, chips and buttons share the same pixel edges instead of drifting by fractions of a pixel.
 */
export const grid = 4
/** A line height of whole grid steps, in px: a unitless ratio such as 1.45 × 12px leaves a 17.4px line. */
export const gridLine = (steps: number) => `${steps * grid}px`

const forcedColors = '@media (forced-colors: active)'
const selectedOutline = { outline: '2px solid Highlight', outlineOffset: -2 }

// Neutral grays, blue only for selection and the primary action.
const tokens: Record<PaletteMode, Tokens> = {
  light: {
    canvas: '#ffffff', nav: '#f1f3f5', list: '#f8f9fb', surface: '#ffffff', raised: '#ffffff',
    ink: '#1b1f24', inkMuted: '#5d6672', border: '#e3e6ea', borderStrong: '#cfd4da', inputBorder: '#848c96',
    primary: '#2860c4', primaryStrong: '#1f56b8', primaryFill: '#2f6fde', primaryFillHover: '#2459b8', accent: '#6f45d8',
    success: '#1a7440', warning: '#8c5800', error: '#b5352f', info: '#0a6676', tooltip: '#24292f',
    diff: { addedBackground: '#e6f4ea', deletedBackground: '#fbe9eb', addedText: '#1a6b34', deletedText: '#a3242f', searchMatchBackground: '#fff0b3', searchMatchText: '#1b1f24' },
    avatar: [
      { background: '#e3e8f4', text: '#3a4a6b' },
      { background: '#e0efec', text: '#2f5a52' },
      { background: '#f2eadf', text: '#6b4f2a' },
      { background: '#ece5f3', text: '#58447a' },
    ],
    place: { mergeRequests: '#2860c4', projects: '#0b6e5f', notifications: '#9a5700' },
  },
  dark: {
    canvas: '#232529', nav: '#101113', list: '#1a1b1f', surface: '#232529', raised: '#2e3036',
    ink: '#e3e6ea', inkMuted: '#9ca3ad', border: '#3a3d45', borderStrong: '#4d515a', inputBorder: '#7e848e',
    primary: '#7aa7ee', primaryStrong: '#a3c2f5', primaryFill: '#2e66c8', primaryFillHover: '#2858b0', accent: '#a990ea',
    success: '#5cbf8e', warning: '#dca54f', error: '#f07c7c', info: '#5bb8d4', tooltip: '#2e3036',
    diff: { addedBackground: '#1d3527', deletedBackground: '#3c2428', addedText: '#e3e6ea', deletedText: '#e3e6ea', searchMatchBackground: '#5c4a12', searchMatchText: '#e3e6ea' },
    avatar: [
      { background: '#2d3446', text: '#b9c6e4' },
      { background: '#263b37', text: '#a9d3c9' },
      { background: '#3d3428', text: '#e0c9a6' },
      { background: '#352f42', text: '#cdbfe6' },
    ],
    place: { mergeRequests: '#7aa7ee', projects: '#4fbfa9', notifications: '#e0a650' },
  },
}

// Han characters take a different form in each CJK language, so the language's own font comes first.
// Other languages start with the Japanese fonts for Japanese text from GitLab. The rest follow, so a
// character a font lacks, such as a simplified Chinese one in Japanese fonts, falls back the same way
// on every machine.
const japaneseFonts = '"Noto Sans JP", "Yu Gothic UI", Meiryo'
const cjkFonts: Partial<Record<Locale, string>> = {
  ja: japaneseFonts,
  'zh-Hans': '"Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei"',
  'zh-Hant': '"Noto Sans TC", "Microsoft JhengHei UI", "Microsoft JhengHei"',
  ko: '"Noto Sans KR", "Malgun Gothic"',
}

export function createAppTheme(mode: PaletteMode, locale: Locale = 'ja') {
  const first = cjkFonts[locale] ?? japaneseFonts
  const languageFonts = [first, ...Object.values(cjkFonts).filter((fonts) => fonts !== first)].join(', ')
  const palette = tokens[mode]
  const selected = mode === 'dark' ? alpha(palette.ink, 0.09) : alpha(palette.primary, 0.1)
  // Text on the main colour: white on the light theme's dark blue, dark ink on the dark theme's light blue.
  const onMain = mode === 'dark' ? palette.nav : '#ffffff'

  return createTheme({
    palette: {
      mode,
      primary: {
        main: palette.primary,
        dark: mode === 'dark' ? palette.primaryFill : palette.primaryStrong,
        light: mode === 'dark' ? palette.primaryStrong : palette.primaryFill,
        contrastText: onMain,
      },
      secondary: {
        main: palette.accent,
        contrastText: onMain,
      },
      background: {
        default: palette.canvas,
        paper: palette.surface,
      },
      text: {
        primary: palette.ink,
        secondary: palette.inkMuted,
        disabled: alpha(palette.ink, 0.42),
      },
      divider: palette.border,
      action: {
        hover: alpha(palette.ink, mode === 'dark' ? 0.05 : 0.04),
        selected,
        focus: alpha(palette.primary, 0.2),
        disabled: alpha(palette.ink, 0.38),
        disabledBackground: alpha(palette.ink, 0.1),
      },
      success: { main: palette.success },
      warning: { main: palette.warning },
      error: { main: palette.error },
      info: { main: palette.info },
      diff: palette.diff,
      syntax: syntaxTokens[mode],
      surface: {
        nav: palette.nav,
        list: palette.list,
        raised: palette.raised,
        selected,
        borderStrong: palette.borderStrong,
        inputBorder: palette.inputBorder,
      },
      fill: { primary: palette.primaryFill, primaryHover: palette.primaryFillHover, primaryText: '#ffffff' },
      avatar: palette.avatar,
      place: palette.place,
    },
    typography: {
      fontSize: 13,
      fontWeightBold: 600,
      fontFamily: `Inter, "Segoe UI Variable Text", "Segoe UI", ${languageFonts}, system-ui, sans-serif`,
      code: {
        fontFamily: '"Cascadia Code", "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
        fontSize: '0.8125rem',
        lineHeight: gridLine(5),
      },
      h1: {
        fontSize: '1.125rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        lineHeight: gridLine(6),
      },
      h2: {
        fontSize: '0.9375rem',
        fontWeight: 600,
        letterSpacing: 0,
        lineHeight: gridLine(5),
      },
      h3: {
        fontSize: '0.8125rem',
        fontWeight: 600,
        lineHeight: gridLine(5),
      },
      body1: { fontSize: '0.875rem', lineHeight: gridLine(6) },
      body2: { fontSize: '0.8125rem', lineHeight: gridLine(5) },
      // Titles of list rows, so they stand out from the metadata around them.
      subtitle1: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: gridLine(5) },
      subtitle2: { lineHeight: gridLine(5) },
      caption: { fontSize: '0.75rem', lineHeight: gridLine(4), letterSpacing: 0 },
      overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', lineHeight: gridLine(4) },
      iconCount: { fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums', fontWeight: 700, letterSpacing: 0, lineHeight: gridLine(4) },
    },
    // Radii are 4 (small) or 8 (standard): `borderRadius: 1` or `2` in sx.
    shape: {
      borderRadius: 4,
    },
    spacing: 2 * grid,
    // MUI transitions (Dialog, Menu, Collapse, the tab indicator) follow the system's reduced-motion setting.
    motion: { reducedMotion: 'system' },
    // A reaction starts on the frame of the input: hover and press feedback within 80–120ms, and
    // movement (tab indicator, menus, dialogs) within 160ms. MUI's default curve eases in, which
    // holds the first frames back, so the default is a decelerating curve that moves at once.
    transitions: {
      duration: { shortest: 80, shorter: 100, short: 120, standard: 160, complex: 200, enteringScreen: 160, leavingScreen: 120 },
      easing: { easeInOut: 'cubic-bezier(0, 0, 0.2, 1)' },
    },
    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: {
            '&:focus-visible': { outline: `2px solid ${palette.primary}`, outlineOffset: 1 },
            [forcedColors]: { '&:focus-visible': { outlineColor: 'Highlight' } },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          // A touchpad swipe past the end of the scrollable content would otherwise drag the whole window
          // (the WebView's overscroll and back/forward swipe) until the fingers lift.
          'html, body': { overscrollBehavior: 'none' },
          body: {
            minWidth: 360,
            fontSize: '0.8125rem',
            lineHeight: gridLine(5),
          },
          '*': {
            scrollbarColor: `${palette.borderStrong} transparent`,
            scrollbarWidth: 'thin',
          },
          '::selection': { backgroundColor: alpha(palette.primary, 0.3) },
          // GitLab text may be Arabic or Hebrew in an otherwise left-to-right page. Each paragraph takes
          // its direction from its own first letter, so such a title or comment reads and aligns right
          // to left while the interface text stays as it is.
          'p, li, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, textarea, input': { unicodeBidi: 'plaintext' },
          // High contrast replaces background colours, so states drawn only with a fill or a bar need a shape.
          [forcedColors]: {
            ':focus-visible': { outlineColor: 'Highlight' },
            '[aria-current="true"], [aria-current="page"]': { outline: '2px solid Highlight', outlineOffset: -2 },
            '[data-kind="add"]:not(.split-number)': { borderInlineStart: '3px solid CanvasText' },
            '[data-kind="remove"]:not(.split-number)': { borderInlineStart: '3px dashed CanvasText' },
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
          size: 'small',
        },
        styleOverrides: {
          root: {
            borderRadius: 4,
            fontWeight: 500,
            textTransform: 'none',
            whiteSpace: 'nowrap',
            minHeight: 32,
            padding: '4px 12px',
            fontSize: '0.8125rem',
            // MUI's 1.75 line makes a 32.75px button, half a pixel off the 32px icon buttons beside it.
            lineHeight: gridLine(5),
            '&.MuiButton-sizeSmall': { minHeight: 32, padding: '4px 12px', fontSize: '0.8125rem', lineHeight: gridLine(5) },
          },
          // The ring sits apart from the fill in the text colour, so it shows even when the fill is the focus colour.
          // Disabled fills keep MUI's disabled colours, so a primary button never looks pressable while disabled.
          contained: { '&:focus-visible': { outlineColor: palette.ink, outlineOffset: 2 }, [forcedColors]: { '&:focus-visible': { outlineColor: 'Highlight' } }, '&.MuiButton-colorPrimary:not(.Mui-disabled)': { backgroundColor: palette.primaryFill, color: '#ffffff', '&:hover': { backgroundColor: palette.primaryFillHover } } },
          outlined: { '&.MuiButton-colorPrimary': { borderColor: palette.borderStrong, color: palette.ink, '&:hover': { borderColor: palette.borderStrong, backgroundColor: alpha(palette.ink, 0.05) } } },
          text: { '&.MuiButton-colorPrimary': { color: mode === 'dark' ? palette.primaryStrong : palette.primary } },
          startIcon: { marginRight: 8, '& > *:nth-of-type(1)': { fontSize: 16 } },
        },
      },
      MuiIconButton: {
        defaultProps: { size: 'small' },
        styleOverrides: {
          root: { borderRadius: 4, color: palette.inkMuted, '&:hover': { backgroundColor: alpha(palette.ink, 0.07), color: palette.ink } },
          // Default and small icons are set to 18px, so the button stays 32px; an icon with fontSize="inherit" follows the button's own
          // font size, so `<IconButton sx={{ fontSize: 14 }}><Icon fontSize="inherit" /></IconButton>` gives a 14px icon.
          sizeSmall: { fontSize: 18, padding: 7, '& .MuiSvgIcon-fontSizeMedium, & .MuiSvgIcon-fontSizeSmall': { fontSize: 18 } },
        },
      },
      // MUI scales icon sizes by the 13px body size (13/14), which makes 18.57, 22.29 and 32.5px icons
      // and lifts the rows that hold them off the grid. These are MUI's own sizes, kept whole.
      MuiSvgIcon: {
        styleOverrides: { fontSizeSmall: { fontSize: 20 }, fontSizeMedium: { fontSize: 24 }, fontSizeLarge: { fontSize: 32 } },
      },
      // A divider takes no room: its line is drawn over the edge, so the rows after it stay on the grid.
      MuiDivider: {
        styleOverrides: {
          root: { border: 0, height: 0, position: 'relative', '&::after': { borderColor: palette.border, borderStyle: 'solid', borderWidth: '1px 0 0', content: '""', left: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 } },
          vertical: { height: 'auto', width: 0, '&::after': { borderWidth: '0 0 0 1px', bottom: 0, right: 'auto' } },
        },
      },
      MuiTooltip: {
        defaultProps: { disableInteractive: true, enterDelay: 350 },
        styleOverrides: {
          tooltip: { backgroundColor: palette.tooltip, ...frame({ color: palette.borderStrong }), color: '#eef1f5', fontSize: '0.75rem', fontWeight: 400, lineHeight: gridLine(4), padding: '4px 8px' },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            boxShadow: 'none',
            // Frames are drawn over the edge (see hairline.ts), so a framed box keeps the grid inside and after it.
            ...panelFrame({ color: palette.border }),
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          outlined: { border: 0, ...panelFrame({ color: palette.border }) },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            fontWeight: 500,
            height: 20,
            fontSize: '0.6875rem',
            // An icon given fontSize="inherit" (the MR state glyph) would otherwise take the chip's 11px text size.
            '& .MuiChip-icon': { fontSize: 14 },
          },
          label: {
            lineHeight: gridLine(4),
            paddingLeft: 8,
            paddingRight: 8,
          },
          // Neutral chips are metadata such as labels; they recede behind titles and coloured states.
          outlined: { borderColor: palette.borderStrong, '&.MuiChip-colorDefault': { color: palette.inkMuted, fontWeight: 400 } },
          filled: { '&.MuiChip-colorPrimary': { backgroundColor: palette.primaryFill, color: '#ffffff' } },
          icon: { fontSize: 14, marginLeft: 4 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            minHeight: 32,
            padding: '4px 8px',
            '&.Mui-selected': {
              backgroundColor: selected,
              '&:hover': { backgroundColor: mode === 'dark' ? alpha(palette.ink, 0.12) : alpha(palette.primary, 0.14) },
            },
            [forcedColors]: { '&.Mui-selected': selectedOutline },
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            minWidth: 32,
            color: 'inherit',
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 40 },
          indicator: { height: 2, borderRadius: 2, zIndex: 1, [forcedColors]: { forcedColorAdjust: 'none', backgroundColor: 'Highlight' } },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            fontSize: '0.8125rem',
            fontWeight: 500,
            lineHeight: gridLine(5),
            minHeight: 40,
            minWidth: 0,
            padding: '8px 12px',
            textTransform: 'none',
            color: palette.inkMuted,
            '&.Mui-selected': { color: palette.ink, fontWeight: 600 },
            '& .MuiTab-iconWrapper': { fontSize: 16 },
            // Inside the ring of the tab, so the scrolling tab bar does not clip it.
            '&:focus-visible': { outlineOffset: -2 },
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiFormControl: {
        defaultProps: { size: 'small' },
      },
      MuiSelect: {
        defaultProps: { size: 'small' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: palette.raised,
            fontSize: '0.8125rem',
            lineHeight: gridLine(5),
            '& .MuiOutlinedInput-notchedOutline': { borderColor: palette.inputBorder },
            '&:hover:not(.Mui-focused, .Mui-error, .Mui-disabled) .MuiOutlinedInput-notchedOutline': { borderColor: palette.inkMuted },
            '&.MuiInputBase-sizeSmall .MuiSelect-select': { height: 20, lineHeight: '20px', minHeight: 0 },
            '&.MuiInputBase-multiline.MuiInputBase-sizeSmall': { paddingBottom: 6, paddingTop: 6 },
          },
          // A small field or select is 32px, the height of the buttons beside it. MUI marks the size only on the
          // root, so it is read from the owner state; a field's own sx (a dense toolbar field) still wins.
          input: ({ ownerState }) => ownerState.size === 'small' && !ownerState.multiline ? { height: 20, lineHeight: '20px', paddingBottom: 6, paddingTop: 6 } : {},
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { fontSize: '0.8125rem', lineHeight: gridLine(5) } },
      },
      // MUI's own 2.5px around an autocomplete's text made a 37px field; the root's 6px alone keeps it 32px.
      MuiAutocomplete: {
        defaultProps: { size: 'small' },
        styleOverrides: { inputRoot: { '&.MuiInputBase-sizeSmall .MuiAutocomplete-input': { paddingBottom: 0, paddingTop: 0 } } },
      },
      // Menus and popovers otherwise take a height-based "auto" time, which grows with long menus.
      MuiPopover: {
        defaultProps: { transitionDuration: { enter: 160, exit: 100 } },
      },
      MuiMenu: {
        defaultProps: { transitionDuration: { enter: 160, exit: 100 } },
        styleOverrides: { paper: { ...frame({ color: palette.border }), boxShadow: `0 8px 24px ${alpha('#000000', mode === 'dark' ? 0.45 : 0.12)}` } },
      },
      MuiMenuItem: {
        styleOverrides: { root: { fontSize: '0.8125rem', minHeight: 32, [forcedColors]: { '&.Mui-selected': selectedOutline } } },
      },
      MuiDialog: {
        styleOverrides: { paper: { backgroundColor: palette.surface, borderRadius: 8, ...frame({ color: palette.border }) } },
      },
      MuiDialogTitle: {
        styleOverrides: { root: { fontSize: '0.9375rem', fontWeight: 600, padding: '16px 24px 8px', '&:has(+ .MuiDialogContent-dividers)': hairline('bottom', { color: palette.border }) } },
      },
      MuiDialogContent: {
        styleOverrides: { dividers: { border: 0 } },
      },
      MuiDialogActions: {
        styleOverrides: { root: { '.MuiDialogContent-dividers + &': hairline('top', { color: palette.border }) } },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            alignItems: 'center',
            border: 0,
            ...frame({ color: 'transparent' }),
            fontSize: '0.8125rem',
            padding: '0 12px',
            '&.MuiAlert-colorError': { outlineColor: alpha(palette.error, 0.35) },
            '&.MuiAlert-colorWarning': { outlineColor: alpha(palette.warning, 0.35) },
            '&.MuiAlert-colorInfo': { outlineColor: alpha(palette.info, 0.35) },
            '&.MuiAlert-colorSuccess': { outlineColor: alpha(palette.success, 0.35) },
            // A toast floats over lists and diffs, so it needs its own opaque surface.
            '.MuiSnackbar-root &': { backgroundColor: palette.raised, boxShadow: `0 8px 24px ${alpha('#000000', mode === 'dark' ? 0.45 : 0.16)}` },
            // A milestone notice is filled with the success colour instead.
            '.MuiSnackbar-root &.MuiAlert-filled.MuiAlert-colorSuccess': { backgroundColor: palette.success, color: mode === 'dark' ? palette.nav : '#ffffff', outlineColor: palette.success },
          },
          icon: { fontSize: 18, padding: '8px 0' },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: palette.border,
            color: palette.inkMuted,
            fontSize: '0.75rem',
            fontWeight: 500,
            lineHeight: gridLine(5),
            // The same height as the buttons in the toolbars they share.
            minHeight: 32,
            padding: '4px 12px',
            textTransform: 'none',
            // The inset bar marks the choice by shape as well as by colour.
            '&.Mui-selected': { backgroundColor: alpha(palette.ink, 0.1), boxShadow: `inset 0 -2px 0 ${palette.primary}`, color: palette.ink, fontWeight: 600 },
            [forcedColors]: { '&.Mui-selected': selectedOutline },
          },
        },
      },
      // A small checkbox or radio is a 32px square with an 18px box, and its label pulls it back so the
      // box sits on the column's edge and the label text starts 24px in (`pl: 3` for text under it).
      MuiCheckbox: {
        defaultProps: { size: 'small' },
        styleOverrides: { sizeSmall: { padding: 7, '& .MuiSvgIcon-root': { fontSize: 18 } } },
      },
      MuiRadio: {
        defaultProps: { size: 'small' },
        styleOverrides: { sizeSmall: { padding: 7, '& .MuiSvgIcon-root': { fontSize: 18 } } },
      },
      MuiFormControlLabel: {
        styleOverrides: { root: { marginLeft: -8 } },
      },
      // Without flex gap a spaced Stack zeroes its children's margins, so offsets such as a back
      // button's negative margin or a helper text's spacing were silently dropped.
      MuiStack: {
        defaultProps: { useFlexGap: true },
      },
      MuiSwitch: {
        defaultProps: { size: 'small' },
      },
    },
  })
}
