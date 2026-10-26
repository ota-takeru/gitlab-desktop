import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import { formatAbsoluteTime, shortSha } from '../../lib/format'
import { openGitLabUrl } from '../../lib/gitlab'
import type { BlameQuery, CommitMergeRequestsQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'

const BLAME_WINDOW = 80
const MAX_LINE = 1_000_000
const clampLine = (value: number) => Math.max(1, Math.min(MAX_LINE, Math.floor(value) || 1))

/** Bounded revision-specific blame; the related MR API is called only on selection. */
export function BlamePanel({ anchorLine, path, projectId, sessionId, sha }: { anchorLine: number; path: string; projectId: string; sessionId: string; sha: string }) {
  const [start, setStart] = useState(() => clampLine(anchorLine))
  const [input, setInput] = useState(() => String(clampLine(anchorLine)))
  const [commit, setCommit] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const end = Math.min(MAX_LINE, start + BLAME_WINDOW - 1)
  const query = useMemo<BlameQuery>(() => ({ kind: 'blame', path, projectId, sha, startLine: start, endLine: end }), [end, path, projectId, sha, start])
  const result = useGitLabQuery(sessionId, query)
  const relatedQuery = useMemo<CommitMergeRequestsQuery | null>(() => commit ? { kind: 'commitMergeRequests', projectId, sha: commit } : null, [commit, projectId])
  const related = useGitLabQuery(sessionId, relatedQuery)
  const groups = useMemo(() => {
    let line = start
    return (result.data ?? []).map((block) => {
      const group = { ...block, from: line }
      line += block.lines.length
      return group
    })
  }, [result.data, start])
  const jump = () => {
    const value = Number(input)
    const next = Number.isFinite(value) ? clampLine(value) : start
    setStart(next)
    setInput(String(next))
    setCommit(null)
  }
  return <Box aria-label="Blameの行履歴" component="section" sx={{ bgcolor: 'surface.raised', borderBottom: 1, borderColor: 'divider', px: 1.5, py: 1 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      <Typography sx={{ fontWeight: 600 }} variant="subtitle2">Blame · {start}〜{end}行</Typography>
      <Box component="form" onSubmit={(event) => { event.preventDefault(); jump() }} sx={{ alignItems: 'center', display: 'flex', gap: 0.5, ml: 'auto' }}>
        <TextField label="開始行" onChange={(event) => setInput(event.target.value)} size="small" slotProps={{ htmlInput: { min: 1, max: MAX_LINE, 'aria-label': 'Blameの開始行' } }} sx={{ maxWidth: 120 }} type="number" value={input} />
        <Button size="small" type="submit" variant="outlined">移動</Button>
      </Box>
    </Stack>
    {result.loading && !result.data ? <Typography role="status" variant="caption">Blameを読み込み中…</Typography> : null}
    {result.error ? <Alert severity={result.data ? 'warning' : 'error'}>{result.error.message}</Alert> : null}
    {groups.length === 0 && result.data ? <Typography color="textSecondary" variant="body2">この範囲の履歴はありません。</Typography> : null}
    <Stack spacing={0.5} sx={{ maxHeight: 350, overflowY: 'auto' }}>
      {groups.map((group, index) => <Box component="section" key={`${group.commitId}:${index}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', bgcolor: 'surface.list', flexWrap: 'wrap', px: 1, py: 0.5 }}>
          <Button aria-pressed={commit === group.commitId} onClick={() => setCommit((current) => current === group.commitId ? null : group.commitId)} size="small">{shortSha(group.commitId)} · 関連MR</Button>
          <Typography variant="caption">{group.authorName || '作成者不明'}</Typography>
          <Typography color="textSecondary" title={group.committedAt ? formatAbsoluteTime(group.committedAt) : undefined} variant="caption">{group.committedAt ? formatAbsoluteTime(group.committedAt) : '日時不明'}</Typography>
          <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 100 }} title={group.title} variant="caption">{group.title}</Typography>
        </Stack>
        <Box sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', lineHeight: '20px', overflowX: 'auto', p: 0.5 }}>{group.lines.map((line, offset) => <Box component="div" key={offset} sx={{ whiteSpace: 'pre' }}><Box component="span" sx={{ color: 'text.secondary', display: 'inline-block', mr: 1, textAlign: 'right', userSelect: 'none', width: 40 }}>{group.from + offset}</Box>{line}</Box>)}</Box>
      </Box>)}
    </Stack>
    {commit ? <Box sx={{ mt: 1 }}>
      <Typography sx={{ fontWeight: 600 }} variant="caption">{shortSha(commit)}に関連するMR</Typography>
      {related.loading && !related.data ? <Typography color="textSecondary" role="status" variant="caption"> 取得中…</Typography> : null}
      {related.error ? <Alert severity="warning">関連MRを取得できませんでした: {related.error.message}</Alert> : null}
      {related.data?.length === 0 ? <Typography color="textSecondary" variant="body2">関連MRは特定できませんでした。</Typography> : null}
      {(related.data ?? []).map((mr) => <Box key={`${mr.projectId}:${mr.iid}`}><Button onClick={() => void openGitLabUrl(sessionId, mr.webUrl).catch((err: unknown) => setOpenError(err instanceof Error ? err.message : 'MRを開けませんでした。'))} size="small">!{mr.iid} {mr.title}</Button><Typography color="textSecondary" component="span" variant="caption"> · {mr.state}</Typography></Box>)}
      {openError ? <Alert onClose={() => setOpenError(null)} severity="warning">{openError}</Alert> : null}
    </Box> : null}
  </Box>
}
