import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
    // One jsdom per worker instead of per file, keeping each file's module isolation; about half the time of the default pool.
    pool: 'vmThreads',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true,
    // Whole screens render in jsdom; a loaded machine running the full suite needs more than the default 5s.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Development-only screens and fixture data are not part of the shipped app.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts', 'src/lib/emojiData.json', 'src/mock/**', 'src/pages/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'output/coverage',
      // A little under the measured coverage (2026-10-27: 83.6 / 79.3 / 83.2 / 87.6), so a drop fails the run.
      thresholds: { statements: 82, branches: 78, functions: 81, lines: 86 },
    },
  },
})
