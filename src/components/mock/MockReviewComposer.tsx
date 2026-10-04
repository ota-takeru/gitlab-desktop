import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined'
import FormatBoldOutlinedIcon from '@mui/icons-material/FormatBoldOutlined'
import FormatListBulletedOutlinedIcon from '@mui/icons-material/FormatListBulletedOutlined'
import FormatQuoteOutlinedIcon from '@mui/icons-material/FormatQuoteOutlined'
import PreviewOutlinedIcon from '@mui/icons-material/PreviewOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { MockCommentOptions, MockCommentPosition } from '../../mock/reviewTypes'
import { MockMarkdown } from './MockMarkdown'

export interface MockReviewComposerProps {
  draft: string
  replyTarget?: string
  onCancelReply: () => void
  onChange: (value: string) => void
  onSaveDraft: () => void
  onSubmit: (options?: MockCommentOptions) => void
  onAddToReview?: (options?: MockCommentOptions) => void
  reviewCount?: number
  position?: MockCommentPosition
  onCancelPosition?: () => void
  replyResolved?: boolean
  canResolveReply?: boolean
}

type ComposerTab = 'edit' | 'preview'
type NewCommentKind = 'comment' | 'thread'

function positionLabel(position: MockCommentPosition) {
  const line = position.line === undefined
    ? 'ファイル全体'
    : position.endLine && position.endLine !== position.line ? `${position.line}–${position.endLine}` : position.line
  const side = position.side === 'new' ? '変更後' : '変更前'
  return `${position.path}:${line} · ${side} · ${position.sha.slice(0, 8)}`
}

function buildOptions({
  isThread,
  replyTarget,
  position,
  resolution,
}: {
  isThread: boolean
  replyTarget?: string
  position?: MockCommentPosition
  resolution?: 'open' | 'resolved'
}): MockCommentOptions {
  return {
    kind: replyTarget || position || isThread ? 'thread' : 'comment',
    ...(resolution ? { resolution } : {}),
  }
}

export function MockReviewComposer({
  draft,
  replyTarget,
  onCancelReply,
  onChange,
  onSaveDraft,
  onSubmit,
  onAddToReview,
  reviewCount = 0,
  position,
  onCancelPosition,
  replyResolved = false,
  canResolveReply = false,
}: MockReviewComposerProps) {
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<ComposerTab>('edit')
  const [newCommentKind, setNewCommentKind] = useState<NewCommentKind>('comment')
  const [resolveReply, setResolveReply] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  const isReply = Boolean(replyTarget)
  const isPositioned = Boolean(position)
  const isThread = isReply || isPositioned || newCommentKind === 'thread'
  const canQueue = Boolean(onAddToReview)
  const resolution = isReply && canResolveReply && resolveReply ? (replyResolved ? 'open' : 'resolved') : undefined

  useEffect(() => {
    if (!replyTarget && !position) return
    inputRef.current?.focus()
    inputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [position, replyTarget])

  const updateDraft = (value: string) => {
    setSaved(false)
    onChange(value)
  }

  const handleSave = () => {
    onSaveDraft()
    setSaved(true)
  }

  const submit = (queue: boolean) => {
    const options = buildOptions({ isThread, position, replyTarget, resolution })
    if (queue && onAddToReview) {
      onAddToReview(options)
      setActiveTab('edit')
      setResolveReply(false)
      setSaved(false)
      return
    }
    onSubmit(options)
    setActiveTab('edit')
    setResolveReply(false)
    setSaved(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!draft.trim() || !event.ctrlKey || event.key !== 'Enter') return
    event.preventDefault()
    if (event.shiftKey) {
      submit(false)
      return
    }
    if (onAddToReview) {
      submit(true)
      return
    }
    submit(false)
  }

  const insertMarkdown = (prefix: string, suffix = prefix, linePrefix = false) => {
    const element = inputRef.current
    const start = element?.selectionStart ?? draft.length
    const end = element?.selectionEnd ?? draft.length
    const selected = draft.slice(start, end)
    const replacement = linePrefix
      ? selected.split('\n').map((line) => `${prefix}${line}`).join('\n')
      : `${prefix}${selected || 'テキスト'}${suffix}`
    const nextDraft = `${draft.slice(0, start)}${replacement}${draft.slice(end)}`
    updateDraft(nextDraft)

    const nextStart = start + replacement.length
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextStart, nextStart)
    })
  }

  return (
    <Paper component="section" aria-label="レビューコメント入力" variant="outlined" sx={{ bgcolor: 'background.paper', p: 1.25 }}>
      <Stack spacing={0.85}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
            <AddCommentOutlinedIcon sx={{ color: 'primary.main', flexShrink: 0, fontSize: 17 }} />
            <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {replyTarget ? `${replyTarget} に返信` : position ? (position.line === undefined ? 'ファイルコメント' : '行コメント') : 'レビューコメント'}
            </Typography>
            <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 'caption.fontSize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              メモリ内の下書き · 実通信なし
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.4} sx={{ flexShrink: 0 }}>
            {position && onCancelPosition ? (
              <Button aria-label="行コメントの位置を解除" onClick={onCancelPosition} size="small" startIcon={<CloseOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }}>
                位置を解除
              </Button>
            ) : null}
            {replyTarget ? (
              <Button aria-label="返信先を解除" onClick={onCancelReply} size="small" startIcon={<CloseOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }}>
                返信をやめる
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {position ? (
          <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography color="text.secondary" component="code" variant="code" sx={{ bgcolor: 'action.hover', borderRadius: 0.5, fontSize: 'caption.fontSize', maxWidth: '100%', overflow: 'hidden', px: 0.65, py: 0.25, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {positionLabel(position)}
            </Typography>
            <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>選択中</Typography>
          </Stack>
        ) : null}

        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 0.35 }}>
          <Tabs
            aria-label="コメント編集モード"
            onChange={(_, value: ComposerTab) => setActiveTab(value)}
            sx={{ minHeight: 30, '& .MuiTab-root': { minHeight: 30, minWidth: 0, mr: 1.5, px: 0, fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' } }}
            value={activeTab}
          >
            <Tab icon={<CodeOutlinedIcon sx={{ fontSize: 15 }} />} iconPosition="start" label="編集" value="edit" />
            <Tab icon={<PreviewOutlinedIcon sx={{ fontSize: 15 }} />} iconPosition="start" label="プレビュー" value="preview" />
          </Tabs>
          {activeTab === 'edit' ? (
            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Button aria-label="太字を挿入" onClick={() => insertMarkdown('**')} size="small" sx={{ fontSize: 'caption.fontSize', minHeight: 25, minWidth: 0, px: 0.65 }} startIcon={<FormatBoldOutlinedIcon sx={{ fontSize: 15 }} />}>太字</Button>
              <Button aria-label="コードを挿入" onClick={() => insertMarkdown('`')} size="small" sx={{ fontSize: 'caption.fontSize', minHeight: 25, minWidth: 0, px: 0.65 }}>コード</Button>
              <Button aria-label="引用を挿入" onClick={() => insertMarkdown('> ', '', true)} size="small" sx={{ fontSize: 'caption.fontSize', minHeight: 25, minWidth: 0, px: 0.65 }} startIcon={<FormatQuoteOutlinedIcon sx={{ fontSize: 15 }} />}>引用</Button>
              <Button aria-label="箇条書きを挿入" onClick={() => insertMarkdown('- ', '', true)} size="small" sx={{ fontSize: 'caption.fontSize', minHeight: 25, minWidth: 0, px: 0.65 }} startIcon={<FormatListBulletedOutlinedIcon sx={{ fontSize: 15 }} />}>リスト</Button>
            </Stack>
          ) : null}
          {!isReply && !isPositioned ? (
            <ToggleButtonGroup
              aria-label="コメント種別"
              exclusive
              onChange={(_, value: NewCommentKind | null) => { if (value) setNewCommentKind(value) }}
              size="small"
              value={newCommentKind}
            >
              <ToggleButton aria-label="通常コメント" value="comment" sx={{ fontSize: 'caption.fontSize', minHeight: 28, px: 0.75, py: 0.25 }}>コメント</ToggleButton>
              <ToggleButton aria-label="解決可能なスレッド" value="thread" sx={{ fontSize: 'caption.fontSize', minHeight: 28, px: 0.75, py: 0.25 }}>スレッド</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </Stack>

        {activeTab === 'edit' ? (
          <TextField
              autoFocus={Boolean(replyTarget || position)}
              fullWidth
              inputRef={inputRef}
              label="レビューコメント"
              minRows={2}
              maxRows={5}
              multiline
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyTarget ? 'この議論への返信を書く…' : position ? 'この行についてコメントを書く…' : '変更についてコメントを書く…'}
              slotProps={{ htmlInput: { 'aria-label': 'レビューコメント' } }}
              value={draft}
              sx={{ '& .MuiInputBase-root': { fontSize: 'body2.fontSize', lineHeight: 1.6, p: 1 } }}
          />
        ) : (
          <Paper variant="outlined" sx={{ bgcolor: 'background.default', maxHeight: 120, minHeight: 76, overflow: 'auto', p: 1 }}>
            {draft.trim() ? <MockMarkdown body={draft} /> : <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize' }}>プレビューする内容がありません。</Typography>}
          </Paper>
        )}

        {replyTarget && canResolveReply ? (
          <FormControlLabel
            control={<Checkbox checked={resolveReply} onChange={(event) => setResolveReply(event.target.checked)} size="small" />}
            label={replyResolved ? '返信と同時に再開' : '返信と同時に解決'}
            sx={{ '& .MuiFormControlLabel-label': { fontSize: 'caption.fontSize' }, m: 0 }}
          />
        ) : null}

        <Divider />
        <Stack direction={{ sm: 'row', xs: 'column' }} spacing={0.75} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>
            {canQueue ? 'Ctrl + Enter でレビューに追加 · Ctrl + Shift + Enter で即時コメント' : 'Ctrl + Enter で投稿シミュレーション'}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button aria-label="下書きを保存" onClick={handleSave} size="small" startIcon={saved ? <CheckOutlinedIcon /> : undefined} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 1 }} variant="outlined">
              {saved ? '保存しました' : '下書き保存'}
            </Button>
            {canQueue ? (
              <Button aria-label={reviewCount ? 'レビューに追加' : 'レビューを開始'} disabled={!draft.trim()} onClick={() => submit(true)} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 1 }} variant="outlined">
                {reviewCount ? 'レビューに追加' : 'レビューを開始'}
              </Button>
            ) : null}
            <Button aria-label="コメントを投稿シミュレーション" disabled={!draft.trim()} onClick={() => submit(false)} size="small" startIcon={<SendOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 1 }} variant="contained">
              今すぐコメント
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}
