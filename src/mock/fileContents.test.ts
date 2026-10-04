import { describe, expect, it } from 'vitest'

import { getMockCommitsForMergeRequest } from './commits'
import { mockMergeRequests } from './fixtures'

function contentLines(content: string) {
  return content.split(/\r?\n/)
}

describe('offline full-file snapshots', () => {
  it('provides complete snapshots for every fixture path and keeps diff additions aligned', () => {
    const files = [
      ...mockMergeRequests.flatMap((mergeRequest) => mergeRequest.files),
      ...mockMergeRequests.flatMap((mergeRequest) => getMockCommitsForMergeRequest(mergeRequest.id).flatMap((commit) => commit.files)),
    ]
    expect(new Set(files.map((file) => file.path))).toHaveLength(8)
    for (const file of files) {
      expect(file.fullContent).toEqual(expect.any(String))
      const lines = contentLines(file.fullContent ?? '')
      for (const diffLine of file.lines) {
        if (diffLine.kind === 'deletion' || diffLine.newLine === undefined) continue
        expect(lines[diffLine.newLine - 1], `${file.path}:${diffLine.newLine}`).toBe(diffLine.code)
      }
    }
  })

  it('uses the final commit snapshot for the overall MR and keeps the earlier commit distinct', () => {
    const mergeRequest = mockMergeRequests[0]
    const commits = getMockCommitsForMergeRequest(mergeRequest.id)
    const overallCache = mergeRequest.files.find((file) => file.path === 'src/lib/review-cache.ts')
    const firstCache = commits[0].files.find((file) => file.path === 'src/lib/review-cache.ts')
    const finalCache = commits.at(-1)?.files.find((file) => file.path === 'src/lib/review-cache.ts')
    const overallQuery = mergeRequest.files.find((file) => file.path === 'src/search/query-runner.ts')
    const finalQuery = commits.at(-1)?.files.find((file) => file.path === 'src/search/query-runner.ts')

    expect(overallCache?.fullContent).toBe(finalCache?.fullContent)
    expect(firstCache?.fullContent).not.toBe(finalCache?.fullContent)
    expect(firstCache?.fullContent).toContain('DETAIL_CACHE_TTL_MS = 5 * 60 * 1000')
    expect(finalCache?.fullContent).toContain('DETAIL_CACHE_TTL_MS = 10 * 60 * 1000')
    expect(overallQuery?.fullContent).toBe(finalQuery?.fullContent)
  })
})
