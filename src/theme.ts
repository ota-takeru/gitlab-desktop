import { alpha, createTheme, type PaletteMode } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    diff: {
      addedBackground: string
      deletedBackground: string
      addedText: string
      deletedText: string
    }
  }

  interface PaletteOptions {
    diff?: {
      addedBackground: string
      deletedBackground: string
      addedText: string
      deletedText: string
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

const tokens = {
  foundation: {
    light: {
      canvas: '#f5f6f8',
      surface: '#ffffff',
      surfaceRaised: '#ffffff',
      ink: '#171a1f',
      inkMuted: '#626b78',
      border: '#dfe3e8',
      primary: '#d24365',
      primaryStrong: '#ae2548',
      accent: '#f1b54c',
      diff: {
        addedBackground: '#e7f3ee',
        deletedBackground: '#fae9ea',
        addedText: '#17634f',
        deletedText: '#9b3038',
      },
    },
    dark: {
      canvas: '#101317',
      surface: '#171b21',
      surfaceRaised: '#1d232b',
      ink: '#f5f7fa',
      inkMuted: '#a6afbb',
      border: '#303844',
      primary: '#ed6b86',
      primaryStrong: '#ff9bad',
      accent: '#f2bf63',
      diff: {
        addedBackground: '#19352f',
        deletedBackground: '#3b282d',
        addedText: '#9fe2cb',
        deletedText: '#ffb0b5',
      },
    },
  },
  workbench: {
    light: {
      canvas: '#eef2f3',
      surface: '#f8faf9',
      surfaceRaised: '#ffffff',
      ink: '#1e2a2b',
      inkMuted: '#647576',
      border: '#d7e0df',
      primary: '#19796f',
      primaryStrong: '#0f5f58',
      accent: '#b78039',
      diff: {
        addedBackground: '#e5f2ee',
        deletedBackground: '#f9e8e8',
        addedText: '#175f4f',
        deletedText: '#96353b',
      },
    },
    dark: {
      canvas: '#111718',
      surface: '#182122',
      surfaceRaised: '#202b2c',
      ink: '#e8f0ee',
      inkMuted: '#9fb0ad',
      border: '#334446',
      primary: '#67c4b1',
      primaryStrong: '#98dece',
      accent: '#d8ab65',
      diff: {
        addedBackground: '#1c3933',
        deletedBackground: '#3d2a2f',
        addedText: '#a3e5d1',
        deletedText: '#ffb3b7',
      },
    },
  },
} as const

export function createAppTheme(
  mode: PaletteMode,
  appearance: ThemeAppearance = 'foundation',
) {
  const palette = tokens[appearance][mode]

  return createTheme({
    palette: {
      mode,
      primary: {
        main: palette.primary,
        contrastText: mode === 'light' ? '#ffffff' : '#171a1f',
      },
      secondary: {
        main: palette.accent,
        contrastText: '#171a1f',
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
      ...(appearance === 'workbench' ? {
        action: {
          hover: alpha(palette.primary, 0.06),
          selected: alpha(palette.primary, 0.12),
        },
      } : {}),
      success: {
        main: mode === 'light' ? '#2d8b67' : '#6bd0a4',
      },
      warning: {
        main: mode === 'light' ? '#ae6d12' : '#f2bf63',
      },
      error: {
        main: mode === 'light' ? '#bd3f49' : '#ff858d',
      },
      info: {
        main: mode === 'light' ? '#4c6f9d' : '#91b6e8',
      },
      diff: palette.diff,
    },
    typography: {
      fontWeightBold: appearance === 'workbench' ? 600 : 700,
      fontFamily:
        'Inter, "Noto Sans JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif',
      code: {
        fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
        fontSize: '0.8125rem',
        lineHeight: 1.65,
      },
      h1: {
        fontSize: '1.7rem',
        fontWeight: 700,
        letterSpacing: '-0.025em',
      },
      h2: {
        fontSize: '1.2rem',
        fontWeight: 700,
        letterSpacing: '-0.015em',
      },
      h3: {
        fontSize: '1rem',
        fontWeight: 700,
      },
      body2: {
        ...(appearance === 'workbench' ? { fontSize: '0.8125rem' } : {}),
        lineHeight: 1.65,
      },
      caption: {
        ...(appearance === 'workbench' ? { fontSize: '0.6875rem' } : {}),
        letterSpacing: '0.02em',
      },
    },
    shape: {
      borderRadius: appearance === 'workbench' ? 8 : 10,
    },
    spacing: 8,
    components: {
      MuiButtonBase: {
        styleOverrides: {
          root: {
            '&:focus-visible': { outline: `2px solid ${palette.primary}`, outlineOffset: 2 },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            minWidth: 960,
          },
          '*': {
            scrollbarColor: `${palette.border} transparent`,
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 700,
            textTransform: 'none',
          },
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
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            fontWeight: 700,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            marginBottom: 3,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
        },
      },
    },
  })
}
