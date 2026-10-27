import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PublishRoundedIcon from '@mui/icons-material/PublishRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../../components/feedbackContext'
import { MarkdownEditor, type MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import type { Draft, Position } from '../../types/gitlab'
import { plainExcerpt } from './discussionText'
import { seedComposerBuffer, useComposerBuffer } from './useComposerBuffer'

export function DraftList({ disabled, drafts, draftEditBufferKey, draftEditId, nextPage, onDelete, onEdit, onNextPage, onOpenPosition, onPrevPage, onPublish, onPublishAll, onPublishSelected, onSelect, onSetEdit, page, publishingAll, selected, sessionId, statuses }: { disabled: boolean; drafts: Draft[]; draftEditBufferKey: (draft: Draft) => string; draftEditId: string | null; nextPage: number | null; onDelete: (draft: Draft) => Promise<boolean>; onEdit: (draft: Draft, body: string) => Promise<boolean>; onNextPage: () => void; onOpenPosition: (position: Position) => void; onPrevPage: () => void; onPublish: (draft: Draft) => Promise<boolean>; onPublishAll: () => Promise<void>; onPublishSelected: () => Promise<void>; onSelect: (id: string) => void; onSetEdit: (draftId: string | null) => void; page: number; publishingAll: boolean; selected: string[]; sessionId: string | null; statuses: Record<string, DraftStatus> }) {
  const confirm = useConfirm()
  if (!drafts.length && page === 1) return null
  const selectedDrafts = drafts.filter((draft) => selected.includes(draft.id))
  const paged = nextPage !== null || page > 1
  return (
    <Paper component="section" aria-labelledby="draft-list-title" sx={{ bgcolor: 'surface.raised', p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><PublishRoundedIcon color="primary" fontSize="small" /><Typography color="textSecondary" component="h2" id="draft-list-title" variant="overline">未公開レビュー</Typography><Chip label={paged ? `このページ ${drafts.length}件` : `${drafts.length}件`} size="small" variant="outlined" /><Tooltip title="全ページの下書きを読み直し、一件ずつ公開します。途中で失敗したら残りは公開しません。"><Box component="span" sx={{ ml: 'auto' }}><Button disabled={disabled || publishingAll} onClick={() => void onPublishAll()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">{publishingAll ? '公開中…' : 'すべて公開'}</Button></Box></Tooltip></Stack>
        <List disablePadding>
          {drafts.map((draft) => {
            const status = statuses[draft.id] ?? 'idle'
            const excerpt = plainExcerpt(draft.body, 80)
            const name = `下書き「${plainExcerpt(draft.body, 20)}」`
            const editing = draftEditId === draft.id
            const place = draft.position ? `${draft.position.newPath}:${draft.position.newLine ?? draft.position.oldLine ?? 'file'}` : null
            const position = draft.position
            const secondary = status === 'unknown' ? '結果不明 · 更新して確認してください' : status === 'success' ? '公開済み' : status === 'error' ? '公開に失敗しました'
              : position && place ? <Tooltip title={place}><Button aria-label={`差分へ移動: ${place}`} disabled={disabled} onClick={() => onOpenPosition(position)} size="small" sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', fontWeight: 400, justifyContent: 'flex-start', maxWidth: '100%', minHeight: 24, minWidth: 0, px: 0.5 }}><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place} への行コメント</Box></Button></Tooltip>
                : draft.discussionId ? '既存スレッドへの返信' : '新規コメント'
            return <ListItem key={draft.id} disableGutters sx={{ alignItems: 'stretch', flexDirection: 'column' }}>
              <Stack direction="row" sx={{ alignItems: 'center', minWidth: 0 }}>
                <Checkbox checked={selected.includes(draft.id)} disabled={disabled} slotProps={{ input: { 'aria-label': `${name}を選択` } }} onChange={() => onSelect(draft.id)} size="small" />
                <ListItemText primary={<Tooltip title={draft.body}><Typography noWrap variant="body2">{excerpt || '（本文なし）'}</Typography></Tooltip>} secondary={secondary} slotProps={{ secondary: { component: 'div', noWrap: true } }} sx={{ minWidth: 0, my: 0 }} />
                <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                  <Tooltip title="下書きを編集"><span><IconButton aria-label={`${name}を編集`} disabled={disabled || editing || status === 'pending' || status === 'unknown' || status === 'success'} onClick={() => onSetEdit(draft.id)} size="small"><EditOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="下書きを公開"><span><IconButton aria-label={`${name}を公開`} disabled={disabled || status === 'pending' || status === 'unknown'} onClick={() => void onPublish(draft)} size="small"><PublishRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="下書きを削除"><span><IconButton aria-label={`${name}を削除`} disabled={disabled || status === 'pending'} onClick={() => void confirm({ cancelLabel: '残す', confirmLabel: '削除する', destructive: true, message: excerpt, title: 'この下書きを削除しますか？' }).then((ok) => { if (ok) void onDelete(draft) })} size="small"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                </Stack>
              </Stack>
              {editing ? <DraftEditor bufferKey={draftEditBufferKey(draft)} disabled={disabled} draft={draft} onClose={() => onSetEdit(null)} onSave={(body) => onEdit(draft, body)} sessionId={sessionId} /> : null}
            </ListItem>
          })}
        </List>
        {selectedDrafts.length > 0 ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">選択中 {selectedDrafts.length}件 · 公開は一件ずつ実行されます</Typography><Button disabled={disabled} onClick={() => void onPublishSelected()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">選択を公開</Button></Stack> : null}
        {paged ? <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}><Button aria-label="下書きの前のページ" disabled={page <= 1} onClick={onPrevPage} size="small">前へ</Button><Typography color="textSecondary" variant="caption">ページ {page}</Typography><Button aria-label="下書きの次のページ" disabled={nextPage === null} onClick={onNextPage} size="small">次へ</Button></Stack> : null}
      </Stack>
    </Paper>
  )
}

/**
 * Edits a pending-review comment in place. Its text is kept in the composer
 * buffer, so closing (Esc) or leaving the tab keeps it; 取消 of a changed text asks first.
 */
function DraftEditor({ bufferKey, disabled, draft, onClose, onSave, sessionId }: { bufferKey: string; disabled: boolean; draft: Draft; onClose: () => void; onSave: (body: string) => Promise<boolean>; sessionId: string | null }) {
  const { body, change, persistenceStatus } = useComposerBuffer(bufferKey, sessionId)
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const seededRef = useRef(false)
  useEffect(() => {
    // Start from the draft, or from the text kept when the edit was last closed.
    if (seededRef.current || persistenceStatus === 'hydrating') return
    seededRef.current = true
    seedComposerBuffer(bufferKey, draft.body)
  }, [bufferKey, draft.body, persistenceStatus])
  const changed = body !== draft.body
  const close = () => {
    // An unchanged copy of the draft is not worth keeping.
    if (!changed) change('')
    onClose()
  }
  const cancel = async () => {
    if (changed && !await confirm({ cancelLabel: '編集を続ける', confirmLabel: '破棄する', destructive: true, title: '下書きの編集を破棄しますか？' })) return
    change('')
    onClose()
  }
  const save = async () => {
    const trimmed = body.trim()
    if (disabled || saving || !changed || !trimmed) return
    setSaving(true)
    try {
      if (await onSave(trimmed)) {
        change('')
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }
  const handleKeyDown = (event: MarkdownEditorKeyEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return true }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return true }
    return false
  }
  return <Stack data-composer="" spacing={1} sx={{ pb: 1, pt: 0.5 }}>
    <MarkdownEditor autoFocus disabled={disabled || saving} label="下書きを編集" onChange={change} onKeyDown={handleKeyDown} value={body} />
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
      <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">Ctrl+Enter: 保存 · Esc: 閉じる（入力は保持）</Typography>
      <Button disabled={saving} onClick={() => void cancel()} size="small">取消</Button>
      <Button disabled={disabled || saving || !changed || !body.trim()} onClick={() => void save()} size="small" variant="contained">{saving ? '保存中…' : '保存'}</Button>
    </Stack>
  </Stack>
}

export type DraftStatus = 'idle' | 'pending' | 'success' | 'error' | 'unknown'
