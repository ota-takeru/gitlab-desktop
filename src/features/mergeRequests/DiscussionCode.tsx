import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useMemo, type ReactNode } from 'react'

import type { Diff, FileQuery, Position } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { splitFileLines, type ParsedLine } from './diffParser'
import { diffExcerpt, LINES_AFTER, LINES_BEFORE } from './diffExcerpt'

export interface CurrentDiffs {
  find: (path: string) => Diff | undefined
  /** True until every commented file is found or no further page can help. */
  searching: boolean
}

/**
 * The code a line comment refers to: its lines in the current diff, or the
 * file as it was at the commented commit when the diff cannot show them.
 */
export function DiscussionCode({ current, position, projectId, sessionId }: { current: CurrentDiffs | null; position: Position; projectId: string; sessionId: string }) {
  const diff = current?.find(position.newPath || position.oldPath)
  const excerpt = useMemo(() => diff && !diff.tooLarge ? diffExcerpt(diff, position) : null, [diff, position])
  if (excerpt) return <DiffExcerpt lines={excerpt.lines} target={excerpt.target} />
  if (current?.searching) return <CodeMessage>コードを読み込み中…</CodeMessage>
  return <FileExcerpt outdated={!current} position={position} projectId={projectId} sessionId={sessionId} />
}

const codeSx = {
  fontFamily: 'typography.code.fontFamily',
  fontSize: 12,
  lineHeight: '20px',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
} as const

function DiffExcerpt({ lines, target }: { lines: ParsedLine[]; target: number }) {
  return <Box aria-label="コメント対象の差分" component="figure" role="group" sx={{ m: 0 }}>
    {lines.map((line, index) => (
      <Box
        data-kind={line.kind}
        data-target={index === target ? 'true' : undefined}
        key={`${line.oldLine ?? ''}:${line.newLine ?? ''}:${index}`}
        sx={(theme) => ({
          ...codeSx,
          display: 'grid',
          gridTemplateColumns: '40px 40px 16px minmax(0, 1fr)',
          '&[data-kind="add"]': { bgcolor: theme.palette.diff?.addedBackground, color: theme.palette.diff?.addedText },
          '&[data-kind="remove"]': { bgcolor: theme.palette.diff?.deletedBackground, color: theme.palette.diff?.deletedText },
          '&[data-target="true"]': { boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` },
        })}
      >
        <Box component="span" sx={{ color: 'text.secondary', pr: 1, textAlign: 'right' }}>{line.oldLine ?? ''}</Box>
        <Box component="span" sx={{ color: 'text.secondary', pr: 1, textAlign: 'right' }}>{line.newLine ?? ''}</Box>
        <Box aria-hidden component="span">{line.prefix}</Box>
        <Box component="span" sx={{ pr: 1 }}>{line.text}</Box>
      </Box>
    ))}
  </Box>
}

function FileExcerpt({ outdated, position, projectId, sessionId }: { outdated: boolean; position: Position; projectId: string; sessionId: string }) {
  // Removed lines exist only in the base version; other lines in the commented head.
  const onNewSide = position.newLine !== undefined
  const line = (onNewSide ? position.newLine : position.oldLine) ?? 0
  const sha = onNewSide ? position.headSha : position.baseSha
  const path = onNewSide ? position.newPath : position.oldPath
  const query = useMemo<FileQuery | null>(() => sha && path ? { kind: 'file', path, projectId, sha } : null, [path, projectId, sha])
  const result = useGitLabQuery<FileQuery>(sessionId, query)
  const lines = useMemo(() => result.data ? splitFileLines(result.data.content) : null, [result.data])
  if (!query) return null
  if (result.error && !lines) return <CodeMessage>コードを取得できませんでした: {result.error.message}</CodeMessage>
  if (!lines) return <CodeMessage>コードを読み込み中…</CodeMessage>
  if (line < 1 || line > lines.length) return <CodeMessage>コメント対象の行がファイルにありません。</CodeMessage>
  const start = Math.max(1, line - LINES_BEFORE)
  const end = Math.min(lines.length, line + LINES_AFTER)
  return <Box>
    {outdated ? <Typography color="text.secondary" component="div" sx={{ px: 1, py: 0.5 }} variant="caption">コメント時点のコード（{sha.slice(0, 8)}）。その後の変更で現在の差分とは異なります。</Typography> : null}
    <Box aria-label="コメント対象のコード" component="figure" role="group" sx={{ m: 0 }}>
      {lines.slice(start - 1, end).map((text, index) => {
        const number = start + index
        return <Box
          data-target={number === line ? 'true' : undefined}
          key={number}
          sx={(theme) => ({ ...codeSx, display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', '&[data-target="true"]': { bgcolor: 'action.selected', boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}` } })}
        >
          <Box component="span" sx={{ color: 'text.secondary', pr: 1, textAlign: 'right' }}>{number}</Box>
          <Box component="span" sx={{ pr: 1 }}>{text}</Box>
        </Box>
      })}
    </Box>
  </Box>
}

function CodeMessage({ children }: { children: ReactNode }) {
  return <Typography color="text.secondary" component="div" role="status" sx={{ px: 1.5, py: 1 }} variant="caption">{children}</Typography>
}
