import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import type { FileQuery, Position } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { compareCommentCode } from './commentChange'

/** Checks the commented code as soon as the thread is shown. "Old version" is not
 * equivalent to "modified code", so no affirmative status is shown before both reads.
 * Both reads are cached by file and commit, so threads on one file share them. */
export function CommentChangeStatus({ headSha, position, projectId, sessionId }: {
  headSha: string
  position: Position
  projectId: string
  sessionId: string
}) {
  const path = position.newPath || position.oldPath
  const comparable = position.positionType === 'text' && Boolean(position.newLine && path && position.headSha)
  const beforeQuery = useMemo<FileQuery | null>(() => comparable
    ? { kind: 'file', path, projectId, sha: position.headSha } : null,
  [comparable, path, position.headSha, projectId])
  const afterQuery = useMemo<FileQuery | null>(() => comparable
    ? { kind: 'file', path, projectId, sha: headSha } : null,
  [comparable, headSha, path, projectId])
  const before = useGitLabQuery(sessionId, beforeQuery)
  const after = useGitLabQuery(sessionId, afterQuery)
  const failed = before.error || after.error
  const result = !failed && before.data && after.data ? compareCommentCode(before.data.content, after.data.content, position) : null
  return <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
    <Tooltip title="GitLabの古い版へのコメントです。コードが変更されたとは限りません。">
      <Typography color="textSecondary" variant="caption">旧版</Typography>
    </Tooltip>
    {!comparable ? <Typography color="textSecondary" variant="caption">コードの追跡はできません</Typography> : null}
    {comparable && (before.loading || after.loading) && !result ? <Typography color="textSecondary" role="status" variant="caption">コードを照合中…</Typography> : null}
    {comparable && failed ? <Tooltip title={failed.message}><Typography color="textSecondary" variant="caption">検証不能（取得失敗）</Typography></Tooltip> : null}
    {result ? <Tooltip title={result.explanation}><Typography color={result.state === 'changed' ? 'warning' : 'textSecondary'} variant="caption">
      {result.state === 'unchanged' ? 'コード一致' : result.state === 'changed' ? 'コード変更の可能性' : '検証不能'}
    </Typography></Tooltip> : null}
  </Box>
}
