import { lazy, Suspense, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { AppShell, type PageKey } from '../components/AppShell'
import { ModulePage } from './ModulePage'
import { OverviewPage } from './OverviewPage'

const UiCatalogPage = lazy(() => import('./UiCatalogPage').then(({ UiCatalogPage }) => ({ default: UiCatalogPage })))
const MockApp = lazy(() => import('./MockApp').then(({ MockApp }) => ({ default: MockApp })))

// This module is imported only in development; production cannot load the demo routes.
export default function DevelopmentApp({ mode, onModeChange, route }: { mode: 'light' | 'dark'; onModeChange: () => void; route: string }) {
  const [page, setPage] = useState<PageKey>(() => route === 'foundation/catalog' ? 'catalog' : 'overview')
  const loading = <Box role="status" sx={{ p: 3 }}><Typography>画面を読み込み中…</Typography></Box>
  if (route.startsWith('mock')) {
    return <Suspense fallback={loading}><MockApp mode={mode} onModeChange={onModeChange} onBackToFoundation={() => { window.location.hash = '#foundation' }} /></Suspense>
  }
  return <AppShell mode={mode} onModeChange={onModeChange} onPageChange={setPage} page={page}>
    {page === 'overview' ? <OverviewPage onPageChange={setPage} /> : null}
    {page === 'merge-requests' || page === 'issues' || page === 'pipelines' ? <ModulePage module={page} /> : null}
    {page === 'catalog' ? <Suspense fallback={loading}><UiCatalogPage /></Suspense> : null}
  </AppShell>
}
