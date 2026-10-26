import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { FullFileView } from '../mergeRequests/DiffViewer'
import type { BlobQuery, Project, TreeEntry, TreeQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'

/** Look for a README without requesting every repository file or every project's README. */
export function chooseReadmeFile(entries: readonly TreeEntry[]): TreeEntry | undefined {
  const files = entries.filter((entry) => entry.type === 'blob' && /^readme(?:\.(?:md|markdown|mdown|txt))?$/iu.test(entry.name))
  const priority = (name: string) => name.toLowerCase() === 'readme.md' ? 0 : /\.(?:md|markdown|mdown)$/iu.test(name) ? 1 : 2
  return [...files].sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name))[0]
}

export function ProjectReadmePreview({ project, sessionId }: { project: Project; sessionId: string }) {
  const treeQuery = useMemo<TreeQuery>(() => ({ kind: 'tree', projectId: project.id, path: '', page: 1 }), [project.id])
  const tree = useGitLabQuery(sessionId, treeQuery)
  const readme = chooseReadmeFile(tree.data ?? [])
  const blobQuery = useMemo<BlobQuery | null>(() => readme ? { kind: 'blob', projectId: project.id, sha: readme.id } : null, [project.id, readme?.id])
  const blob = useGitLabQuery(sessionId, blobQuery)
  const markdown = Boolean(readme && /\.(?:md|markdown|mdown)$/iu.test(readme.name) && (blob.data?.content.length ?? 0) <= 200_000)
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
