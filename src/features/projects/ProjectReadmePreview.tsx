import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { isMarkdownFilePath } from '../../lib/markdownFiles'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { FullFileView } from '../mergeRequests/DiffViewer'
import type { BlobQuery, Project, TreeQuery } from '../../types/gitlab'
import { chooseReadmeFile } from './readmeFiles'
import { useGitLabQuery } from '../shared/useGitLabQuery'

export function ProjectReadmePreview({ project, sessionId }: { project: Project; sessionId: string }) {
  const treeQuery = useMemo<TreeQuery>(() => ({ kind: 'tree', projectId: project.id, path: '', page: 1 }), [project.id])
  const tree = useGitLabQuery(sessionId, treeQuery)
  const readme = chooseReadmeFile(tree.data ?? [])
  // The query cache keys its data by serialized parameters. No useMemo is
  // needed here, avoiding stale dependencies when the selected README changes.
  const blobQuery: BlobQuery | null = readme?.id
    ? { kind: 'blob', projectId: project.id, sha: readme.id }
    : null
  const blob = useGitLabQuery(sessionId, blobQuery)
  const markdown = Boolean(readme && (isMarkdownFilePath(readme.name) || /^readme$/iu.test(readme.name)))
  return <Box aria-label={`${project.name}のREADME`} component="section" sx={{ maxHeight: 440, overflow: 'auto', px: 1 }}>
    <Typography sx={{ fontWeight: 600, mb: 1 }} variant="subtitle2">READMEプレビュー{readme ? ` · ${readme.name}` : ''}</Typography>
    {tree.loading || readme && blob.loading ? <Typography color="textSecondary" variant="body2">読み込み中…</Typography> : null}
    {tree.error ? <Alert severity="warning">READMEの一覧を取得できませんでした: {tree.error.message}</Alert> : null}
    {readme && blob.error ? <Alert severity="warning">READMEを取得できませんでした: {blob.error.message}</Alert> : null}
    {tree.data && !readme ? <Typography color="textSecondary" variant="body2">{tree.snapshot?.nextPage ? '先頭100件にはREADMEがありません。残りのファイルはコードタブから確認してください。' : 'READMEがありません。'}</Typography> : null}
    {blob.data && markdown ? <MarkdownLinkProvider instanceUrl={new URL(project.webUrl).origin} projectUrl={project.webUrl} sessionId={sessionId}><MockMarkdown body={blob.data.content} size="body1" /></MarkdownLinkProvider> : null}
    {blob.data && !markdown ? <FullFileView content={blob.data.content} language="text" loading={false} /> : null}
  </Box>
}
