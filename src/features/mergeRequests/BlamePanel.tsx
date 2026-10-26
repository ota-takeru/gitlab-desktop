import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { formatAbsoluteTime, shortSha } from '../../lib/format'
import { openGitLabUrl } from '../../lib/gitlab'
import type { BlameBlock, BlameQuery, CommitMergeRequestsQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { blameAttributions, blameWindowStart, BLAME_WINDOW, type BlameAttribution } from './blameLines'
import type { ParsedLine } from './diffParser'

type Side = 'old' | 'new'
interface BlameSide {
  map: ReadonlyMap<number, BlameAttribution>
  start: number | null
  /** No historical SHA means attribution must not be guessed from the other revision. */
  available: boolean
  loading: boolean
  failed: boolean
  loaded: boolean
}
interface BlameContextValue {
  old: BlameSide
  new: BlameSide
  select: (side: Side, line: number, attribution: BlameAttribution, anchorEl: HTMLElement) => void
  request: (side: Side, line: number) => void
}
const BlameContext = createContext<BlameContextValue | null>(null)

/** Fetch only when the user enables Blame. Each side uses the correct Git SHA
 * and file path; the code itself is rendered exclusively by the diff viewer. */
export function BlameProvider({ beforeSha, children, enabled = true, initialNewLine, lines, newPath, oldPath, projectId, sessionId, sha }: {
  beforeSha?: string
  children: ReactNode
  /** Keeps the file subtree mounted when the Blame toggle changes. */
  enabled?: boolean
  /** File-view attribution starts at the visible source line, not line 1. */
  initialNewLine?: number
  lines: ParsedLine[]
  newPath: string
  oldPath: string
  projectId: string
  sessionId: string
  sha: string
}) {
  const [requested, setRequested] = useState<{ old: number | null; new: number | null }>({ old: null, new: null })
  const [selection, setSelection] = useState<{ anchor: HTMLElement; block: BlameBlock; line: number; side: Side } | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const firstNew = initialNewLine ?? lines.find((line) => line.newLine !== undefined)?.newLine
  const firstOld = lines.find((line) => line.oldLine !== undefined)?.oldLine
  const newStart = requested.new ?? (firstNew !== undefined ? blameWindowStart(firstNew) : null)
  const oldStart = requested.old ?? (firstOld !== undefined ? blameWindowStart(firstOld) : null)
  const newQuery: BlameQuery | null = enabled && newStart !== null && newPath
    ? { kind: 'blame', projectId, path: newPath, sha, startLine: newStart, endLine: newStart + BLAME_WINDOW - 1 }
    : null
  const oldQuery: BlameQuery | null = enabled && beforeSha && oldStart !== null && oldPath
    ? { kind: 'blame', projectId, path: oldPath, sha: beforeSha, startLine: oldStart, endLine: oldStart + BLAME_WINDOW - 1 }
    : null
  const current = useGitLabQuery(sessionId, newQuery)
  const previous = useGitLabQuery(sessionId, oldQuery)
  const newMap = useMemo(() => current.data && newStart !== null ? blameAttributions(current.data, newStart) : new Map<number, BlameAttribution>(), [current.data, newStart])
  const oldMap = useMemo(() => previous.data && oldStart !== null ? blameAttributions(previous.data, oldStart) : new Map<number, BlameAttribution>(), [previous.data, oldStart])

  const relatedQuery: CommitMergeRequestsQuery | null = enabled && selection
    ? { kind: 'commitMergeRequests', projectId, sha: selection.block.commitId }
    : null
  const related = useGitLabQuery(sessionId, relatedQuery)

  const value: BlameContextValue = {
    old: { available: Boolean(beforeSha), failed: Boolean(previous.error), loaded: Boolean(previous.data), loading: previous.loading, map: oldMap, start: oldStart },
    new: { available: true, failed: Boolean(current.error), loaded: Boolean(current.data), loading: current.loading, map: newMap, start: newStart },
    request: (side, line) => {
      setRequested((prev) => ({ ...prev, [side]: blameWindowStart(line) }))
    },
    select: (side, line, attribution, anchor) => {
      setSelection({ anchor, block: attribution.block, line, side })
      setOpenError(null)
    },
  }

  return <BlameContext.Provider value={value}>
    {children}
    <Popover anchorEl={selection?.anchor} anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }} onClose={() => setSelection(null)} open={enabled && Boolean(selection)} slotProps={{ paper: { sx: { maxWidth: 420, p: 1.5, width: 'min(420px, calc(100vw - 24px))' } } }}>
      {selection ? <Box aria-label="Blameのコミット詳細" role="dialog">
        <Stack spacing={1}>
          <Typography sx={{ fontWeight: 700 }} variant="subtitle2">{shortSha(selection.block.commitId)} · {selection.block.authorName || '作成者不明'}</Typography>
          <Typography color="textSecondary" variant="caption">{selection.side === 'old' ? '変更前' : '変更後'}の{selection.line}行 · {selection.block.committedAt ? formatAbsoluteTime(selection.block.committedAt) : '日時不明'}</Typography>
          <Typography sx={{ overflowWrap: 'anywhere' }} variant="body2">{selection.block.title || 'コミットメッセージなし'}</Typography>
          <Divider />
          <Typography color="textSecondary" variant="caption">関連MR</Typography>
          {related.loading && !related.data ? <Typography variant="caption">読み込み中…</Typography> : null}
          {related.error ? <Alert severity="warning">関連MRを取得できませんでした: {related.error.message}</Alert> : null}
          {related.data?.length === 0 ? <Typography color="textSecondary" variant="caption">関連MRは見つかりませんでした。</Typography> : null}
          {(related.data ?? []).map((mr) => <Button key={`${mr.projectId}:${mr.iid}`} onClick={() => void openGitLabUrl(sessionId, mr.webUrl).catch((error: unknown) => setOpenError(error instanceof Error ? error.message : 'MRを開けませんでした'))} size="small" sx={{ alignSelf: 'flex-start', justifyContent: 'flex-start', textAlign: 'left' }}>!{mr.iid} {mr.title}</Button>)}
          {openError ? <Alert severity="warning">{openError}</Alert> : null}
        </Stack>
      </Box> : null}
    </Popover>
  </BlameContext.Provider>
}

/** A narrow gutter within the actual diff row, not a second code viewer. */
export function BlameCell({ line, side }: { line?: number; side: Side }) {
  const context = useContext(BlameContext)
  if (!context || line === undefined) return <span className="blame-cell" />
  const state = context[side]
  if (!state.available) return <span aria-label="このリビジョンの変更前の履歴はありません" className="blame-cell">—</span>
  const inWindow = state.start !== null && line >= state.start && line < state.start + BLAME_WINDOW
  const attribution = inWindow ? state.map.get(line) : undefined
  const buttonLabel = attribution
    ? `${line}行のBlame: ${shortSha(attribution.block.commitId)} ${attribution.block.authorName}`
    : `${line}行のBlameを取得`
  const display = attribution
    ? attribution.first ? shortSha(attribution.block.commitId) : '│'
    : inWindow && state.loading ? '…' : inWindow && state.failed ? '!' : inWindow && state.loaded ? '—' : '…'
  const title = attribution
    ? `${shortSha(attribution.block.commitId)} · ${attribution.block.authorName} · ${attribution.block.title}`
    : state.failed && inWindow ? '取得に失敗しました' : 'この行の履歴を取得'
  return <span className="blame-cell" data-side={side}>
    <button aria-label={buttonLabel} className="blame-action" onClick={(event) => {
      event.stopPropagation()
      if (attribution) context.select(side, line, attribution, event.currentTarget)
      else context.request(side, line)
    }} title={title} type="button">
      {display}
    </button>
    {attribution?.first ? <span className="blame-author" title={attribution.block.authorName}>{attribution.block.authorName}</span> : null}
  </span>
}
