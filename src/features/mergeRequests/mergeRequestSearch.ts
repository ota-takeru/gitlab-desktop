import { translate } from '../../i18n/i18n'
import type { MergeRequestState, MergeRequestsQuery } from '../../types/gitlab'
import type { SavedMergeRequestSearch } from '../shared/preferences'
import { STATE_NAMES } from './conditionNames'

/** The MR list's search conditions: reading them from a location, checking them, and turning them into a query. */

export type OrderBy = NonNullable<MergeRequestsQuery['orderBy']>
export type SortDirection = NonNullable<MergeRequestsQuery['sort']>

export interface SearchDraft {
  assignee: string
  search: string
  state: MergeRequestState
  authorId: string
  reviewer: string
  updatedAfter: string
  updatedBefore: string
  projectId: string
  groupId: string
  labels: string
  sourceBranch: string
  targetBranch: string
  orderBy: OrderBy
  sort: SortDirection
}

export interface AppliedSearch extends SearchDraft {
  page: number
}

export function buildQuery(filters: AppliedSearch, currentUserId?: string): MergeRequestsQuery {
  if (filters.assignee === 'self' && !isPositiveDecimalId(currentUserId ?? '')) throw new Error(translate('mrList.errors.assigneeSelfUnknown'))
  const projectId = cleanOptional(filters.projectId)
  const groupId = cleanOptional(filters.groupId)
  if (projectId && groupId) throw new Error(translate('mrList.errors.projectAndGroup'))
  if (groupId && !isValidGroupId(groupId)) throw new Error(translate('mrList.errors.groupId'))
  const query: MergeRequestsQuery = {
    kind: 'mrs',
    orderBy: filters.orderBy,
    page: filters.page,
    search: filters.search.trim(),
    sort: filters.sort,
    state: filters.state,
  }
  const labels = parseLabels(filters.labels)
  const sourceBranch = cleanOptional(filters.sourceBranch)
  const targetBranch = cleanOptional(filters.targetBranch)
  const authorId = cleanOptional(filters.authorId)
  const reviewerId = filters.reviewer === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.reviewer)
  const assigneeId = filters.assignee === 'self' ? cleanOptional(currentUserId) : cleanOptional(filters.assignee)
  const updatedAfter = cleanOptional(filters.updatedAfter)
  const updatedBefore = cleanOptional(filters.updatedBefore)
  if (projectId) query.projectId = projectId
  if (groupId) query.groupId = groupId
  if (labels.length) query.labels = labels
  if (sourceBranch) query.sourceBranch = sourceBranch
  if (targetBranch) query.targetBranch = targetBranch
  if (authorId) query.authorId = authorId
  if (reviewerId) query.reviewerId = reviewerId
  if (assigneeId) query.assigneeId = assigneeId
  if (updatedAfter) query.updatedAfter = toGitLabDate(updatedAfter, false)
  if (updatedBefore) query.updatedBefore = toGitLabDate(updatedBefore, true)
  return query
}

export function serializeSearch(filters: AppliedSearch): Record<string, string> {
  const params: Record<string, string> = { page: String(filters.page), state: filters.state }
  addParam(params, 'search', filters.search)
  addParam(params, 'authorId', filters.authorId)
  addParam(params, 'assignee', filters.assignee)
  addParam(params, 'reviewer', filters.reviewer)
  addParam(params, 'updatedAfter', filters.updatedAfter)
  addParam(params, 'updatedBefore', filters.updatedBefore)
  addParam(params, 'projectId', filters.projectId)
  addParam(params, 'groupId', filters.groupId)
  addParam(params, 'labels', canonicalLabels(filters.labels))
  addParam(params, 'sourceBranch', filters.sourceBranch)
  addParam(params, 'targetBranch', filters.targetBranch)
  addParam(params, 'orderBy', filters.orderBy)
  addParam(params, 'sort', filters.sort)
  return params
}

export function makeInitialState(params: Record<string, string>, initialQuery: string, projectId: string | undefined, currentUserId: string | undefined): { applied: AppliedSearch; draft: SearchDraft; error: string | null } {
  const state = isState(params.state) ? params.state : 'all'
  const groupId = params.groupId ?? params.group ?? ''
  const draft: SearchDraft = {
    assignee: params.assignee ?? params.assigneeId ?? '',
    authorId: params.authorId ?? params.author ?? '',
    groupId,
    labels: params.labels ?? '',
    projectId: params.projectId ?? params.project ?? (groupId ? '' : projectId ?? ''),
    reviewer: params.reviewer ?? params.reviewerId ?? '',
    search: params.search ?? initialQuery,
    sourceBranch: params.sourceBranch ?? '',
    state,
    targetBranch: params.targetBranch ?? '',
    updatedAfter: params.updatedAfter ?? '',
    updatedBefore: params.updatedBefore ?? '',
    orderBy: validOrderBy(params.orderBy) ? params.orderBy : 'updated_at',
    sort: validSort(params.sort) ? params.sort : 'desc',
  }
  const page = parsePage(params.page)
  const error = validateDraft(draft, currentUserId)
  return { applied: { ...draft, page }, draft, error }
}

export function validateDraft(draft: SearchDraft, currentUserId?: string): string | null {
  if (!isState(draft.state)) return translate('mrList.errors.state')
  if (draft.projectId.trim() && draft.groupId.trim()) return translate('mrList.errors.projectAndGroup')
  if (draft.projectId.trim() && !isPositiveDecimalId(draft.projectId)) return translate('mrList.errors.projectId')
  if (draft.groupId.trim() && !isValidGroupId(draft.groupId.trim())) return translate('mrList.errors.groupId')
  if (draft.authorId.trim() && !isPositiveDecimalId(draft.authorId)) return translate('mrList.errors.authorId')
  if (draft.reviewer.trim() && draft.reviewer !== 'self' && !isPositiveDecimalId(draft.reviewer)) return translate('mrList.errors.reviewerId')
  if (draft.reviewer === 'self' && currentUserId && !isPositiveDecimalId(currentUserId)) return translate('mrList.errors.reviewerSelf')
  if (draft.assignee.trim() && draft.assignee !== 'self' && !isPositiveDecimalId(draft.assignee)) return translate('mrList.errors.assigneeId')
  if (draft.assignee === 'self' && !isPositiveDecimalId(currentUserId ?? '')) return translate('mrList.errors.assigneeSelf')
  if (draft.updatedAfter && !isIsoDateValue(draft.updatedAfter)) return translate('mrList.errors.updatedAfter')
  if (draft.updatedBefore && !isIsoDateValue(draft.updatedBefore)) return translate('mrList.errors.updatedBefore')
  if (draft.updatedAfter && draft.updatedBefore && Date.parse(toGitLabDate(draft.updatedAfter, false)) > Date.parse(toGitLabDate(draft.updatedBefore, true))) return translate('mrList.errors.updatedRange')
  return null
}

export function isPositiveDecimalId(value: string): boolean {
  return /^[1-9]\d*$/u.test(value.trim())
}

export function isValidGroupId(value: string): boolean {
  const normalized = value.trim()
  if (/^\d+$/u.test(normalized)) return isPositiveDecimalId(normalized)
  return normalized.split('/').every((segment) => /^[A-Za-z0-9_.-]+$/u.test(segment) && segment !== '.' && segment !== '..')
}

export function parseLabels(value: string): string[] {
  return [...new Set(value.split(',').map((label) => label.trim()).filter(Boolean))]
}

export function canonicalLabels(value: string | undefined): string | undefined {
  const labels = parseLabels(value ?? '')
  return labels.length ? labels.join(',') : undefined
}

export function isIsoDateValue(value: string): boolean {
  const normalized = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    const date = new Date(`${normalized}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(normalized)
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(normalized)) return false
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) return false
  const canonical = normalized.includes('.') ? normalized : normalized.replace(/Z$/u, '.000Z')
  return new Date(timestamp).toISOString() === canonical
}

export function toGitLabDate(value: string, endOfDay: boolean): string {
  const normalized = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return `${normalized}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
  return normalized
}

export function toDateInputValue(value: string): string {
  return value.trim().slice(0, 10)
}


export function parsePage(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/u.test(value)) return 1
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

export function isState(value: string | undefined): value is MergeRequestState {
  return value === 'all' || value === 'opened' || value === 'closed' || value === 'merged'
}

export function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed || undefined
}

export function addParam(params: Record<string, string>, key: string, value: string | undefined): void {
  const clean = cleanOptional(value)
  if (clean) params[key] = clean
}

export function sameSavedSearch(left: SavedMergeRequestSearch, right: SavedMergeRequestSearch): boolean {
  return left.query === right.query
    && left.state === right.state
    && left.projectId === right.projectId
    && left.groupId === right.groupId
    && canonicalLabels(left.labels) === canonicalLabels(right.labels)
    && left.sourceBranch === right.sourceBranch
    && left.targetBranch === right.targetBranch
    && left.authorId === right.authorId
    && left.assignee === right.assignee
    && left.reviewer === right.reviewer
    && (left.orderBy ?? 'updated_at') === (right.orderBy ?? 'updated_at')
    && (left.sort ?? 'desc') === (right.sort ?? 'desc')
    && left.updatedAfter === right.updatedAfter
    && left.updatedBefore === right.updatedBefore
}

/** A saved search's name when none is given, such as 「Merged · 検索語」. */
export function defaultSearchLabel(search: SearchDraft): string {
  const detail = search.search.trim() || (cleanOptional(search.groupId) ? translate('mrList.saved.defaultGroup', { group: search.groupId.trim() }) : null)
  return [translate(STATE_NAMES[search.state]), detail].filter(Boolean).join(' · ')
}

export function validOrderBy(value: string | undefined): value is OrderBy {
  return value === 'updated_at' || value === 'created_at'
}

export function validSort(value: string | undefined): value is SortDirection {
  return value === 'asc' || value === 'desc'
}
