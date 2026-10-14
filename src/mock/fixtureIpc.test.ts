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

  it('finds groups and narrows MR search to a chosen group', async () => {
    installFixtureIpc('ready')
    const groups = await queryGitLab({ mode: 'network', query: { kind: 'groups', page: 1, search: '' }, sessionId: 'fixture-session' })
    const group = groups!.data.find((item) => item.fullPath === 'platform')
    expect(group).toMatchObject({ fullPath: 'platform', name: 'platform' })
    const list = await queryGitLab({ mode: 'network', query: { groupId: group!.id, kind: 'mrs', page: 1, search: '', state: 'all' }, sessionId: 'fixture-session' })
    expect(list!.data.length).toBeGreaterThan(0)
    expect(list!.data.every((item) => item.projectPath?.startsWith('platform/'))).toBe(true)
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

  it('answers label and milestone candidates and applies merge operations to its own copy', async () => {
    installFixtureIpc('ready')
    const labels = await queryGitLab({ mode: 'network', query: { kind: 'labels', page: 1, projectId: mr.projectId, search: 'perf' }, sessionId: 'fixture-session' })
    expect(labels!.data.map((label) => label.name)).toEqual(['performance'])
    expect(labels!.data[0].color).toMatch(/^#[0-9a-f]{6}$/u)
    const milestones = await queryGitLab({ mode: 'network', query: { kind: 'milestones', page: 1, projectId: mr.projectId, search: '' }, sessionId: 'fixture-session' })
    expect(milestones!.data.length).toBeGreaterThan(0)

    const query = { kind: 'mr' as const, ...mr }
    const before = (await queryGitLab({ mode: 'network', query, sessionId: 'fixture-session' }))!.data
    await expect(mutateGitLab({ action: { expectedTitle: 'changed elsewhere', kind: 'setTitle', title: 'New', ...mr }, sessionId: 'fixture-session' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await mutateGitLab({ action: { expectedTitle: before.title, kind: 'setTitle', title: `Draft: ${before.title}`, ...mr }, sessionId: 'fixture-session' })
    await mutateGitLab({ action: { kind: 'setState', stateEvent: 'close', ...mr }, sessionId: 'fixture-session' })
    const after = (await queryGitLab({ mode: 'network', query, sessionId: 'fixture-session' }))!.data
    expect(after).toMatchObject({ draft: true, state: 'closed', title: `Draft: ${before.title}` })
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
