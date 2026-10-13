import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it } from 'vitest'

import { mutateGitLab, queryGitLab } from '../lib/gitlab'
import { installFixtureIpc } from './fixtureIpc'
import { fixtureTime, toUnifiedDiff } from './gitlabFixtures'

const mr = { iid: '42', projectId: '101' }

afterEach(() => {
  clearMocks()
  Reflect.deleteProperty(globalThis, 'isTauri')
})

describe('fixture IPC', () => {
  it('answers the real client queries with fixture snapshots', async () => {
    installFixtureIpc('ready')
    const list = await queryGitLab({ mode: 'network', query: { kind: 'mrs', page: 1, search: '', state: 'opened' }, sessionId: 'fixture-session' })
    expect(list?.data.map((item) => `${item.projectId}-${item.iid}`)).toContain('101-42')
    expect(await queryGitLab({ mode: 'cache', query: { kind: 'mr', ...mr }, sessionId: 'fixture-session' })).toBeNull()
  })

  it('keeps a reply in memory so the refreshed thread shows it', async () => {
    installFixtureIpc('ready')
    const query = { kind: 'discussions' as const, page: 1, ...mr }
    const before = await queryGitLab({ mode: 'network', query, sessionId: 'fixture-session' })
    const discussionId = before!.data[0].id
    await mutateGitLab({ action: { body: '返信', discussionId, kind: 'reply', ...mr }, sessionId: 'fixture-session' })
    const after = await queryGitLab({ mode: 'network', query, sessionId: 'fixture-session' })
    expect(after!.data[0].notes.at(-1)?.body).toBe('返信')
  })

  it('serves stale cache with a failing refresh, and empty collections', async () => {
    installFixtureIpc('stale')
    const cached = await queryGitLab({ mode: 'cache', query: { kind: 'mr', ...mr }, sessionId: 'fixture-session' })
    expect(cached?.source).toBe('cache')
    await expect(queryGitLab({ mode: 'network', query: { kind: 'mr', ...mr }, sessionId: 'fixture-session' })).rejects.toMatchObject({ code: 'NETWORK' })
    clearMocks()
    installFixtureIpc('empty')
    const empty = await queryGitLab({ mode: 'network', query: { kind: 'mrs', page: 1, search: '', state: 'opened' }, sessionId: 'fixture-session' })
    expect(empty?.data).toEqual([])
  })
})

describe('fixture conversion', () => {
  it('places mock display times before now', () => {
    const now = new Date(2026, 0, 10, 18, 0).getTime()
    expect(fixtureTime('12分前', now)).toBe(new Date(now - 12 * 60_000).toISOString())
    expect(fixtureTime('昨日 09:18', now)).toBe(new Date(2026, 0, 9, 9, 18).toISOString())
    expect(fixtureTime('9月18日', now)).toBe(new Date(2025, 8, 18, 12, 0).toISOString())
  })

  it('starts a new hunk where line numbers jump', () => {
    const diff = toUnifiedDiff({
      additions: 1,
      deletions: 0,
      lines: [
        { code: 'a', kind: 'context', newLine: 1, oldLine: 1 },
        { code: 'b', kind: 'addition', newLine: 2 },
        { code: 'z', kind: 'context', newLine: 21, oldLine: 20 },
      ],
      path: 'x.ts',
    })
    expect(diff).toBe('@@ -1,1 +1,2 @@\n a\n+b\n@@ -20,1 +21,1 @@\n z')
  })
})
