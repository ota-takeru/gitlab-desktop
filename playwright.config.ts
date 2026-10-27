import { defineConfig } from '@playwright/test'

// Visual snapshots of the development UI catalog and the mock workspace.
// Uses the installed Microsoft Edge so no browser download is needed; refresh the
// baselines with `npm run ui:snap:update` after an Edge update changes rendering. CI compares them on
// windows-latest; the UI Preview workflow's manual run with update_snapshots rebuilds them there.
export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.visual.ts',
  outputDir: 'output/ui-snap/results',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  fullyParallel: true,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'output/ui-snap/report' }]],
  // Font anti-aliasing differs slightly between Windows machines; layout changes move far more pixels.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: 'http://localhost:1420',
    channel: 'msedge',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
  },
})
