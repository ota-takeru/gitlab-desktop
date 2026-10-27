import { defineConfig } from '@playwright/test'

// Visual snapshots of the development UI catalog and the mock workspace.
// Uses the installed Microsoft Edge so no browser download is needed.
// The committed baselines in tests/visual/screenshots are made and compared on CI (windows-latest);
// the UI Preview workflow's manual run with update_snapshots rebuilds them there. Font rendering
// differs between machines, so a local run compares with this machine's own baselines in
// output/ui-snap/baselines instead, recorded on its first run (`npm run ui:snap:update` re-records them).
const onCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.visual.ts',
  outputDir: 'output/ui-snap/results',
  snapshotPathTemplate: onCi ? '{testDir}/screenshots/{arg}{ext}' : 'output/ui-snap/baselines/{arg}{ext}',
  updateSnapshots: onCi ? 'none' : 'missing',
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
