import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'

import { createAppTheme } from './theme'
import { ClientApp } from './features/ClientApp'

const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./pages/DevelopmentApp')) : null

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

function saveMode(mode: 'light' | 'dark') {
  try {
    globalThis.localStorage?.setItem(colorModeKey, mode)
  } catch {
    // The choice still applies for this session.
  }
}

export default function App() {
  const [mode, setMode] = useState<'light' | 'dark'>(readInitialMode)
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/u, ''))
  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash.replace(/^#/u, ''))
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  const developmentRoute = DevelopmentApp && (route.startsWith('mock') || route.startsWith('foundation'))
  const theme = useMemo(() => createAppTheme(mode, 'workbench'), [mode])
  const onModeChange = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    saveMode(next)
    setMode(next)
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {developmentRoute && DevelopmentApp ? (
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
