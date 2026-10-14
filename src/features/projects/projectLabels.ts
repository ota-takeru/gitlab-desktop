import type { Project } from '../../types/gitlab'
import { scopedKey, type PreferenceScope } from '../shared/preferences'

/** What a favourite or recent project shortcut shows instead of its bare id. */
export interface ProjectLabel { name: string; pathWithNamespace: string }

/**
 * Names of pinned and recent projects, stored beside their id lists. Ids saved
 * before names were kept have no entry and show a fallback until the project
 * is seen again in a list.
 */
export function readProjectLabels(scope: PreferenceScope): Record<string, ProjectLabel> {
  try {
    const raw = globalThis.localStorage?.getItem(scopedKey(scope, 'project-labels'))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ProjectLabel] => {
      const value = entry[1] as Partial<ProjectLabel> | null
      return Boolean(value) && typeof value?.name === 'string' && typeof value.pathWithNamespace === 'string'
    }))
  } catch {
    return {}
  }
}

/** Adds the given projects and keeps only the ids still pinned or recent. */
export function writeProjectLabels(scope: PreferenceScope, current: Record<string, ProjectLabel>, projects: Project[], keepIds: string[]): Record<string, ProjectLabel> {
  const keep = new Set(keepIds)
  const merged: Record<string, ProjectLabel> = { ...current }
  for (const project of projects) merged[project.id] = { name: project.name, pathWithNamespace: project.pathWithNamespace }
  const next = Object.fromEntries(Object.entries(merged).filter(([id]) => keep.has(id)))
  try {
    globalThis.localStorage?.setItem(scopedKey(scope, 'project-labels'), JSON.stringify(next))
  } catch {
    // Names are a convenience; the shortcut still opens by id without them.
  }
  return next
}

export function sameProjectLabel(label: ProjectLabel | undefined, project: Project): boolean {
  return label?.name === project.name && label.pathWithNamespace === project.pathWithNamespace
}
