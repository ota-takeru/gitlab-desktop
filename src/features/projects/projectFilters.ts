import { translate, type MessageKey } from '../../i18n/i18n'
import type { ProjectOrderBy, ProjectQuery, ProjectVisibility } from '../../types/gitlab'
import { canonicalLabels, parseLabels, toGitLabDate } from '../mergeRequests/mergeRequestSearch'

/** The project list's conditions beyond the search word, membership and archived projects. */
export interface ProjectFilterValues {
  contributorId: string
  /** The chosen person's name, for its tag. */
  contributorName: string
  groupId: string
  /** The chosen group's full path, for its tag. */
  groupPath: string
  visibility: '' | ProjectVisibility
  minAccessLevel: string
  topics: string
  language: string
  starred: boolean
  activityAfter: string
  activityBefore: string
  orderBy: ProjectOrderBy
  sort: 'asc' | 'desc'
}

export const defaultProjectFilters: ProjectFilterValues = { activityAfter: '', activityBefore: '', contributorId: '', contributorName: '', groupId: '', groupPath: '', language: '', minAccessLevel: '', orderBy: 'last_activity_at', sort: 'desc', starred: false, topics: '', visibility: '' }

export type ProjectConditionKind = 'contributor' | 'group' | 'visibility' | 'access' | 'topics' | 'language' | 'starred' | 'activity'

/** In the order 「＋条件を追加」 lists them. */
const CONDITION_KINDS: readonly ProjectConditionKind[] = ['contributor', 'group', 'visibility', 'access', 'topics', 'language', 'starred', 'activity']

export const CONDITION_NAMES: Record<ProjectConditionKind, MessageKey> = {
  access: 'project.condition.access',
  activity: 'project.condition.activity',
  contributor: 'project.condition.contributor',
  group: 'project.condition.group',
  language: 'project.condition.language',
  starred: 'project.condition.starred',
  topics: 'project.condition.topics',
  visibility: 'project.condition.visibility',
}

export const VISIBILITY_NAMES: Record<ProjectVisibility, MessageKey> = { internal: 'project.visibility.internal', private: 'project.visibility.private', public: 'project.visibility.public' }
export const ACCESS_NAMES: Record<string, MessageKey> = { 20: 'project.access.reporter', 30: 'project.access.developer', 40: 'project.access.maintainer', 50: 'project.access.owner' }
export const ORDER_NAMES: Record<ProjectOrderBy, MessageKey> = { created_at: 'project.order.created', last_activity_at: 'project.order.lastActivity', name: 'project.order.name', star_count: 'project.order.stars' }

/**
 * GitLab lists a group's projects without the language and activity filters, so those are not offered with a group,
 * and a person's contributed projects without any filter, so nothing more is offered with a contributor.
 */
export function addableKinds(values: ProjectFilterValues): ProjectConditionKind[] {
  if (values.contributorId) return []
  return CONDITION_KINDS.filter((kind) => !(kind === 'starred' && values.starred) && !(values.groupId && (kind === 'language' || kind === 'activity')))
}

/** Choosing a contributor clears the conditions their list cannot take. */
export function contributorPatch(contributorId: string, contributorName: string): Partial<ProjectFilterValues> {
  return { activityAfter: '', activityBefore: '', contributorId, contributorName, groupId: '', groupPath: '', language: '', minAccessLevel: '', starred: false, topics: '', visibility: '' }
}

/** The query fields of the conditions. */
export function projectFilterQuery(values: ProjectFilterValues): Partial<ProjectQuery> {
  const query: Partial<ProjectQuery> = {}
  const topics = parseLabels(values.topics)
  if (values.contributorId) query.contributorId = values.contributorId
  if (values.groupId) query.groupId = values.groupId
  if (values.visibility) query.visibility = values.visibility
  if (values.minAccessLevel) query.minAccessLevel = Number(values.minAccessLevel)
  if (topics.length) query.topics = topics
  if (values.language.trim()) query.language = values.language.trim()
  if (values.starred) query.starred = true
  if (values.activityAfter) query.lastActivityAfter = toGitLabDate(values.activityAfter, false)
  if (values.activityBefore) query.lastActivityBefore = toGitLabDate(values.activityBefore, true)
  if (values.orderBy !== defaultProjectFilters.orderBy) query.orderBy = values.orderBy
  if (values.sort !== defaultProjectFilters.sort) query.sort = values.sort
  return query
}

export interface ProjectConditionChip { kind: ProjectConditionKind; name: string; label: string; clear: Partial<ProjectFilterValues>; code?: boolean }

/** One tag per applied condition: its name for ✕, its value as its text. */
export function projectConditionChips(values: ProjectFilterValues): ProjectConditionChip[] {
  const chips: ProjectConditionChip[] = []
  const add = (kind: ProjectConditionKind, value: string, clear: Partial<ProjectFilterValues>, code?: boolean) => {
    const name = translate(CONDITION_NAMES[kind])
    chips.push({ clear, code, kind, label: kind === 'starred' ? name : `${name}: ${value}`, name })
  }
  if (values.contributorId) add('contributor', values.contributorName || values.contributorId, { contributorId: '', contributorName: '' })
  if (values.groupId) add('group', values.groupPath || values.groupId, { groupId: '', groupPath: '' }, true)
  if (values.visibility) add('visibility', translate(VISIBILITY_NAMES[values.visibility]), { visibility: '' })
  if (values.minAccessLevel) add('access', translate(ACCESS_NAMES[values.minAccessLevel]), { minAccessLevel: '' })
  const topics = canonicalLabels(values.topics)
  if (topics) add('topics', topics, { topics: '' })
  if (values.language.trim()) add('language', values.language.trim(), { language: '' })
  if (values.starred) add('starred', '', { starred: false })
  if (values.activityAfter || values.activityBefore) add('activity', `${values.activityAfter || '…'} – ${values.activityBefore || '…'}`, { activityAfter: '', activityBefore: '' })
  return chips
}
