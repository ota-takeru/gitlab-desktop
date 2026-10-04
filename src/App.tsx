import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'

import { AppShell, type PageKey } from './components/AppShell'
import { createAppTheme } from './theme'
import { ModulePage, type ModuleKey } from './pages/ModulePage'
import { OverviewPage } from './pages/OverviewPage'
import { ClientApp } from './features/ClientApp'

const UiCatalogPage = lazy(() =>
  import('./pages/UiCatalogPage').then(({ UiCatalogPage: Page }) => ({ default: Page })),
)
const MockApp = lazy(() => import('./pages/MockApp').then(({ MockApp: Page }) => ({ default: Page })))

function isModulePage(page: PageKey): page is ModuleKey {
  return page === 'merge-requests' || page === 'issues' || page === 'pipelines'
}

export default function App() {
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/u, ''))
  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash.replace(/^#/u, ''))
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  const mockRoute = route.startsWith('mock')
  const foundationRoute = route.startsWith('foundation')
  const theme = useMemo(() => createAppTheme(mode, mockRoute ? 'workbench' : 'foundation'), [mode, mockRoute])

  if (mockRoute) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Suspense fallback={<CatalogLoading />}>
          <MockApp
            mode={mode}
            onBackToFoundation={() => {
              window.location.hash = '#foundation'
            }}
            onModeChange={() => setMode((current) => (current === 'dark' ? 'light' : 'dark'))}
          />
        </Suspense>
      </ThemeProvider>
    )
  }

  if (!foundationRoute) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ClientApp mode={mode} onModeChange={() => setMode((current) => (current === 'dark' ? 'light' : 'dark'))} />
      </ThemeProvider>
    )
  }

  return <FoundationApp mode={mode} onModeChange={() => setMode((current) => (current === 'dark' ? 'light' : 'dark'))} />
}

function FoundationApp({ mode, onModeChange }: { mode: 'light' | 'dark'; onModeChange: () => void }) {
  const [page, setPage] = useState<PageKey>(() => window.location.hash === '#foundation/catalog' ? 'catalog' : 'overview')
  return (
    <ThemeProvider theme={createAppTheme(mode, 'foundation')}>
      <CssBaseline />
      <AppShell
        mode={mode}
        onModeChange={onModeChange}
        onPageChange={setPage}
        page={page}
      >
        {page === 'overview' ? <OverviewPage onPageChange={setPage} /> : null}
        {isModulePage(page) ? <ModulePage module={page} /> : null}
        {page === 'catalog' ? (
          <Suspense fallback={<CatalogLoading />}>
            <UiCatalogPage />
          </Suspense>
        ) : null}
      </AppShell>
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
