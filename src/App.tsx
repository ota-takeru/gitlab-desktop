import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import { deDE, enUS, esES, frFR, jaJP, koKR, ptBR, ruRU, zhCN, zhTW } from '@mui/material/locale'

import { createAppTheme } from './theme'
import { ClientApp } from './features/ClientApp'
import { FeedbackProvider } from './components/Feedback'
import { readColorPreference, saveColorPreference, useSystemColorMode, type ColorPreference } from './features/colorMode'
import type { Locale } from './i18n/locales'
import { useLocale, useT } from './i18n/useT'

const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./pages/DevelopmentApp')) : null
const FixtureApp = import.meta.env.DEV ? lazy(() => import('./pages/FixtureApp')) : null

/** MUI's own texts (pagination, autocomplete and so on) follow the app language. */
const muiLocales: Record<Locale, typeof enUS> = { en: enUS, ja: jaJP, 'zh-Hans': zhCN, 'zh-Hant': zhTW, ko: koKR, de: deDE, fr: frFR, es: esES, 'pt-BR': ptBR, ru: ruRU }

/** Development screens accept `theme=light|dark` (in the hash or the query) to open in a fixed theme without saving it. */
function routeThemeOverride(route: string): 'light' | 'dark' | null {
  if (!import.meta.env.DEV) return null
  const theme = new URLSearchParams(route.split('?')[1] ?? '').get('theme') ?? new URLSearchParams(window.location.search).get('theme')
  return theme === 'light' || theme === 'dark' ? theme : null
}

export default function App() {
  const [preference, setPreference] = useState<ColorPreference>(readColorPreference)
  const [routeOverride, setRouteOverride] = useState(() => routeThemeOverride(window.location.hash.replace(/^#/u, '')))
  const systemMode = useSystemColorMode()
  const locale = useLocale()
  const mode = routeOverride ?? (preference === 'system' ? systemMode : preference)
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/u, ''))
  useEffect(() => {
    const handleHashChange = () => {
      const next = window.location.hash.replace(/^#/u, '')
      setRoute(next)
      const override = routeThemeOverride(next)
      if (override) setRouteOverride(override)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  const developmentRoute = DevelopmentApp && (route.startsWith('mock') || route.startsWith('foundation'))
  // `?fixture=<state>` keeps the client's own hash routes working.
  const fixtureMode = FixtureApp && new URLSearchParams(window.location.search).has('fixture')
  const theme = useMemo(() => createTheme(createAppTheme(mode), muiLocales[locale]), [locale, mode])
  const onColorPreferenceChange = (next: ColorPreference) => {
    saveColorPreference(next)
    setPreference(next)
    setRouteOverride(null)
  }
  const onModeChange = () => onColorPreferenceChange(mode === 'dark' ? 'light' : 'dark')
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <FeedbackProvider>
      {fixtureMode && FixtureApp ? (
        <Suspense fallback={<CatalogLoading />}>
          <FixtureApp mode={mode} onModeChange={onModeChange} />
        </Suspense>
      ) : developmentRoute && DevelopmentApp ? (
        <Suspense fallback={<CatalogLoading />}>
          <DevelopmentApp mode={mode} onModeChange={onModeChange} route={route} />
        </Suspense>
      ) : <ClientApp colorPreference={preference} onColorPreferenceChange={onColorPreferenceChange} />}
      </FeedbackProvider>
    </ThemeProvider>
  )
}

function CatalogLoading() {
  const t = useT()
  return (
    <Box aria-live="polite" role="status" sx={{ py: 8, textAlign: 'center' }}>
      <Typography color="textSecondary" variant="body2">
        {t('app.loading')}
      </Typography>
    </Box>
  )
}
