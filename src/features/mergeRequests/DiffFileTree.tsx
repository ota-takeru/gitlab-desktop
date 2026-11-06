import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DoneRoundedIcon from '@mui/icons-material/DoneRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import MarkChatUnreadOutlinedIcon from '@mui/icons-material/MarkChatUnreadOutlined'
import Box from '@mui/material/Box'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { memo, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { useT } from '../../i18n/useT'
import type { Diff } from '../../types/gitlab'
import { fileRowLabel, fileRowNotes, threadLabel, type FileThreadCount } from './diffLineThreads'
import { buildFileTree, type FileEntry, type TreeNode } from './diffFileOrder'
import type { DiffLineCounts } from './diffParser'
import { LineCounts } from './diffShared'
import { PathTooltip } from './PathTooltip'


/**
 * Changed files as a folder tree, as in GitLab's file browser: folders first,
 * and a folder with only one folder inside shows as one row (`src/features`).
 */
export const DiffFileTree = memo(function DiffFileTree({ displayedPath, entries, expandAll, fileMark, isReviewed, lineCounts, onSelect, threadCount }: { displayedPath: string | null; entries: FileEntry[]; expandAll: boolean; fileMark: (diff: Diff) => ReactNode; isReviewed: (path: string) => boolean; /** Null for a file whose diff GitLab left out. */ lineCounts?: ReadonlyMap<string, DiffLineCounts | null>; onSelect: (path: string) => void; threadCount?: (path: string) => FileThreadCount | undefined }) {
  const t = useT()
  const tree = useMemo(() => buildFileTree(entries), [entries])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = (path: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  // The shown file's folders stay open, also when it is reached with next/previous file.
  const isOpen = (path: string) => expandAll || !collapsed.has(path) || Boolean(displayedPath?.startsWith(`${path}/`))

  const rows: ReactNode[] = []
  const visit = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const indent = 1 + depth * 1.5
      if (node.kind === 'directory') {
        const open = isOpen(node.path)
        rows.push(<PathTooltip key={`d:${node.path}`} path={node.path}><ListItemButton aria-expanded={open} aria-label={t('review.fileTree.folder', { path: node.path })} onClick={() => toggle(node.path)} sx={{ gap: 0.5, pl: indent, pr: 1, py: 0.25 }}>
          <Box component="span" sx={{ alignItems: 'center', color: 'text.secondary', display: 'flex' }}>{open ? <ExpandMoreRoundedIcon fontSize="inherit" /> : <ChevronRightRoundedIcon fontSize="inherit" />}</Box>
          <FolderOutlinedIcon fontSize="inherit" sx={{ color: 'text.secondary' }} />
          <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="body2">{node.name}</Typography>
        </ListItemButton></PathTooltip>)
        if (open) visit(node.children, depth + 1)
        continue
      }
      const { diff, path } = node.entry
      const selected = path === displayedPath
      const threads = threadCount?.(path)
      const reviewed = isReviewed(path)
      const lines = lineCounts?.get(path)
      rows.push(<PathTooltip key={`f:${diff.oldPath}\0${path}`} notes={fileRowNotes(threads, reviewed)} oldPath={diff.renamedFile ? diff.oldPath : undefined} path={path}><ListItemButton aria-label={fileRowLabel(path, threads, reviewed, lines)} onClick={() => onSelect(path)} selected={selected} sx={{ gap: 1, pl: indent + 0.5, pr: 1, py: 0.25 }}>
        {fileMark(diff)}
        <Typography noWrap sx={{ flex: 1, fontWeight: selected ? 600 : 400, minWidth: 0 }} variant="body2">{node.name}</Typography>
        {lines ? <LineCounts {...lines} /> : null}
        <FileThreadMark count={threads} />
        {reviewed ? <DoneRoundedIcon aria-label={t('review.fileTree.reviewed')} color="success" fontSize="small" /> : null}
      </ListItemButton></PathTooltip>)
    }
  }
  visit(tree, 0)
  return <>{rows}</>
})

/** Threads on a file; unresolved ones get their own icon, so the state does not rest on colour alone. The row's tooltip says what the mark means. */
export function FileThreadMark({ count }: { count?: FileThreadCount }) {
  if (!count?.total) return null
  return <Box aria-label={threadLabel(count)} component="span" data-unresolved={count.unresolved > 0 ? 'true' : undefined} role="img" sx={{ alignItems: 'center', color: count.unresolved ? 'warning.main' : 'text.secondary', display: 'inline-flex', flexShrink: 0, gap: 0.25, typography: 'caption' }}>
    {count.unresolved ? <MarkChatUnreadOutlinedIcon fontSize="inherit" /> : <ChatBubbleOutlineRoundedIcon fontSize="inherit" />}
    {/* The number is drawn from `data-count`; the label above says it, so a row's name is not given a stray digit. */}
    <Box component="span" data-count={count.unresolved || count.total} sx={{ '&::before': { content: 'attr(data-count)' } }} />
  </Box>
}
