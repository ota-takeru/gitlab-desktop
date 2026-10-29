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
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import type { Draft, GitLabUser, Position } from '../../types/gitlab'
import { plainExcerpt } from './discussionText'
import { seedComposerBuffer, useComposerBuffer } from './useComposerBuffer'
import { useMentionSuggestions } from './useMentionSuggestions'
import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

export function DraftList({ disabled, drafts, draftEditBufferKey, draftEditId, mentionParticipants, nextPage, onDelete, onEdit, onNextPage, onOpenPosition, onPrevPage, onPublish, onPublishAll, onPublishSelected, onSelect, onSetEdit, page, publishingAll, selected, sessionId, statuses }: { disabled: boolean; drafts: Draft[]; draftEditBufferKey: (draft: Draft) => string; draftEditId: string | null; mentionParticipants?: GitLabUser[]; nextPage: number | null; onDelete: (draft: Draft) => Promise<boolean>; onEdit: (draft: Draft, body: string) => Promise<boolean>; onNextPage: () => void; onOpenPosition: (position: Position) => void; onPrevPage: () => void; onPublish: (draft: Draft) => Promise<boolean>; onPublishAll: () => Promise<void>; onPublishSelected: () => Promise<void>; onSelect: (id: string) => void; onSetEdit: (draftId: string | null) => void; page: number; publishingAll: boolean; selected: string[]; sessionId: string | null; statuses: Record<string, DraftStatus> }) {
  const t = useT()
  const confirm = useConfirm()
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const returnFocusRef = useRef<string | null>(null)
  // A saved edit shows at once; GitLab's copy takes over when a refetch brings a changed body.
  const [savedEdits, setSavedEdits] = useState<Record<string, { base: string; body: string }>>({})
  useEffect(() => {
    // The edit button is enabled again only once the editor has closed; focus returns to it then, unless it went elsewhere.
    const id = returnFocusRef.current
    if (!id || draftEditId === id) return
    returnFocusRef.current = null
    if (!document.activeElement || document.activeElement === document.body) editButtons.current.get(id)?.focus({ preventScroll: true })
  }, [draftEditId])
  if (!drafts.length && page === 1) return null
  const selectedDrafts = drafts.filter((draft) => selected.includes(draft.id))
  const paged = nextPage !== null || page > 1
  return (
    <Paper component="section" aria-labelledby="draft-list-title" sx={{ bgcolor: 'surface.raised', p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        <Row spacing={1}><PublishRoundedIcon color="primary" fontSize="small" /><Typography color="textSecondary" component="h2" id="draft-list-title" variant="overline">{t('review.drafts.title')}</Typography><Chip label={paged ? t('review.drafts.countOnPage', { count: drafts.length }) : t('review.drafts.count', { count: drafts.length })} size="small" variant="outlined" /><Tooltip title={t('review.drafts.publishAllHint')}><Box component="span" sx={{ ml: 'auto' }}><Button disabled={disabled || publishingAll} onClick={() => void onPublishAll()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">{publishingAll ? t('review.drafts.publishing') : t('review.drafts.publishAll')}</Button></Box></Tooltip></Row>
        <List disablePadding>
          {drafts.map((fetched) => {
            const savedEdit = savedEdits[fetched.id]
            const draft = savedEdit?.base === fetched.body ? { ...fetched, body: savedEdit.body } : fetched
            const status = statuses[draft.id] ?? 'idle'
            const excerpt = plainExcerpt(draft.body, 80)
            const name = t('review.drafts.name', { excerpt: plainExcerpt(draft.body, 20) })
            const editing = draftEditId === draft.id
            const place = draft.position ? `${draft.position.newPath}:${draft.position.newLine ?? draft.position.oldLine ?? 'file'}` : null
            const position = draft.position
            const secondary = status === 'unknown' ? t('review.drafts.status.unknown') : status === 'success' ? t('review.drafts.status.success') : status === 'error' ? t('review.drafts.status.error')
              : position && place ? <Tooltip title={place}><Button aria-label={t('review.drafts.goToDiff', { place })} disabled={disabled} onClick={() => onOpenPosition(position)} size="small" sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', fontWeight: 400, justifyContent: 'flex-start', maxWidth: '100%', minHeight: 24, minWidth: 0, px: 0.5 }}><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('review.drafts.lineComment', { place })}</Box></Button></Tooltip>
                : draft.discussionId ? t('review.drafts.reply') : t('review.drafts.newComment')
            return <ListItem key={draft.id} disableGutters sx={{ alignItems: 'stretch', flexDirection: 'column' }}>
              <Row sx={{ minWidth: 0 }}>
                <Checkbox checked={selected.includes(draft.id)} disabled={disabled} slotProps={{ input: { 'aria-label': t('review.drafts.select', { name }) } }} onChange={() => onSelect(draft.id)} size="small" />
                <ListItemText primary={<Tooltip title={draft.body}><Typography noWrap variant="body2">{excerpt || t('review.drafts.noBody')}</Typography></Tooltip>} secondary={secondary} slotProps={{ secondary: { component: 'div', noWrap: true } }} sx={{ minWidth: 0, my: 0 }} />
                <Row spacing={0.25} sx={{ flexShrink: 0 }}>
                  <Tooltip title={t('review.drafts.editTooltip')}><span><IconButton aria-label={t('review.drafts.edit', { name })} disabled={disabled || editing || status === 'pending' || status === 'unknown' || status === 'success'} onClick={() => onSetEdit(draft.id)} ref={(element) => { if (element) editButtons.current.set(draft.id, element); else editButtons.current.delete(draft.id) }} size="small"><EditOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title={t('review.drafts.publishTooltip')}><span><IconButton aria-label={t('review.drafts.publish', { name })} disabled={disabled || status === 'pending' || status === 'unknown'} onClick={() => void onPublish(draft)} size="small"><PublishRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title={t('review.drafts.deleteTooltip')}><span><IconButton aria-label={t('review.drafts.delete', { name })} disabled={disabled || status === 'pending'} onClick={() => void confirm({ cancelLabel: t('review.drafts.delete.cancel'), confirmLabel: t('review.drafts.delete.confirm'), destructive: true, message: excerpt, title: t('review.drafts.delete.title') }).then((ok) => { if (ok) void onDelete(draft) })} size="small"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                </Row>
              </Row>
              {editing ? <DraftEditor bufferKey={draftEditBufferKey(draft)} disabled={disabled} draft={draft} mentionParticipants={mentionParticipants} onClose={(editorHadFocus) => { if (editorHadFocus) returnFocusRef.current = draft.id; onSetEdit(null) }} onSave={async (body) => {
                const saved = await onEdit(draft, body)
                if (saved) setSavedEdits((current) => ({ ...current, [draft.id]: { base: fetched.body, body } }))
                return saved
              }} sessionId={sessionId} /> : null}
            </ListItem>
          })}
        </List>
        {selectedDrafts.length > 0 ? <Row spacing={1}><Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{t('review.drafts.selected', { count: selectedDrafts.length })}</Typography><Button disabled={disabled} onClick={() => void onPublishSelected()} size="small" startIcon={<PublishRoundedIcon />} variant="outlined">{t('review.drafts.publishSelected')}</Button></Row> : null}
        {paged ? <Row spacing={0.5} sx={{ justifyContent: 'flex-end' }}><Button aria-label={t('review.drafts.page.previous')} disabled={page <= 1} onClick={onPrevPage} size="small">{t('review.diff.page.previous')}</Button><Typography color="textSecondary" variant="caption">{t('review.drafts.page.current', { page })}</Typography><Button aria-label={t('review.drafts.page.next')} disabled={nextPage === null} onClick={onNextPage} size="small">{t('review.diff.page.next')}</Button></Row> : null}
      </Stack>
    </Paper>
  )
}

/**
 * Edits a pending-review comment in place. Its text is kept in the composer
 * buffer, so closing (Esc) or leaving the tab keeps it; 取消 of a changed text asks first.
 */
function DraftEditor({ bufferKey, disabled, draft, mentionParticipants, onClose, onSave, sessionId }: { bufferKey: string; disabled: boolean; draft: Draft; mentionParticipants?: GitLabUser[]; onClose: (editorHadFocus: boolean) => void; onSave: (body: string) => Promise<boolean>; sessionId: string | null }) {
  const t = useT()
  const { body, change, persistenceStatus } = useComposerBuffer(bufferKey, sessionId)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const closeEditor = () => {
    const active = document.activeElement
    onClose(!active || active === document.body || Boolean(containerRef.current?.contains(active)))
  }
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const seededRef = useRef(false)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const { containerRef: mentionContainerRef, editorProps: mentionEditorProps, handleKeyDown: handleMentionKeyDown, popup: mentionPopup } = useMentionSuggestions({ disabled: disabled || saving, editorRef, enabled: Boolean(sessionId), participants: mentionParticipants })
  useEffect(() => {
    // Start from the draft, or from the text kept when the edit was last closed.
    if (seededRef.current || persistenceStatus === 'hydrating') return
    seededRef.current = seedComposerBuffer(bufferKey, draft.body)
  }, [bufferKey, draft.body, persistenceStatus])
  const changed = body !== draft.body
  const close = () => {
    // An unchanged copy of the draft is not worth keeping.
    if (!changed) change('')
    closeEditor()
  }
  const cancel = async () => {
    if (changed && !await confirm({ cancelLabel: t('review.editor.discard.cancel'), confirmLabel: t('review.editor.discard.confirm'), destructive: true, title: t('review.drafts.discard.title') })) return
    change('')
    closeEditor()
  }
  const save = async () => {
    const trimmed = body.trim()
    if (disabled || saving || !changed || !trimmed) return
    setSaving(true)
    try {
      if (await onSave(trimmed)) {
        change('')
        closeEditor()
      }
    } finally {
      setSaving(false)
    }
  }
  const handleKeyDown = (event: MarkdownEditorKeyEvent) => {
    if (handleMentionKeyDown(event)) return true
    if (event.key === 'Escape') { event.preventDefault(); close(); return true }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return true }
    return false
  }
  return <Stack data-composer="" ref={(element: HTMLDivElement | null) => { containerRef.current = element; mentionContainerRef(element) }} spacing={1} sx={{ pb: 1, pt: 0.5 }}>
    <MarkdownEditor {...mentionEditorProps} autoFocus disabled={disabled || saving} label={t('review.drafts.editTooltip')} onChange={change} onKeyDown={handleKeyDown} ref={editorRef} value={body} />
    {mentionPopup}
    <Row spacing={1} sx={{ justifyContent: 'flex-end' }}>
      <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{t('review.editor.hint')}</Typography>
      <Button disabled={saving} onClick={() => void cancel()} size="small">{t('review.editor.cancel')}</Button>
      <Button disabled={disabled || saving || !changed || !body.trim()} onClick={() => void save()} size="small" variant="contained">{saving ? t('review.editor.saving') : t('review.editor.save')}</Button>
    </Row>
  </Stack>
}

export type DraftStatus = 'idle' | 'pending' | 'success' | 'error' | 'unknown'
