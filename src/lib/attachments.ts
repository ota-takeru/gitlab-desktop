import { invoke } from '@tauri-apps/api/core'

import { translate } from '../i18n/i18n'
import { createRequestId, isTauri, normalizeGitLabError } from './gitlab'
import { GitLabCommandError } from '../types/gitlab'

export const MAX_GITLAB_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface UploadGitLabAttachmentInput {
  file: File
  iid: string
  projectId: string
  sessionId: string
}

/** Uploads one selected file and returns GitLab's Markdown reference. */
export async function uploadGitLabAttachment({ file, iid, projectId, sessionId }: UploadGitLabAttachmentInput): Promise<string> {
  if (!isTauri()) {
    throw new GitLabCommandError({ code: 'UNSUPPORTED', message: translate('common.attachments.desktopOnly') })
  }
  if (file.size > MAX_GITLAB_ATTACHMENT_BYTES) {
    throw new GitLabCommandError({ code: 'TOO_LARGE', message: translate('common.attachments.tooLarge') })
  }

  try {
    const dataBase64 = await fileToBase64(file)
    return await invoke<string>('upload_gitlab_attachment', {
      input: { dataBase64, fileName: file.name, iid, projectId, requestId: createRequestId('attachment'), sessionId },
    })
  } catch (caught) {
    throw normalizeGitLabError(caught)
  }
}

/** The message for a failed upload, by its error code. */
export function attachmentErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (code === 'TOO_LARGE') return translate('review.attachment.tooLarge')
  if (code === 'FORBIDDEN') return translate('review.attachment.forbidden')
  if (code === 'AUTH_REQUIRED') return translate('review.attachment.authRequired')
  if (code === 'STORAGE') return translate('review.attachment.storage')
  if (code === 'UNKNOWN_OUTCOME') return translate('review.attachment.unknownOutcome')
  return translate('review.attachment.failed')
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}
