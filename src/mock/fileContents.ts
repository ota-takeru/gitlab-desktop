/**
 * Complete, fictional source snapshots used by the offline review mock.
 *
 * Diff rows remain intentionally small so the review surface stays readable;
 * these snapshots are what the full-file viewer uses when a reviewer wants
 * the surrounding context.
 */

export const reviewCacheFirstCommit = `import { invoke } from '@tauri-apps/api/core'
import type { MergeRequest } from '../types/gitlab'

const LIST_CACHE_TTL_MS = 60 * 1000
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000

export async function getMergeRequests(projectId: string) {
  const key = \`mr-list:\${projectId}\`
  return readThroughCache(key, () => invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId }))
}

export async function getMergeRequest(projectId: string, iid: number) {
  const key = \`mr-detail:\${projectId}:\${iid}\`
  return readThroughCache(key, () => invoke<MergeRequest>('gitlab_get_merge_request', { projectId, iid }))
}

async function readThroughCache<T>(key: string, fetcher: () => Promise<T>) {
  const cached = await invoke<T | null>('cache_get', { key })
  return cached ?? fetcher()
}`.trimEnd()

export const reviewCacheFinal = `import { invoke } from '@tauri-apps/api/core'
import type { MergeRequest } from '../types/gitlab'

const LIST_CACHE_TTL_MS = 60 * 1000
const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000

type CacheEntry<T> = { value: T; updatedAt: number }

export async function getMergeRequests(projectId: string) {
  const key = \`mr-list:\${projectId}\`
  const cached = await invoke<CacheEntry<MergeRequest[]> | null>('cache_get', { key })
  if (cached && Date.now() - cached.updatedAt < LIST_CACHE_TTL_MS) {
    return cached.value
  }
  const value = await invoke<MergeRequest[]>('gitlab_list_merge_requests', { projectId })
  await invoke('cache_set', { key, value, ttlMs: LIST_CACHE_TTL_MS })
  return value
}

export async function getMergeRequest(projectId: string, iid: number) {
  const key = \`mr-detail:\${projectId}:\${iid}\`
  const cached = await invoke<CacheEntry<MergeRequest> | null>('cache_get', { key })
  if (cached && Date.now() - cached.updatedAt < DETAIL_CACHE_TTL_MS) {
    return cached.value
  }
  const value = await invoke<MergeRequest>('gitlab_get_merge_request', { projectId, iid })
  await invoke('cache_set', { key, value, ttlMs: DETAIL_CACHE_TTL_MS })
  return value
}`.trimEnd()

export const queryRunnerFinal = `import type { SearchQuery } from './types'
import { api } from '../lib/api'
import { createRequestId } from './request-id'
import { normalizeResults } from './normalize'

const activeRequests = new Map<string, AbortController>()

function prepareQuery(query: SearchQuery) {
  return query
}

function removeRequest(requestId: string) {
  activeRequests.delete(requestId)
}

// Each search owns its controller so a new query cannot cancel another one.

export async function runSearch(query: SearchQuery) {
  const requestId = createRequestId()
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  const response = await api.search(prepareQuery(query), {
    signal: controller.signal,
  })
  removeRequest(requestId)
  return normalizeResults(response)
}

export function cancelSearch(requestId: string) {
  activeRequests.get(requestId)?.abort()
  removeRequest(requestId)
}`.trimEnd()

export const virtualDiff = `import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffRow } from '../types/diff'
import { DiffRowView } from './DiffRowView'
import { useDiffContainer } from './useDiffContainer'

interface VirtualDiffProps {
  rows: DiffRow[]
  onLineComment: (row: DiffRow) => void
}

export function VirtualDiff({ rows, onLineComment }: VirtualDiffProps) {
  const container = useDiffContainer()
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => container.current,
    estimateSize: () => 26,
    overscan: 12,
  })

  return (
    <div ref={container} className="diff-scroll" role="table">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <DiffRowView
            key={rows[item.index].id}
            row={rows[item.index]}
            top={item.start}
            onLineComment={onLineComment}
          />
        ))}
      </div>
    </div>
  )
}`.trimEnd()

export const credentials = `use anyhow::Result;
use keyring::Entry;
use secrecy::{ExposeSecret, SecretString};

const SERVICE_NAME: &str = "review-desk";

#[derive(Debug)]
pub struct CredentialStore {
    service: String,
    account_key: String,
}

impl CredentialStore {
    pub fn save(&self, token: SecretString) -> Result<()> {
        Entry::new(&self.service, &self.account_key)?
            .set_password(token.expose_secret())?;
        Ok(())
    }

    pub fn load(&self) -> Result<SecretString> {
        let token = Entry::new(&self.service, &self.account_key)?.get_password()?;
        Ok(SecretString::new(token))
    }

    pub fn delete(&self) -> Result<()> {
        let entry = Entry::new(&self.service, &self.account_key)?;
        let _ = entry.delete_credential();
        Ok(())
    }
}`.trimEnd()

export const httpRateLimit = `use reqwest::{Client, Request, Response};
use std::time::Duration;

use crate::error::Error;
use crate::rate_limit::Cooldowns;

pub async fn execute_with_cooldown(
    client: &Client,
    request: Request,
    connection: &str,
    cooldowns: &Cooldowns,
) -> Result<Response, Error> {
    cooldowns.wait(connection).await?;
    let request = add_timeout(request, Duration::from_secs(30))?;
    let response = client.execute(request).await?;
    if response.status().as_u16() == 429 {
        let retry_after = parse_retry_after(&response)?;
        cooldowns.pause(connection, retry_after);
        return Err(Error::RateLimited);
    }
    response.error_for_status().map_err(Error::from)
}`.trimEnd()

export const reviewShortcutHint = `import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined'

export function ReviewShortcutHint() {
  return (
    <span aria-label="レビューショートカット">
      <KeyboardOutlinedIcon fontSize="small" />
      j / k で議論を移動
    </span>
  )
}`.trimEnd()

export const reviewSearchMigration = `-- local cache index for review lookups
CREATE INDEX IF NOT EXISTS idx_notes_mr_updated
  ON notes (merge_request_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_path
  ON changed_files (merge_request_id, path);

CREATE INDEX IF NOT EXISTS idx_projects_updated
  ON projects (updated_at DESC);`.trimEnd()

export const readState = `import { useCallback, useEffect, useState } from 'react'
import type { Notification } from '../types/notifications'
import { notificationApi } from '../lib/notificationApi'

export function useReadState(notification: Notification) {
  const [isRead, setIsRead] = useState(notification.read)

  useEffect(() => {
    setIsRead(notification.read)
  }, [notification.id, notification.read])

  const markRead = useCallback(async () => {
    if (isRead) return
    setIsRead(true)
    await notificationApi.markRead(notification.id)
  }, [isRead, notification.id])

  return { isRead, markRead }
}`.trimEnd()
