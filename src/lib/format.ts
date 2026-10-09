import type { StatusTone } from '../components/StatusPill'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Short relative time for dense lists. Older values fall back to a calendar
 * date so the text stays meaningful when a list is left open for a long time.
 */
export function formatRelativeTime(value: string | number, now = Date.now()): string {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (Number.isNaN(timestamp)) return String(value)
  const elapsed = now - timestamp
  if (elapsed < 0) return formatCalendarDate(timestamp, now)
  if (elapsed < MINUTE) return 'たった今'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}分前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}時間前`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}日前`
  return formatCalendarDate(timestamp, now)
}

/** Full local date and time, used for tooltips and machine-readable labels. */
export function formatAbsoluteTime(value: string | number): string {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (Number.isNaN(timestamp)) return String(value)
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function formatCalendarDate(timestamp: number, now: number): string {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat('ja-JP', sameYear ? { month: 'numeric', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' }).format(timestamp)
}

export function formatMergeRequestState(state: string): string {
  if (state === 'opened' || state === 'open') return 'Open'
  if (state === 'merged') return 'Merged'
  if (state === 'closed') return 'Closed'
  if (state === 'locked') return 'Locked'
  return state || 'Unknown'
}

export function shortSha(value: string): string {
  return value.length > 10 ? value.slice(0, 8) : value
}

export function mergeRequestStateTone(state: string): StatusTone {
  if (state === 'opened' || state === 'open') return 'success'
  if (state === 'merged') return 'info'
  if (state === 'closed') return 'default'
  return 'warning'
}
