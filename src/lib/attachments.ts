import { invoke } from '@tauri-apps/api/core'

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
    throw new GitLabCommandError({ code: 'UNSUPPORTED', message: '添付ファイルのアップロードはデスクトップ版で利用できます。' })
  }
  if (file.size > MAX_GITLAB_ATTACHMENT_BYTES) {
    throw new GitLabCommandError({ code: 'TOO_LARGE', message: '添付ファイルは10 MiB以下にしてください。' })
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

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}
