import { describe, expect, it } from 'vitest'

import { historyStep, type HistoryCursor, type HistoryStep } from '../features/mergeRequests/lineHistory'
import { reviewCacheFinal } from './fileContents'
import { fixtureBlame, fixtureCommitDiff } from './fileHistory'

const PATH = 'src/lib/review-cache.ts'
const head = 'b7c2e81'.padEnd(40, '0')

/** Follows the fixture's history as the app does, with the MR commits' own diffs left out. */
async function follow(start: HistoryCursor): Promise<HistoryStep[]> {
  const steps: HistoryStep[] = []
  let cursor: HistoryCursor | null = start
  while (cursor) {
    const step = await historyStep(cursor, {
      blame: async (sha, path, from, to) => fixtureBlame(path, sha, from, to, reviewCacheFinal) ?? [],
      commitDiff: async (sha) => fixtureCommitDiff(sha, { [PATH]: reviewCacheFinal }) ?? [],
    })
    if (!('commit' in step)) break
    steps.push(step)
    cursor = step.next
  }
  return steps
}

describe('fixture file history', () => {
  it('blames each line to the commit that last wrote it', () => {
    const blocks = fixtureBlame(PATH, head, 1, 5, reviewCacheFinal)!
    expect(blocks.map((block) => [block.title, block.lines.length])).toEqual([
      ['MR一覧の取得を追加', 3],
      ['一覧と詳細のキャッシュ境界を分ける', 1],
      ['更新中もキャッシュを表示して静かに再検証する', 1],
    ])
  })

  it('follows the cache lifetime back through the commits before the MR', async () => {
    const base = 'ba5e'.padEnd(40, '0')
    const steps = await follow({ path: PATH, range: { start: 4, end: 4 }, sha: base })
    expect(steps.map((step) => [step.commit.title, step.stop ?? null])).toEqual([
      ['キャッシュの有効期限を5分に短縮し、未保存をnullで返す', null],
      ['MR詳細をキャッシュ経由で取得する', 'added'],
    ])
  })

  it('creates files it has no history for in one commit', () => {
    const blocks = fixtureBlame('README.md', head, 1, 3, '# A\n\nB')!
    expect(blocks).toHaveLength(1)
    expect(fixtureCommitDiff(blocks[0].commitId, { 'README.md': '# A\n\nB' })).toMatchObject([{ newFile: true, newPath: 'README.md' }])
  })
})
