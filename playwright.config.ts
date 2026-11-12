import { defineConfig } from '@playwright/test'

// Visual snapshots of the development UI catalog and the mock workspace.
// Uses the installed Microsoft Edge so no browser download is needed.
// The committed baselines in tests/visual/screenshots are made and compared on CI (windows-latest);
// the UI Preview workflow's manual run with update_snapshots rebuilds them there. Font rendering
// differs between machines, so a local run compares with this machine's own baselines in
// output/ui-snap/baselines instead, recorded on its first run (`npm run ui:snap:update` re-records them).
// `npm run ui:check` compares a local run with the committed baselines, to see before a push what CI will see.
const onCi = Boolean(process.env.CI)
const committedBaselines = onCi || process.env.UI_SNAP_BASELINES === 'committed'
// UI_PORT moves the server these tests start off 1420, which `npm run dev` or another checkout may hold.
const port = Number(process.env.UI_PORT) || 1420

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.visual.ts',
  outputDir: 'output/ui-snap/results',
  snapshotPathTemplate: committedBaselines ? '{testDir}/screenshots/{arg}{ext}' : 'output/ui-snap/baselines/{arg}{ext}',
  updateSnapshots: committedBaselines ? 'none' : 'missing',
  fullyParallel: true,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'output/ui-snap/report' }]],
  // Font anti-aliasing differs slightly between Windows machines; layout changes move far more pixels.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: `http://localhost:${port}`,
    channel: 'msedge',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  webServer: {
    command: `npx vite --host localhost --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // A server left running from another checkout would be compared in place of this one.
    reuseExistingServer: !committedBaselines,
  },
})
