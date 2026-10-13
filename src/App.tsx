import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from './theme'
import { ClientApp } from './features/ClientApp'

const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./pages/DevelopmentApp')) : null
const FixtureApp = import.meta.env.DEV ? lazy(() => import('./pages/FixtureApp')) : null

const colorModeKey = 'gitlab-desktop:color-mode'

function readInitialMode(): 'light' | 'dark' {
  try {
    const saved = globalThis.localStorage?.getItem(colorModeKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // A locked down WebView falls back to the OS preference.
  }
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Development screens accept `theme=light|dark` (in the hash or the query) to open in a fixed theme without saving it. */
function routeThemeOverride(route: string): 'light' | 'dark' | null {
  if (!import.meta.env.DEV) return null
  const theme = new URLSearchParams(route.split('?')[1] ?? '').get('theme') ?? new URLSearchParams(window.location.search).get('theme')
  return theme === 'light' || theme === 'dark' ? theme : null
}

function saveMode(mode: 'light' | 'dark') {
  try {
    globalThis.localStorage?.setItem(colorModeKey, mode)
  } catch {
    // The choice still applies for this session.
  }
}

export default function App() {
  const [mode, setMode] = useState<'light' | 'dark'>(() => routeThemeOverride(window.location.hash.replace(/^#/u, '')) ?? readInitialMode())
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/u, ''))
  useEffect(() => {
    const handleHashChange = () => {
      const next = window.location.hash.replace(/^#/u, '')
      setRoute(next)
      const override = routeThemeOverride(next)
      if (override) setMode(override)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  const developmentRoute = DevelopmentApp && (route.startsWith('mock') || route.startsWith('foundation'))
  // `?fixture=<state>` keeps the client's own hash routes working.
  const fixtureMode = FixtureApp && new URLSearchParams(window.location.search).has('fixture')
  const theme = useMemo(() => createAppTheme(mode, 'workbench'), [mode])
  const onModeChange = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    saveMode(next)
    setMode(next)
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {fixtureMode && FixtureApp ? (
        <Suspense fallback={<CatalogLoading />}>
          <FixtureApp mode={mode} onModeChange={onModeChange} />
        </Suspense>
      ) : developmentRoute && DevelopmentApp ? (
        <Suspense fallback={<CatalogLoading />}>
          <DevelopmentApp mode={mode} onModeChange={onModeChange} route={route} />
        </Suspense>
      ) : <ClientApp mode={mode} onModeChange={onModeChange} />}
    </ThemeProvider>
  )
}

function CatalogLoading() {
  return (
    <Box aria-live="polite" role="status" sx={{ py: 8, textAlign: 'center' }}>
      <Typography color="text.secondary" variant="body2">
        画面を読み込み中…
      </Typography>
    </Box>
  )
}
