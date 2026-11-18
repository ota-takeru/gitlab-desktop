import assert from 'node:assert/strict'
import { test } from 'node:test'

import { blockingAdvisories } from './npm-audit.mjs'

const advisory = (id, severity) => ({ severity, source: 1, title: id, url: `https://github.com/advisories/${id}` })

test('ignores only the listed advisory and keeps other high or critical ones blocking', () => {
  const report = {
    vulnerabilities: {
      picomatch: { via: [advisory('GHSA-fc5q-39xc-vjpf', 'high')] },
      fdir: { via: ['picomatch'] },
      minimatch: { via: [advisory('GHSA-g3hv-75wg-m249', 'moderate')] },
      other: { via: [advisory('GHSA-aaaa-bbbb-cccc', 'critical')] },
    },
  }
  assert.deepEqual(blockingAdvisories(report), ['other: https://github.com/advisories/GHSA-aaaa-bbbb-cccc'])
})

test('passes a report with no vulnerabilities', () => {
  assert.deepEqual(blockingAdvisories({ vulnerabilities: {} }), [])
})
