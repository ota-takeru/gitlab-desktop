import { alpha, createTheme, type PaletteMode } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    diff: {
      addedBackground: string
      deletedBackground: string
      addedText: string
      deletedText: string
    }
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

export type ThemeAppearance = 'foundation' | 'workbench'

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
  accent: string
  success: string
  warning: string
  error: string
  info: string
  tooltip: string
  diff: { addedBackground: string; deletedBackground: string; addedText: string; deletedText: string }
}

const tokens: Record<ThemeAppearance, Record<PaletteMode, Tokens>> = {
  // The development catalog keeps its original look.
  foundation: {
    light: {
      canvas: '#f5f6f8', nav: '#ffffff', list: '#ffffff', surface: '#ffffff', raised: '#ffffff',
      ink: '#171a1f', inkMuted: '#626b78', border: '#dfe3e8', borderStrong: '#c9ced6',
      primary: '#d24365', primaryStrong: '#ae2548', accent: '#f1b54c',
      success: '#2d8b67', warning: '#ae6d12', error: '#bd3f49', info: '#4c6f9d', tooltip: '#2a2f37',
      diff: { addedBackground: '#e7f3ee', deletedBackground: '#fae9ea', addedText: '#17634f', deletedText: '#9b3038' },
    },
    dark: {
      canvas: '#101317', nav: '#171b21', list: '#171b21', surface: '#171b21', raised: '#1d232b',
      ink: '#f5f7fa', inkMuted: '#a6afbb', border: '#303844', borderStrong: '#3d4653',
      primary: '#ed6b86', primaryStrong: '#ff9bad', accent: '#f2bf63',
      success: '#6bd0a4', warning: '#f2bf63', error: '#ff858d', info: '#91b6e8', tooltip: '#2a2f37',
      diff: { addedBackground: '#19352f', deletedBackground: '#3b282d', addedText: '#9fe2cb', deletedText: '#ffb0b5' },
    },
  },
  // The client: neutral grays, blue only for selection and the primary action.
  workbench: {
    light: {
      canvas: '#ffffff', nav: '#f1f3f5', list: '#f8f9fb', surface: '#ffffff', raised: '#ffffff',
      ink: '#1b1f24', inkMuted: '#5d6672', border: '#e3e6ea', borderStrong: '#cfd4da',
      primary: '#2f6fde', primaryStrong: '#1f56b8', accent: '#8a5cf5',
      success: '#1f8a4c', warning: '#9a6200', error: '#c93c37', info: '#2f6fde', tooltip: '#24292f',
      diff: { addedBackground: '#e6f4ea', deletedBackground: '#fbe9eb', addedText: '#1a6b34', deletedText: '#a3242f' },
    },
    dark: {
      canvas: '#16191e', nav: '#0e1013', list: '#121418', surface: '#16191e', raised: '#1c2026',
      ink: '#e6e9ee', inkMuted: '#98a1ad', border: '#262b33', borderStrong: '#343a44',
      primary: '#5b95ff', primaryStrong: '#8db5ff', accent: '#b49cff',
      success: '#4cc38a', warning: '#e5a84b', error: '#ff6b6b', info: '#6ea8ff', tooltip: '#2b3038',
      diff: { addedBackground: '#15291e', deletedBackground: '#331c20', addedText: '#9be3b0', deletedText: '#ffb1b1' },
    },
  },
}

export function createAppTheme(
  mode: PaletteMode,
  appearance: ThemeAppearance = 'foundation',
) {
  const palette = tokens[appearance][mode]
  const workbench = appearance === 'workbench'

  return createTheme({
    palette: {
      mode,
      primary: {
        main: palette.primary,
        ...(workbench ? { dark: palette.primaryStrong } : {}),
        contrastText: workbench || mode === 'light' ? '#ffffff' : '#171a1f',
      },
      secondary: {
        main: palette.accent,
        contrastText: workbench ? '#ffffff' : '#171a1f',
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
      action: workbench ? {
        hover: alpha(palette.ink, mode === 'dark' ? 0.05 : 0.04),
        selected: alpha(palette.primary, mode === 'dark' ? 0.16 : 0.1),
        focus: alpha(palette.primary, 0.2),
      } : {},
      success: { main: palette.success },
      warning: { main: palette.warning },
      error: { main: palette.error },
      info: { main: palette.info },
      diff: palette.diff,
      surface: {
        nav: palette.nav,
        list: palette.list,
        raised: palette.raised,
        selected: alpha(palette.primary, mode === 'dark' ? 0.16 : 0.1),
        borderStrong: palette.borderStrong,
      },
    },
    typography: {
      fontSize: workbench ? 13 : 14,
      fontWeightBold: workbench ? 600 : 700,
      fontFamily: workbench
        ? 'Inter, "Segoe UI Variable Text", "Segoe UI", "Noto Sans JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif'
        : 'Inter, "Noto Sans JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif',
      code: {
        fontFamily: '"Cascadia Code", "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
        fontSize: '0.8125rem',
        lineHeight: 1.65,
      },
      h1: {
        fontSize: workbench ? '1.125rem' : '1.7rem',
        fontWeight: workbench ? 600 : 700,
        letterSpacing: workbench ? '-0.01em' : '-0.025em',
        lineHeight: 1.35,
      },
      h2: {
        fontSize: workbench ? '0.9375rem' : '1.2rem',
        fontWeight: workbench ? 600 : 700,
        letterSpacing: workbench ? 0 : '-0.015em',
        lineHeight: 1.4,
      },
      h3: {
        fontSize: workbench ? '0.8125rem' : '1rem',
        fontWeight: workbench ? 600 : 700,
      },
      body1: workbench ? { fontSize: '0.875rem', lineHeight: 1.6 } : {},
      body2: {
        ...(workbench ? { fontSize: '0.8125rem' } : {}),
        lineHeight: workbench ? 1.55 : 1.65,
      },
      caption: {
        ...(workbench ? { fontSize: '0.75rem', lineHeight: 1.45 } : {}),
        letterSpacing: workbench ? 0 : '0.02em',
      },
      overline: workbench ? { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', lineHeight: 1.6 } : {},
    },
    shape: {
      borderRadius: workbench ? 6 : 10,
    },
    spacing: 8,
    components: {
      MuiButtonBase: {
        defaultProps: workbench ? { disableRipple: true } : {},
        styleOverrides: {
          root: {
            '&:focus-visible': { outline: `2px solid ${palette.primary}`, outlineOffset: workbench ? 1 : 2 },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            minWidth: workbench ? 360 : 960,
            ...(workbench ? { fontSize: '0.8125rem' } : {}),
          },
          '*': {
            scrollbarColor: `${palette.borderStrong} transparent`,
            ...(workbench ? { scrollbarWidth: 'thin' } : {}),
          },
          '::selection': workbench ? { backgroundColor: alpha(palette.primary, 0.3) } : {},
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
          ...(workbench ? { size: 'small' as const } : {}),
        },
        styleOverrides: {
          root: {
            borderRadius: workbench ? 6 : 8,
            fontWeight: workbench ? 500 : 700,
            textTransform: 'none',
            whiteSpace: 'nowrap',
            ...(workbench ? { minHeight: 30, padding: '4px 12px', fontSize: '0.8125rem' } : {}),
            '&.MuiButton-sizeSmall': workbench ? { minHeight: 28, padding: '3px 10px', fontSize: '0.8125rem' } : {},
          },
          outlined: workbench ? { '&.MuiButton-colorPrimary': { borderColor: palette.borderStrong, color: palette.ink, '&:hover': { borderColor: palette.borderStrong, backgroundColor: alpha(palette.ink, 0.05) } } } : {},
          text: workbench ? { '&.MuiButton-colorPrimary': { color: mode === 'dark' ? palette.primaryStrong : palette.primary } } : {},
          startIcon: workbench ? { marginRight: 6, '& > *:nth-of-type(1)': { fontSize: 16 } } : {},
        },
      },
      MuiIconButton: {
        defaultProps: workbench ? { size: 'small' } : {},
        styleOverrides: {
          root: workbench ? { borderRadius: 6, color: palette.inkMuted, '&:hover': { backgroundColor: alpha(palette.ink, 0.07), color: palette.ink } } : {},
          sizeSmall: workbench ? { padding: 5, '& .MuiSvgIcon-root': { fontSize: 18 } } : {},
        },
      },
      MuiTooltip: {
        defaultProps: workbench ? { disableInteractive: true, enterDelay: 350 } : {},
        styleOverrides: {
          tooltip: workbench ? { backgroundColor: palette.tooltip, border: `1px solid ${palette.borderStrong}`, color: '#eef1f5', fontSize: '0.75rem', fontWeight: 400, padding: '4px 8px' } : {},
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
          outlined: workbench ? { borderColor: palette.border } : {},
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: workbench ? 4 : 6,
            fontWeight: workbench ? 500 : 700,
            ...(workbench ? { height: 20, fontSize: '0.6875rem' } : {}),
          },
          label: {
            ...(workbench ? { paddingLeft: 6, paddingRight: 6 } : {}),
          },
          outlined: workbench ? { borderColor: palette.borderStrong } : {},
          icon: workbench ? { fontSize: 14, marginLeft: 5 } : {},
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: workbench ? 6 : 8,
            marginBottom: workbench ? 1 : 3,
            ...(workbench ? {
              padding: '6px 10px',
              '&.Mui-selected': {
                backgroundColor: alpha(palette.primary, mode === 'dark' ? 0.16 : 0.1),
                '&:hover': { backgroundColor: alpha(palette.primary, mode === 'dark' ? 0.2 : 0.14) },
              },
            } : {}),
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            ...(workbench ? { minWidth: 32, color: 'inherit' } : {}),
          },
        },
      },
      MuiTabs: {
        styleOverrides: workbench ? {
          root: { minHeight: 38 },
          indicator: { height: 2, borderRadius: 2 },
        } : {},
      },
      MuiTab: {
        styleOverrides: workbench ? {
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
        } : {},
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiFormControl: {
        defaultProps: workbench ? { size: 'small' } : {},
      },
      MuiSelect: {
        defaultProps: workbench ? { size: 'small' } : {},
      },
      MuiOutlinedInput: {
        styleOverrides: workbench ? {
          root: {
            backgroundColor: palette.raised,
            fontSize: '0.8125rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: palette.border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: palette.borderStrong },
            '& .MuiInputBase-inputSizeSmall': { paddingBottom: 6, paddingTop: 6 },
          },
        } : {},
      },
      MuiInputLabel: {
        styleOverrides: workbench ? { root: { fontSize: '0.8125rem' } } : {},
      },
      MuiMenu: {
        styleOverrides: workbench ? { paper: { border: `1px solid ${palette.border}`, boxShadow: `0 8px 24px ${alpha('#000000', mode === 'dark' ? 0.45 : 0.12)}` } } : {},
      },
      MuiMenuItem: {
        styleOverrides: workbench ? { root: { fontSize: '0.8125rem', minHeight: 30 } } : {},
      },
      MuiDialog: {
        styleOverrides: workbench ? { paper: { backgroundColor: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 10 } } : {},
      },
      MuiDialogTitle: {
        styleOverrides: workbench ? { root: { fontSize: '0.9375rem', fontWeight: 600, padding: '14px 18px 8px' } } : {},
      },
      MuiAlert: {
        styleOverrides: workbench ? {
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
        } : {},
      },
      MuiToggleButton: {
        styleOverrides: workbench ? {
          root: {
            borderColor: palette.border,
            color: palette.inkMuted,
            fontSize: '0.75rem',
            fontWeight: 500,
            padding: '3px 10px',
            textTransform: 'none',
            '&.Mui-selected': { backgroundColor: alpha(palette.ink, 0.08), color: palette.ink },
          },
        } : {},
      },
      MuiCheckbox: {
        defaultProps: workbench ? { size: 'small' } : {},
      },
      MuiSwitch: {
        defaultProps: workbench ? { size: 'small' } : {},
      },
    },
  })
}
