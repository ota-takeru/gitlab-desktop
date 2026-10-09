import type { Discussion, GitLabCommandError, GitLabSnapshot } from '../../types/gitlab'

export interface PageState {
  data: Discussion[] | null
  snapshot: GitLabSnapshot<Discussion[]> | null
  error: GitLabCommandError | null
  loading: boolean
  refreshing: boolean
  refresh: () => void
}

/** Holds the observed pages outside React state so page observers can publish without re-render loops. */
export class PageStore {
  private pages = new Map<number, PageState>()
  private listeners = new Set<() => void>()
  private version = 0

  get(page: number): PageState | undefined { return this.pages.get(page) }
  entries(): Array<[number, PageState]> { return [...this.pages.entries()] }

  set(page: number, next: PageState): void {
    const previous = this.pages.get(page)
    this.pages.set(page, next)
    // The refresh callback may be recreated on every render; only data changes notify.
    if (previous && previous.data === next.data && previous.error === next.error && previous.loading === next.loading && previous.refreshing === next.refreshing && previous.snapshot?.fetchedAt === next.snapshot?.fetchedAt && previous.snapshot?.totalPages === next.snapshot?.totalPages && previous.snapshot?.nextPage === next.snapshot?.nextPage && previous.snapshot?.source === next.snapshot?.source) return
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getVersion = () => this.version
}
