import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./features/ClientApp', () => ({ ClientApp: () => <main>製品クライアント</main> }))

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
})

it.each(['#foundation/catalog', '#mock'])('does not open development screens for %s in production', async (hash) => {
  vi.stubEnv('DEV', false)
  vi.resetModules()
  window.history.replaceState(null, '', hash)
  const { default: App } = await import('./App')
  render(<App />)
  expect(screen.getByText('製品クライアント')).toBeInTheDocument()
  expect(screen.queryByText('UI catalog')).not.toBeInTheDocument()
  expect(screen.queryByText('UIモック')).not.toBeInTheDocument()
})
