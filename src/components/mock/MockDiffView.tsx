import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import KeyboardArrowRightOutlinedIcon from '@mui/icons-material/KeyboardArrowRightOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { MockChangedFile, MockDiscussion, MockDiffLine } from '../../mock/fixtures'
import type { MockCommentPosition } from '../../mock/reviewTypes'

export type MockDiffDisplayMode = 'diff' | 'full'

interface MockDiffViewProps {
  files: MockChangedFile[]
  discussions: MockDiscussion[]
  selectedPath: string
  onSelectPath: (path: string) => void
  onOpenDiscussion: () => void
  displayMode: MockDiffDisplayMode
  onDisplayModeChange: (mode: MockDiffDisplayMode) => void
  contentVersionLabel?: string
  showDiscussionMarkers?: boolean
  onAddComment?: (position: MockCommentPosition) => void
  commentScope?: MockCommentPosition['scope']
}

function lineHasDiscussion(line: MockDiffLine, filePath: string, discussions: MockDiscussion[], sha: string, scope: MockCommentPosition['scope'], allowLegacyFallback: boolean) {
  const side = line.kind === 'deletion' ? 'old' : 'new'
  const lineNumber = side === 'old' ? line.oldLine : line.newLine
  if (lineNumber === undefined) return false

  const positionedMatch = discussions.some((discussion) => {
    const position = discussion.position
    return position?.path === filePath
      && position.side === side
      && position.line === lineNumber
      && position.sha === sha
      && position.scope === scope
  })
  if (positionedMatch) return true

  // Older fixtures only have file/line. Keep those markers for the overall
  // diff while never treating them as a match for a commit snapshot.
  return allowLegacyFallback && discussions.some((discussion) => !discussion.position && discussion.file === filePath && discussion.line === lineNumber)
}

function lineBackground(kind: MockDiffLine['kind']) {
  if (kind === 'addition') return 'diff.addedBackground'
  if (kind === 'deletion') return 'diff.deletedBackground'
  return 'transparent'
}

function FileReviewFooter({ viewed, onToggleViewed }: { viewed: boolean; onToggleViewed: () => void }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', mx: 1, mt: 1.5, pt: 1 }}>
      <CheckCircleOutlineOutlinedIcon sx={{ color: viewed ? 'success.main' : 'text.disabled', fontSize: 14 }} />
      <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{viewed ? 'このファイルを確認済みにしました' : '確認したファイルを記録できます'}</Typography>
      <Box sx={{ flex: 1 }} />
      <Button aria-label={viewed ? 'ファイルの確認済みを解除' : 'ファイルを確認済みにする'} onClick={onToggleViewed} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }}>
        {viewed ? '解除' : '確認済み'}
      </Button>
    </Stack>
  )
}

function lineCommentPosition(file: MockChangedFile, line: MockDiffLine, sha: string, scope: MockCommentPosition['scope']): MockCommentPosition | undefined {
  const side = line.kind === 'deletion' ? 'old' : 'new'
  const lineNumber = side === 'old' ? line.oldLine : line.newLine
  if (lineNumber === undefined) return undefined
  return { path: file.path, side, line: lineNumber, sha, scope }
}

function AddLineCommentButton({ line, onAddComment, sideLabel }: { line: number; onAddComment: () => void; sideLabel: string }) {
  return (
    <IconButton
      aria-label={`${sideLabel}${line}行目にコメント`}
      className="line-comment-action"
      onClick={onAddComment}
      size="small"
      sx={{
        bgcolor: 'background.paper',
        color: 'primary.main',
        minWidth: 22,
        p: 0.2,
        position: 'absolute',
        right: 2,
        top: '50%',
        transform: 'translateY(-50%)',
        '&:hover': { bgcolor: 'action.selected' },
        '&:focus-visible': { opacity: 1 },
      }}
      title={`${sideLabel}${line}行目にコメント`}
    >
      <CommentOutlinedIcon sx={{ fontSize: 14 }} />
    </IconButton>
  )
}

function DiffLines({ file, discussions, onOpenDiscussion, showDiscussionMarkers, onAddComment, commentSha, commentScope }: { file: MockChangedFile; discussions: MockDiscussion[]; onOpenDiscussion: () => void; showDiscussionMarkers: boolean; onAddComment?: (position: MockCommentPosition) => void; commentSha: string; commentScope: MockCommentPosition['scope'] }) {
  return (
    <Box sx={{ minWidth: 'max-content' }}>
      {file.lines.map((line, index) => {
        const hasDiscussion = showDiscussionMarkers && lineHasDiscussion(line, file.path, discussions, commentSha, commentScope, commentScope === 'overall')
        const commentPosition = lineCommentPosition(file, line, commentSha, commentScope)
        const commentLine = commentPosition?.line
        return (
          <Box
            key={`${file.path}-${index}`}
            sx={{
              alignItems: 'stretch',
              bgcolor: lineBackground(line.kind),
              display: 'grid',
              gridTemplateColumns: '38px 38px minmax(0, 1fr) 24px',
              minHeight: 25,
              '&:hover': { bgcolor: line.kind === 'context' ? 'action.hover' : lineBackground(line.kind) },
              '&:hover .line-comment-action': { opacity: 1 },
            }}
          >
            <Box component="span" sx={{ minWidth: 0, position: 'relative', '& .line-comment-action': { opacity: 0 }, '&:focus-within .line-comment-action': { opacity: 1 } }}>
              <Typography color="text.disabled" sx={{ display: 'block', fontSize: 'caption.fontSize', p: '3px 7px', textAlign: 'right', userSelect: 'none' }} variant="code">
                {line.oldLine ?? ''}
              </Typography>
              {onAddComment && commentPosition?.side === 'old' && commentLine !== undefined ? (
                <AddLineCommentButton
                  line={commentLine}
                  onAddComment={() => onAddComment(commentPosition)}
                  sideLabel="旧"
                />
              ) : null}
            </Box>
            <Box component="span" sx={{ borderRight: 1, borderColor: 'divider', minWidth: 0, position: 'relative', '& .line-comment-action': { opacity: 0 }, '&:focus-within .line-comment-action': { opacity: 1 } }}>
              <Typography color="text.disabled" sx={{ display: 'block', fontSize: 'caption.fontSize', p: '3px 7px', textAlign: 'right', userSelect: 'none' }} variant="code">
                {line.newLine ?? ''}
              </Typography>
              {onAddComment && commentPosition?.side === 'new' && commentLine !== undefined ? (
                <AddLineCommentButton
                  line={commentLine}
                  onAddComment={() => onAddComment(commentPosition)}
                  sideLabel="新"
                />
              ) : null}
            </Box>
            <Box component="span" sx={{ minWidth: 0, position: 'relative' }}>
              <Typography component="code" variant="code" sx={{ color: line.kind === 'deletion' ? 'diff.deletedText' : line.kind === 'addition' ? 'diff.addedText' : 'text.primary', overflow: 'visible', px: 1, py: '3px', whiteSpace: 'pre' }}>
                {line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '}{line.code || ' '}
              </Typography>
            </Box>
            <Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'center' }}>
              {hasDiscussion ? (
                <Button
                  aria-label={`${line.newLine ?? line.oldLine}行目の議論を開く`}
                  onClick={onOpenDiscussion}
                  size="small"
                  sx={{ color: 'primary.main', minWidth: 22, p: 0.2 }}
                >
                  <AddCommentOutlinedIcon sx={{ fontSize: 14 }} />
                </Button>
              ) : null}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function FullFileContent({ file, onAddComment, commentSha, commentScope }: { file: MockChangedFile; onAddComment?: (position: MockCommentPosition) => void; commentSha: string; commentScope: MockCommentPosition['scope'] }) {
  if (file.fullContent === undefined) {
    return (
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start', p: 2 }}>
        <Typography component="h4" sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>ファイル全体の内容は未取得です</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>差分表示は利用できます。全体表示用の内容を取得すると、ここに変更後のファイルを表示します。</Typography>
      </Stack>
    )
  }

  if (file.fullContent.length === 0) {
    return (
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start', p: 2 }}>
        <Typography component="h4" sx={{ fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold' }}>このファイルは空です</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>変更後のファイルに表示する行はありません。</Typography>
      </Stack>
    )
  }

  const lines = file.fullContent.split(/\r?\n/)
  return (
    <Box sx={{ minWidth: 'max-content' }}>
      {lines.map((line, index) => (
        <Box key={`${file.path}-full-${index}`} sx={{ display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', minHeight: 25, '&:hover': { bgcolor: 'action.hover' }, '&:hover .line-comment-action': { opacity: 1 } }}>
          <Box component="span" sx={{ borderRight: 1, borderColor: 'divider', minWidth: 0, position: 'relative', '& .line-comment-action': { opacity: 0 }, '&:focus-within .line-comment-action': { opacity: 1 } }}>
            <Typography color="text.disabled" sx={{ display: 'block', fontSize: 'code.fontSize', p: '3px 10px', textAlign: 'right', userSelect: 'none' }} variant="code">
              {index + 1}
            </Typography>
            {onAddComment ? (
              <AddLineCommentButton
                line={index + 1}
                onAddComment={() => onAddComment({ path: file.path, side: 'new', line: index + 1, sha: commentSha, scope: commentScope })}
                sideLabel="新"
              />
            ) : null}
          </Box>
          <Box component="span" sx={{ minWidth: 0, position: 'relative' }}>
            <Typography component="code" variant="code" sx={{ color: 'text.primary', px: 1, py: '3px', whiteSpace: 'pre' }}>
              {line || ' '}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export function MockDiffView({ files, discussions, selectedPath, onSelectPath, onOpenDiscussion, displayMode, onDisplayModeChange, contentVersionLabel = 'MRの最新状態', showDiscussionMarkers = true, onAddComment, commentScope = 'overall' }: MockDiffViewProps) {
  const [viewedPaths, setViewedPaths] = useState<string[]>([])
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0]
  if (!selectedFile) return null
  const viewed = viewedPaths.includes(selectedFile.path)
  const fullContentSummary = selectedFile.fullContent === undefined
    ? '内容未取得'
    : selectedFile.fullContent.length === 0
      ? '空ファイル'
      : `${selectedFile.fullContent.split(/\r?\n/).length}行`

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', minHeight: 0, flex: 1, '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' } }}>
      <Box sx={{ borderRight: 1, borderColor: 'divider', minHeight: 0, overflowY: 'auto', '@media (max-width: 1100px)': { borderBottom: 1, borderRight: 0, borderColor: 'divider', maxHeight: 116, overflowX: 'auto', overflowY: 'hidden' } }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.25, py: 1 }}>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            変更ファイル
          </Typography>
          <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>{files.length}</Typography>
        </Stack>
        <Divider />
        <List disablePadding sx={{ p: 0.6 }}>
          {files.map((file) => (
            <ListItemButton
              key={file.path}
              aria-current={file.path === selectedFile.path ? 'true' : undefined}
              aria-label={`変更ファイル ${file.path}`}
              onClick={() => onSelectPath(file.path)}
              selected={file.path === selectedFile.path}
              sx={{ alignItems: 'start', px: 0.8, py: 0.8, '@media (max-width: 1100px)': { display: 'inline-flex', mr: 0.5, verticalAlign: 'top', width: 220 } }}
            >
              <InsertDriveFileOutlinedIcon sx={{ color: 'text.secondary', fontSize: 15, mr: 0.7, mt: 0.15 }} />
              <ListItemText
                primary={file.path.split('/').pop()}
                secondary={`${file.additions}追加 · ${file.deletions}削除`}
                slotProps={{
                  primary: { sx: { fontSize: 'caption.fontSize', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  secondary: { sx: { color: 'text.secondary', fontSize: 'caption.fontSize', mt: 0.2 } },
                }}
              />
              <KeyboardArrowRightOutlinedIcon sx={{ color: 'text.disabled', fontSize: 15, mt: 0.15 }} />
            </ListItemButton>
          ))}
        </List>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <Stack direction={{ sm: 'row', xs: 'column' }} spacing={0.75} sx={{ alignItems: { sm: 'center' }, borderBottom: 1, borderColor: 'divider', flexWrap: { sm: 'wrap' }, minHeight: 42, px: 1.5, py: 0.65 }}>
          <Typography component="h3" sx={{ flex: { sm: '1 1 220px' }, fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', minWidth: 0, overflowWrap: 'anywhere' }} variant="code">
            {selectedFile.path}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label={`+${selectedFile.additions}`} size="small" sx={{ bgcolor: 'diff.addedBackground', color: 'diff.addedText', fontSize: 'caption.fontSize', height: 20 }} />
            <Chip label={`−${selectedFile.deletions}`} size="small" sx={{ bgcolor: 'diff.deletedBackground', color: 'diff.deletedText', fontSize: 'caption.fontSize', height: 20 }} />
          </Stack>
          <Box sx={{ flex: '1 1 8px', minWidth: 8 }} />
          <IconButton aria-label="このファイルにコメント" onClick={() => onAddComment?.({ path: selectedFile.path, side: 'new', sha: contentVersionLabel, scope: commentScope })} size="small" sx={{ color: 'primary.main', p: 0.45 }} title="このファイルにコメント">
            <AddCommentOutlinedIcon sx={{ fontSize: 17 }} />
          </IconButton>
          <ToggleButtonGroup
            aria-label="ファイルの表示範囲"
            exclusive
            onChange={(_, nextMode: MockDiffDisplayMode | null) => { if (nextMode) onDisplayModeChange(nextMode) }}
            size="small"
            value={displayMode}
            sx={{ flexShrink: 0, '& .MuiToggleButton-root': { borderColor: 'divider', fontSize: 'caption.fontSize', minHeight: 26, px: 0.85, py: 0.2, textTransform: 'none' }, '& .Mui-selected': { bgcolor: 'action.selected', color: 'primary.main' } }}
          >
            <ToggleButton aria-label="差分" value="diff">差分</ToggleButton>
            <ToggleButton aria-label="ファイル全体" value="full">ファイル全体</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {displayMode === 'full' ? (
          <Stack direction={{ sm: 'row', xs: 'column' }} spacing={0.5} sx={{ alignItems: { sm: 'center' }, borderBottom: 1, borderColor: 'divider', flexShrink: 0, px: 1.5, py: 0.45 }}>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', whiteSpace: 'nowrap' }}>変更後 · {contentVersionLabel} · {fullContentSummary}</Typography>
            <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>{showDiscussionMarkers ? '行コメントは差分で表示' : '行コメントはMR全体の差分で表示'}</Typography>
          </Stack>
        ) : (
          <Typography color="text.disabled" sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, fontSize: 'caption.fontSize', px: 1.5, py: 0.4 }}>
            {showDiscussionMarkers ? '差分の抜粋（サンプル）' : 'コミット差分 · 行コメントはMR全体で表示'}
          </Typography>
        )}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', py: 0.75 }}>
          {displayMode === 'full' ? (
            <FullFileContent commentScope={commentScope} commentSha={contentVersionLabel} file={selectedFile} onAddComment={onAddComment} />
          ) : (
            <DiffLines commentScope={commentScope} commentSha={contentVersionLabel} discussions={discussions} file={selectedFile} onAddComment={onAddComment} onOpenDiscussion={onOpenDiscussion} showDiscussionMarkers={showDiscussionMarkers} />
          )}
          <FileReviewFooter onToggleViewed={() => setViewedPaths((current) => viewed ? current.filter((path) => path !== selectedFile.path) : [...current, selectedFile.path])} viewed={viewed} />
        </Box>
      </Box>
    </Box>
  )
}
