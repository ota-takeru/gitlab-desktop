import { alpha, createTheme, type PaletteMode } from '@mui/material/styles'

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

declare module '@mui/material/styles' {
  interface Palette {
    diff: {
      addedBackground: string
      deletedBackground: string
      addedText: string
      deletedText: string
    }
    /** Code token colours for syntax highlighting. */
    syntax: SyntaxPalette
    /** Layered surfaces of the three-pane workspace. */
    surface: {
      nav: string
      list: string
      raised: string
      selected: string
      borderStrong: string
    }
  }

  interface PaletteOptions {
    diff?: {
      addedBackground: string
      deletedBackground: string
      addedText: string
      deletedText: string
    }
    syntax?: SyntaxPalette
    surface?: {
      nav: string
      list: string
      raised: string
      selected: string
      borderStrong: string
    }
  }

  interface TypographyVariants {
    code: React.CSSProperties
  }

  interface TypographyVariantsOptions {
    code?: React.CSSProperties
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    code: true
  }
}

// GitHub-like token colours, readable on both the plain and the added/removed diff backgrounds.
const syntaxTokens: Record<PaletteMode, SyntaxPalette> = {
  light: { keyword: '#cf222e', string: '#0a3069', comment: '#6e7781', number: '#0550ae', title: '#8250df', type: '#953800', attribute: '#0550ae', tag: '#116329', variable: '#953800' },
  dark: { keyword: '#ff7b72', string: '#a5d6ff', comment: '#8b949e', number: '#79c0ff', title: '#d2a8ff', type: '#ffa657', attribute: '#79c0ff', tag: '#7ee787', variable: '#ffa657' },
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
  primary: string
  primaryStrong: string
  /** Background of filled primary controls; white text must stay readable on it. */
  primaryFill: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  tooltip: string
  diff: { addedBackground: string; deletedBackground: string; addedText: string; deletedText: string }
}

// Neutral grays, blue only for selection and the primary action.
const tokens: Record<PaletteMode, Tokens> = {
  light: {
    canvas: '#ffffff', nav: '#f1f3f5', list: '#f8f9fb', surface: '#ffffff', raised: '#ffffff',
    ink: '#1b1f24', inkMuted: '#5d6672', border: '#e3e6ea', borderStrong: '#cfd4da',
    primary: '#2f6fde', primaryStrong: '#1f56b8', primaryFill: '#2f6fde', accent: '#8a5cf5',
    success: '#1f8a4c', warning: '#9a6200', error: '#c93c37', info: '#2f6fde', tooltip: '#24292f',
    diff: { addedBackground: '#e6f4ea', deletedBackground: '#fbe9eb', addedText: '#1a6b34', deletedText: '#a3242f' },
  },
  dark: {
    canvas: '#212327', nav: '#121316', list: '#1a1b1f', surface: '#212327', raised: '#2a2c31',
    ink: '#e3e6ea', inkMuted: '#9ca3ad', border: '#34373e', borderStrong: '#464a52',
    primary: '#7aa7ee', primaryStrong: '#a3c2f5', primaryFill: '#2e66c8', accent: '#a990ea',
    success: '#5cbf8e', warning: '#dca54f', error: '#ef7272', info: '#5bb8d4', tooltip: '#2e3036',
    diff: { addedBackground: '#1d3527', deletedBackground: '#3c2428', addedText: '#e3e6ea', deletedText: '#e3e6ea' },
  },
}

export function createAppTheme(mode: PaletteMode) {
  const palette = tokens[mode]
  const selected = mode === 'dark' ? alpha(palette.ink, 0.09) : alpha(palette.primary, 0.1)

  return createTheme({
    palette: {
      mode,
      primary: {
        main: palette.primary,
        dark: palette.primaryFill,
        light: palette.primaryStrong,
        contrastText: '#ffffff',
      },
      secondary: {
        main: palette.accent,
        contrastText: '#ffffff',
      },
      background: {
        default: palette.canvas,
        paper: palette.surface,
      },
      text: {
        primary: palette.ink,
        secondary: palette.inkMuted,
      },
      divider: palette.border,
      action: {
        hover: alpha(palette.ink, mode === 'dark' ? 0.05 : 0.04),
        selected,
        focus: alpha(palette.primary, 0.2),
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
      },
    },
    typography: {
      fontSize: 13,
      fontWeightBold: 600,
      fontFamily: 'Inter, "Segoe UI Variable Text", "Segoe UI", "Noto Sans JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif',
      code: {
        fontFamily: '"Cascadia Code", "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
        fontSize: '0.8125rem',
        lineHeight: 1.65,
      },
      h1: {
        fontSize: '1.125rem',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: 1.35,
      },
      h2: {
        fontSize: '0.9375rem',
        fontWeight: 600,
        letterSpacing: 0,
        lineHeight: 1.4,
      },
      h3: {
        fontSize: '0.8125rem',
        fontWeight: 600,
      },
      body1: { fontSize: '0.875rem', lineHeight: 1.6 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.55 },
      // Titles of list rows, so they stand out from the metadata around them.
      subtitle1: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.45 },
      caption: { fontSize: '0.75rem', lineHeight: 1.45, letterSpacing: 0 },
      overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', lineHeight: 1.6 },
    },
    shape: {
      borderRadius: 6,
    },
    spacing: 8,
    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: {
            '&:focus-visible': { outline: `2px solid ${palette.primary}`, outlineOffset: 1 },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            minWidth: 360,
            fontSize: '0.8125rem',
          },
          '*': {
            scrollbarColor: `${palette.borderStrong} transparent`,
            scrollbarWidth: 'thin',
          },
          '::selection': { backgroundColor: alpha(palette.primary, 0.3) },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
          size: 'small',
        },
        styleOverrides: {
          root: {
            borderRadius: 6,
            fontWeight: 500,
            textTransform: 'none',
            whiteSpace: 'nowrap',
            minHeight: 30,
            padding: '4px 12px',
            fontSize: '0.8125rem',
            '&.MuiButton-sizeSmall': { minHeight: 28, padding: '3px 10px', fontSize: '0.8125rem' },
          },
          contained: { '&.MuiButton-colorPrimary': { backgroundColor: palette.primaryFill, color: '#ffffff', '&:hover': { backgroundColor: alpha(palette.primaryFill, 0.88) } } },
          outlined: { '&.MuiButton-colorPrimary': { borderColor: palette.borderStrong, color: palette.ink, '&:hover': { borderColor: palette.borderStrong, backgroundColor: alpha(palette.ink, 0.05) } } },
          text: { '&.MuiButton-colorPrimary': { color: mode === 'dark' ? palette.primaryStrong : palette.primary } },
          startIcon: { marginRight: 6, '& > *:nth-of-type(1)': { fontSize: 16 } },
        },
      },
      MuiIconButton: {
        defaultProps: { size: 'small' },
        styleOverrides: {
          root: { borderRadius: 6, color: palette.inkMuted, '&:hover': { backgroundColor: alpha(palette.ink, 0.07), color: palette.ink } },
          sizeSmall: { padding: 5, '& .MuiSvgIcon-root': { fontSize: 18 } },
        },
      },
      MuiTooltip: {
        defaultProps: { disableInteractive: true, enterDelay: 350 },
        styleOverrides: {
          tooltip: { backgroundColor: palette.tooltip, border: `1px solid ${palette.borderStrong}`, color: '#eef1f5', fontSize: '0.75rem', fontWeight: 400, padding: '4px 8px' },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${palette.border}`,
            boxShadow: 'none',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          outlined: { borderColor: palette.border },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            fontWeight: 500,
            height: 20,
            fontSize: '0.6875rem',
          },
          label: {
            paddingLeft: 6,
            paddingRight: 6,
          },
          outlined: { borderColor: palette.borderStrong },
          filled: { '&.MuiChip-colorPrimary': { backgroundColor: palette.primaryFill, color: '#ffffff' } },
          icon: { fontSize: 14, marginLeft: 5 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            marginBottom: 1,
            padding: '6px 10px',
            '&.Mui-selected': {
              backgroundColor: selected,
              '&:hover': { backgroundColor: mode === 'dark' ? alpha(palette.ink, 0.12) : alpha(palette.primary, 0.14) },
            },
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
          root: { minHeight: 38 },
          indicator: { height: 2, borderRadius: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            fontSize: '0.8125rem',
            fontWeight: 500,
            minHeight: 38,
            minWidth: 0,
            padding: '6px 12px',
            textTransform: 'none',
            color: palette.inkMuted,
            '&.Mui-selected': { color: palette.ink },
            '& .MuiTab-iconWrapper': { fontSize: 16 },
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
            '& .MuiOutlinedInput-notchedOutline': { borderColor: palette.border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: palette.borderStrong },
            '& .MuiInputBase-inputSizeSmall': { paddingBottom: 6, paddingTop: 6 },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { fontSize: '0.8125rem' } },
      },
      MuiMenu: {
        styleOverrides: { paper: { border: `1px solid ${palette.border}`, boxShadow: `0 8px 24px ${alpha('#000000', mode === 'dark' ? 0.45 : 0.12)}` } },
      },
      MuiMenuItem: {
        styleOverrides: { root: { fontSize: '0.8125rem', minHeight: 30 } },
      },
      MuiDialog: {
        styleOverrides: { paper: { backgroundColor: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 10 } },
      },
      MuiDialogTitle: {
        styleOverrides: { root: { fontSize: '0.9375rem', fontWeight: 600, padding: '14px 18px 8px' } },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            alignItems: 'center',
            border: '1px solid',
            borderColor: 'transparent',
            fontSize: '0.8125rem',
            padding: '2px 10px',
            '&.MuiAlert-colorError': { borderColor: alpha(palette.error, 0.35) },
            '&.MuiAlert-colorWarning': { borderColor: alpha(palette.warning, 0.35) },
            '&.MuiAlert-colorInfo': { borderColor: alpha(palette.info, 0.35) },
            '&.MuiAlert-colorSuccess': { borderColor: alpha(palette.success, 0.35) },
          },
          icon: { fontSize: 18, padding: '5px 0' },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: palette.border,
            color: palette.inkMuted,
            fontSize: '0.75rem',
            fontWeight: 500,
            padding: '3px 10px',
            textTransform: 'none',
            '&.Mui-selected': { backgroundColor: alpha(palette.ink, 0.08), color: palette.ink },
          },
        },
      },
      MuiCheckbox: {
        defaultProps: { size: 'small' },
      },
      MuiSwitch: {
        defaultProps: { size: 'small' },
      },
    },
  })
}
