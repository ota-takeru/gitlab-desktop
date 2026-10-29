import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { MarkdownEditorHandle } from '../../components/MarkdownEditor'
import { useT } from '../../i18n/useT'
import { attachmentErrorMessage, MAX_GITLAB_ATTACHMENT_BYTES } from '../../lib/attachments'

/**
 * Uploads an image pasted into an editor and puts its Markdown at the caret, as
 * the comment composer does. A link whose upload finished after the editor
 * closed goes to `onDetached`, since the file is already on GitLab.
 */
export function useAttachmentPaste(editorRef: RefObject<MarkdownEditorHandle | null>, onUpload?: (file: File) => Promise<string | null>, onDetached?: (markdown: string) => void) {
  const t = useT()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uploadingRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const upload = async (file: File) => {
    if (!onUpload || uploadingRef.current) return
    if (file.size > MAX_GITLAB_ATTACHMENT_BYTES) { setError(t('review.attachment.tooLarge')); return }
    uploadingRef.current = true
    setUploading(true)
    setError(null)
    try {
      const snippet = (await onUpload(file))?.trim()
      if (!snippet) return
      if (mountedRef.current && editorRef.current) editorRef.current.insertBlock(snippet)
      else onDetached?.(snippet)
    } catch (caught) {
      if (mountedRef.current) setError(attachmentErrorMessage(caught))
    } finally {
      uploadingRef.current = false
      if (mountedRef.current) setUploading(false)
    }
  }
  const status = <>
    {uploading ? <Typography aria-live="polite" color="textSecondary" variant="caption">{t('review.composer.attach.uploading')}</Typography> : null}
    {error ? <Alert onClose={() => setError(null)} severity="error">{error}</Alert> : null}
  </>
  return { onPasteImage: onUpload ? (file: File) => { void upload(file) } : undefined, status, uploading }
}
