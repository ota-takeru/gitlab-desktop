import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'

import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { readColorPreference, resolveColorMode } from './features/colorMode'
import { currentLocale, initializeLocale } from './i18n/i18n'
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

// A failed language load leaves the app in English; it still opens.
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
