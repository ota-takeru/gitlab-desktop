import type { StatusTone } from '../components/StatusPill'
import { currentLocale, translate } from '../i18n/i18n'

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
  if (elapsed < MINUTE) return translate('time.justNow')
  if (elapsed < HOUR) return translate('time.minutesAgo', { count: Math.floor(elapsed / MINUTE) })
  // Past an hour, days count local calendar days, so last night reads 「昨日」 rather than hours ago.
  const days = calendarDaysBetween(timestamp, now)
  if (days === 0) return translate('time.hoursAgo', { count: Math.floor(elapsed / HOUR) })
  if (days === 1) return translate('time.yesterday')
  if (days < 7) return translate('time.daysAgo', { count: days })
  return formatCalendarDate(timestamp, now)
}

function calendarDaysBetween(from: number, to: number): number {
  const start = new Date(from)
  const end = new Date(to)
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / DAY)
}

/** Full local date and time, used for tooltips and machine-readable labels. */
export function formatAbsoluteTime(value: string | number): string {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (Number.isNaN(timestamp)) return String(value)
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

/** Time a saved list was fetched, for the 「保存済み · 時刻」 status shown while it is stale. */
export function formatFetchedAt(timestamp?: number): string {
  if (!timestamp) return translate('time.unknown')
  return new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function formatCalendarDate(timestamp: number, now: number): string {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(currentLocale(), sameYear ? { month: 'numeric', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' }).format(timestamp)
}

export function formatMergeRequestState(state: string): string {
  if (state === 'opened' || state === 'open') return translate('common.mergeRequestState.open')
  if (state === 'merged') return translate('common.mergeRequestState.merged')
  if (state === 'closed') return translate('common.mergeRequestState.closed')
  if (state === 'locked') return translate('common.mergeRequestState.locked')
  return state || translate('common.mergeRequestState.unknown')
}

export function shortSha(value: string): string {
  return value.length > 10 ? value.slice(0, 8) : value
}

export function mergeRequestStateTone(state: string): StatusTone {
  if (state === 'opened' || state === 'open') return 'success'
  // Merged is purple as in GitLab, apart from the blue used for actions.
  if (state === 'merged') return 'secondary'
  if (state === 'closed') return 'default'
  return 'warning'
}
