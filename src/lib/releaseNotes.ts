/** The changes this build ships, embedded by the release build; empty in development and local builds. */
export const CURRENT_RELEASE_NOTES = import.meta.env.VITE_RELEASE_NOTES?.trim() ?? ''

/** The notes' lines without their list markers; release notes are one change per `- ` line. */
export function releaseNoteLines(notes: string | null | undefined): string[] {
  return (notes ?? '').split('\n').map((line) => line.replace(/^\s*[-*]\s+/u, '').trim()).filter(Boolean)
}
