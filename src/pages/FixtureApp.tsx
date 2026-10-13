import Box from '@mui/material/Box'
import { useState } from 'react'

import { StatusPill } from '../components/StatusPill'
import { ClientApp } from '../features/ClientApp'
import { installFixtureIpc, parseFixtureState } from '../mock/fixtureIpc'

// Imported only in development: the real client screens backed by fixture IPC.
export default function FixtureApp({ mode, onModeChange }: { mode: 'light' | 'dark'; onModeChange: () => void }) {
  // Installed during the first render so the client never sees the browser preview runtime.
  const [state] = useState(() => {
    const next = parseFixtureState(new URLSearchParams(window.location.search).get('fixture'))
    installFixtureIpc(next)
    return next
  })
  return (
    <>
      <ClientApp mode={mode} onModeChange={onModeChange} />
      <Box sx={{ bgcolor: 'background.paper', bottom: 0, pointerEvents: 'none', position: 'fixed', px: 1, py: 0.25, right: 0, zIndex: 'snackbar' }}>
        <StatusPill label={`固定データ · GitLab未接続 · ${state}`} tone="warning" />
      </Box>
    </>
  )
}
