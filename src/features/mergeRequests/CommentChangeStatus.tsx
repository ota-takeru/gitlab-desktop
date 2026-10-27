import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import type { FileQuery, Position, VersionCompareQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { compareCommentCode, type CommentCodeResult } from './commentChange'

/** Checks the commented code as soon as the thread is shown. "Old version" is not
 * equivalent to "modified code", so no affirmative status is shown before both reads.
 * Both reads are cached by file and commit, so threads on one file share them.
 * When the file is gone from the current version, the MR's comparison between the two
 * versions tells whether it was renamed (and the code is looked for under the new name)
 * or deleted. */
export function CommentChangeStatus({ headSha, iid, position, projectId, sessionId }: {
  headSha: string
  /** Without it, a renamed or deleted file cannot be told apart from a failed read. */
  iid?: string
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
  // The first page of the comparison; a rename on a later page reads as a failed check.
  const compareQuery = useMemo<VersionCompareQuery | null>(() => after.error && iid
    ? { fromSha: position.headSha, iid, kind: 'versionCompare', page: 1, projectId, toSha: headSha } : null,
  [after.error, headSha, iid, position.headSha, projectId])
  const compare = useGitLabQuery(sessionId, compareQuery)
  const moved = compare.data?.find((diff) => diff.oldPath === path && (diff.renamedFile || diff.deletedFile))
  const renamedPath = moved?.renamedFile ? moved.newPath : null
  const renamedQuery = useMemo<FileQuery | null>(() => renamedPath
    ? { kind: 'file', path: renamedPath, projectId, sha: headSha } : null,
  [headSha, projectId, renamedPath])
  const renamed = useGitLabQuery(sessionId, renamedQuery)

  const current = renamedPath ? renamed : after
  const lookingForMove = Boolean(after.error && iid && (compare.loading || (renamedPath && renamed.loading)))
  const failed = before.error || (lookingForMove || moved ? null : after.error) || compare.error || renamed.error
  let result: CommentCodeResult | null = null
  if (!failed && moved?.deletedFile) {
    result = { state: 'changed', explanation: 'コメントしたファイルは現在の版で削除されています。' }
  } else if (!failed && before.data && current.data) {
    result = compareCommentCode(before.data.content, current.data.content, position)
    if (renamedPath) result = { ...result, explanation: `${result.explanation}（ファイル名の変更: ${path} → ${renamedPath}）` }
  }
  const loading = before.loading || after.loading || lookingForMove
  return <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
    <Tooltip title="GitLabの古い版へのコメントです。コードが変更されたとは限りません。">
      <Typography color="textSecondary" variant="caption">旧版</Typography>
    </Tooltip>
    {!comparable ? <Typography color="textSecondary" variant="caption">コードの追跡はできません</Typography> : null}
    {comparable && loading && !result && !failed ? <Typography color="textSecondary" role="status" variant="caption">コードを照合中…</Typography> : null}
    {comparable && failed ? <Tooltip title={failed.message}><Typography color="textSecondary" variant="caption">検証不能（取得失敗）</Typography></Tooltip> : null}
    {result ? <Tooltip title={result.explanation}><Typography color={result.state === 'changed' ? 'warning' : 'textSecondary'} variant="caption">
      {result.state === 'unchanged' ? 'コード一致' : result.state === 'changed' ? 'コード変更の可能性' : '検証不能'}
    </Typography></Tooltip> : null}
  </Box>
}
