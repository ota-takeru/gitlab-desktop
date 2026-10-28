import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'

import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { readColorPreference, resolveColorMode } from './features/colorMode'
import { currentLocale, initializeLocale, subscribeToLocale } from './i18n/i18n'
import { isTauri, setTextLanguage } from './lib/runtime'
import { createAppTheme } from './theme'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element was not found.')
}

// React's default root error reporters include the exception and component
// stack in the developer console. The UI boundary owns user recovery, so the
// root callbacks deliberately remain silent and never receive application
// error details elsewhere.
const ignoreReactError = () => undefined

// Files that are not UTF-8 are read in the encoding the interface language suggests.
const syncTextLanguage = () => { if (isTauri()) setTextLanguage(currentLocale()).catch(() => undefined) }
subscribeToLocale(syncTextLanguage)

// The app opens even if no language could load.
void initializeLocale().catch(() => undefined).then(() => createRoot(rootElement, {
  onCaughtError: ignoreReactError,
  onRecoverableError: ignoreReactError,
  onUncaughtError: ignoreReactError,
}).render(
  <StrictMode>
    {/* The root error screen sits outside App's theme, so it reads the saved appearance itself. */}
    <ThemeProvider theme={createAppTheme(resolveColorMode(readColorPreference()), currentLocale())}>
      <CssBaseline />
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
))
