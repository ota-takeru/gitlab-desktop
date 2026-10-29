import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useId, useMemo, useState } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { shortSha } from '../../lib/format'
import type { Note, Suggestion } from '../../types/gitlab'
import { contentLines, hasSuggestionBlock, splitSuggestions } from './suggestions'
import { useT } from '../../i18n/useT'

/** Applying the suggestions shown in comments. */
export interface SuggestionActions {
  currentUserId: string
  disabled: boolean
  /** The MR head the comments are shown on; GitLab must still have it when applying. */
  headSha?: string | null
  onApply: (suggestionIds: string[], commitMessage?: string) => Promise<boolean>
  /** Opens the MR on GitLab, where suggestions without an ID can be applied. */
  onOpenInGitLab?: () => void
}

/**
 * A comment body. Suggestion blocks show as proposed changes with the lines
 * they replace; the rest is the usual Markdown view.
 */
export function NoteBody({ actions, note, size = 'body1' }: { actions?: SuggestionActions; note: Pick<Note, 'body' | 'suggestions'> & { author?: Note['author'] }; size?: 'body1' | 'body2' }) {
  const segments = useMemo(() => hasSuggestionBlock(note.body) ? splitSuggestions(note.body) : null, [note.body])
  if (!segments) return <MockMarkdown body={note.body} size={size} />
  const blocks = segments.filter((segment) => segment.kind === 'suggestion').length
  // GitLab lists a comment's suggestions in the order of its blocks.
  const suggestions = note.suggestions?.length === blocks ? note.suggestions : undefined
  // A suggestion is for someone else to apply, so its author gets no apply button.
  const own = Boolean(note.author && actions?.currentUserId === note.author.id)
  const appliable = (suggestions ?? []).filter((suggestion) => suggestion.appliable && !suggestion.applied)
  return <Stack spacing={1}>
    {segments.map((segment, index) => {
      if (segment.kind === 'markdown') return <MockMarkdown body={segment.text} key={index} size={size} />
      const suggestion = suggestions?.[segments.slice(0, index).filter((item) => item.kind === 'suggestion').length]
      return <SuggestionBlock actions={own ? undefined : actions} above={segment.above} below={segment.below} key={index} lines={segment.lines} suggestion={suggestion} unidentified={!suggestions} />
    })}
    {actions && !own && appliable.length > 1 ? <Box><ApplyButton actions={actions} count={appliable.length} suggestionIds={appliable.map((suggestion) => suggestion.id)} /></Box> : null}
  </Stack>
}

/**
 * One suggested change: the lines it replaces (when GitLab sent them) and the
 * proposed lines, coloured like the diff.
 */
export function SuggestionBlock({ actions, above, below, lines, suggestion, unidentified }: { actions?: SuggestionActions; above: number; below: number; lines: string[]; suggestion?: Suggestion; unidentified: boolean }) {
  const t = useT()
  const removed = suggestion ? contentLines(suggestion.fromContent) : null
  const scope = above || below ? t('review.suggestion.scopeRange', { above, below }) : t('review.suggestion.scope')
  return <Box aria-label={t('review.suggestion.title')} component="figure" sx={{ ...panelFrame(), borderRadius: 1, m: 0, overflow: 'hidden' }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', bgcolor: 'surface.list', ...hairline('bottom'), flexWrap: 'wrap', minHeight: 32, px: 1, py: 0.25, rowGap: 0.5 }}>
      <Typography component="figcaption" sx={{ fontWeight: 600 }} variant="caption">{t('review.suggestion.title')}</Typography>
      <Typography color="textSecondary" sx={{ flex: 1 }} variant="caption">{scope}</Typography>
      {suggestion?.applied ? <Typography color="success" variant="caption">{t('review.suggestion.applied')}</Typography>
        : suggestion && !suggestion.appliable ? <Typography color="textSecondary" variant="caption">{t('review.suggestion.notAppliable')}</Typography>
          : suggestion && actions ? <ApplyButton actions={actions} count={1} suggestionIds={[suggestion.id]} />
            : unidentified && actions?.onOpenInGitLab ? <Button onClick={actions.onOpenInGitLab} size="small">{t('review.suggestion.applyInGitLab')}</Button> : null}
    </Stack>
    <Box sx={(theme) => ({
      fontFamily: theme.typography.code?.fontFamily ?? 'monospace',
      fontSize: theme.typography.code?.fontSize ?? '0.8125rem',
      lineHeight: '20px',
      py: 0.5,
      '& .suggestion-line': { display: 'flex', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      '& .suggestion-line[data-kind="remove"]': { backgroundColor: theme.palette.diff?.deletedBackground, color: theme.palette.diff?.deletedText },
      '& .suggestion-line[data-kind="add"]': { backgroundColor: theme.palette.diff?.addedBackground, color: theme.palette.diff?.addedText },
      '& .suggestion-prefix': { flexShrink: 0, textAlign: 'center', userSelect: 'none', width: 24 },
    })}>
      {removed?.map((line, index) => <div className="suggestion-line" data-kind="remove" key={`r${index}`}><span aria-hidden className="suggestion-prefix">−</span><span>{line}</span></div>)}
      {lines.map((line, index) => <div className="suggestion-line" data-kind="add" key={`a${index}`}><span aria-hidden className="suggestion-prefix">+</span><span>{line}</span></div>)}
      {lines.length === 0 ? <Typography color="textSecondary" sx={{ px: 1 }} variant="caption">{t('review.suggestion.removesLines')}</Typography> : null}
    </Box>
    {removed ? null : <Typography color="textSecondary" component="p" sx={{ ...hairline('top'), m: 0, px: 1, py: 0.25 }} variant="caption">{t('review.suggestion.originalHint')}</Typography>}
  </Box>
}

function ApplyButton({ actions, count, suggestionIds }: { actions: SuggestionActions; count: number; suggestionIds: string[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const label = count > 1 ? t('review.suggestion.applyBatch', { count }) : t('review.suggestion.apply')
  return <>
    <Button disabled={actions.disabled || !actions.headSha} onClick={() => setOpen(true)} size="small" variant="outlined">{label}</Button>
    {open ? <ApplySuggestionDialog count={count} headSha={actions.headSha ?? ''} onApply={(message) => actions.onApply(suggestionIds, message)} onClose={() => setOpen(false)} /> : null}
  </>
}

/** Confirms applying, which commits to the MR's source branch, with an optional commit message. */
export function ApplySuggestionDialog({ count, headSha, onApply, onClose }: { count: number; headSha: string; onApply: (commitMessage?: string) => Promise<boolean>; onClose: () => void }) {
  const t = useT()
  const [message, setMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const titleId = useId()
  const apply = async () => {
    if (applying) return
    setApplying(true)
    try {
      if (await onApply(message.trim() || undefined)) onClose()
    } finally {
      setApplying(false)
    }
  }
  return <Dialog aria-labelledby={titleId} fullWidth maxWidth="sm" onClose={() => { if (!applying) onClose() }} open>
    <DialogTitle id={titleId}>{count > 1 ? t('review.suggestion.dialog.titleBatch', { count }) : t('review.suggestion.dialog.title')}</DialogTitle>
    <DialogContent>
      <Stack spacing={2}>
        <DialogContentText variant="body2">{t(count > 1 ? 'review.suggestion.dialog.descriptionBatch' : 'review.suggestion.dialog.description', { sha: shortSha(headSha) })}</DialogContentText>
        <TextField disabled={applying} label={t('review.suggestion.dialog.message')} minRows={2} multiline onChange={(event) => setMessage(event.target.value)} placeholder={t('review.suggestion.dialog.messagePlaceholder')} size="small" value={message} />
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button autoFocus disabled={applying} onClick={onClose}>{t('review.suggestion.dialog.cancel')}</Button>
      <Button disabled={applying} onClick={() => void apply()} variant="contained">{applying ? t('review.suggestion.dialog.applying') : count > 1 ? t('review.suggestion.dialog.applyBatch', { count }) : t('review.suggestion.dialog.apply')}</Button>
    </DialogActions>
  </Dialog>
}
