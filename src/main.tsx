import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'

import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
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

createRoot(rootElement, {
  onCaughtError: ignoreReactError,
  onRecoverableError: ignoreReactError,
  onUncaughtError: ignoreReactError,
}).render(
  <StrictMode>
    <ThemeProvider theme={createAppTheme('dark')}>
      <CssBaseline />
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
