import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Component, Fragment, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  resetKey: number
  retryCount: number
}

/**
 * Keeps rendering failures inside the app recoverable without exposing the
 * exception object to the UI or to an application logger.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    resetKey: 0,
    retryCount: 0,
  }

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true }
  }

  private retry = () => {
    this.setState((state) => ({
      hasError: false,
      resetKey: state.resetKey + 1,
      retryCount: state.retryCount + 1,
    }))
  }

  private goToConnectionSettings = () => {
    window.location.hash = '#client/settings'
    this.setState((state) => ({
      hasError: false,
      resetKey: state.resetKey + 1,
      retryCount: 0,
    }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <AppErrorFallback
          onGoToConnectionSettings={this.goToConnectionSettings}
          onRetry={this.retry}
          retryCount={this.state.retryCount}
        />
      )
    }

    // Changing the fragment key remounts the failed subtree when the user
    // retries, which also clears stale local component state.
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
  }
}

interface AppErrorFallbackProps {
  onGoToConnectionSettings: () => void
  onRetry: () => void
  retryCount: number
  compact?: boolean
}

export function AppErrorFallback({
  onGoToConnectionSettings,
  onRetry,
  retryCount,
  compact = false,
}: AppErrorFallbackProps) {
  return (
    <Box
      aria-label="画面エラー"
      role="alert"
      sx={{
        alignItems: 'center',
        bgcolor: 'background.default',
        display: 'flex',
        justifyContent: 'center',
        minHeight: compact ? undefined : '100vh',
        p: { md: 4, xs: 2 },
      }}
    >
      <Paper
        component="main"
        sx={{ maxWidth: 600, p: { md: 4, xs: 3 }, width: '100%' }}
        variant="outlined"
      >
        <Stack spacing={2}>
          <Typography color="error.main" sx={{ fontWeight: 800 }} variant="overline">
            GitLab Desktop
          </Typography>
          <Typography component="h1" variant="h1">
            画面を表示できません
          </Typography>
          <Typography color="text.secondary" variant="body1">
            画面の表示中に問題が発生しました。再表示を試してください。
          </Typography>
          {retryCount > 0 ? (
            <Alert severity="warning">
              再表示しても画面を表示できませんでした。アプリを再起動してください。
            </Alert>
          ) : null}
          <Stack
            direction={{ sm: 'row', xs: 'column' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center', xs: 'stretch' } }}
          >
            <Button onClick={onRetry} variant="contained">
              再表示
            </Button>
            <Button onClick={onGoToConnectionSettings} variant="outlined">
              接続設定へ移動
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  )
}
