import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import type { FileQuery, Position } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { compareCommentCode } from './commentChange'

/** Only checks source code on demand. "Old version" is not equivalent to
 * "modified code", so no affirmative status is shown before both reads. */
export function CommentChangeStatus({ headSha, position, projectId, sessionId }: {
  headSha: string
  position: Position
  projectId: string
  sessionId: string
}) {
  const [requested, setRequested] = useState(false)
  const path = position.newPath || position.oldPath
  const comparable = position.positionType === 'text' && Boolean(position.newLine && path && position.headSha)
  const beforeQuery = useMemo<FileQuery | null>(() => requested && comparable
    ? { kind: 'file', path, projectId, sha: position.headSha } : null,
  [comparable, path, position.headSha, projectId, requested])
  const afterQuery = useMemo<FileQuery | null>(() => requested && comparable
    ? { kind: 'file', path, projectId, sha: headSha } : null,
  [comparable, headSha, path, projectId, requested])
  const before = useGitLabQuery(sessionId, beforeQuery)
  const after = useGitLabQuery(sessionId, afterQuery)
  const failed = before.error || after.error
  const result = !failed && before.data && after.data ? compareCommentCode(before.data.content, after.data.content, position) : null
  return <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
    <Tooltip title="GitLabの古い版へのコメントです。コードが変更されたとは限りません。">
      <Typography color="textSecondary" variant="caption">旧版</Typography>
    </Tooltip>
    {!requested && comparable ? <Button aria-label="コメント対象コードの変更を確認" onClick={() => setRequested(true)} size="small">変更を確認</Button> : null}
    {!comparable ? <Typography color="textSecondary" variant="caption">コードの追跡はできません</Typography> : null}
    {requested && (before.loading || after.loading) && !result ? <Typography color="textSecondary" role="status" variant="caption">コードを照合中…</Typography> : null}
    {requested && failed ? <Tooltip title={failed.message}><Typography color="textSecondary" variant="caption">検証不能（取得失敗）</Typography></Tooltip> : null}
    {result ? <Tooltip title={result.explanation}><Typography color={result.state === 'changed' ? 'warning.main' : 'textSecondary'} variant="caption">
      {result.state === 'unchanged' ? 'コード一致' : result.state === 'changed' ? 'コード変更の可能性' : '検証不能'}
    </Typography></Tooltip> : null}
  </Box>
}
