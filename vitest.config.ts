import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true,
    // Whole screens render in jsdom; a loaded machine running the full suite needs more than the default 5s.
    testTimeout: 30_000,
  },
})
