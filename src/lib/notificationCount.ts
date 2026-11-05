/** The notification count as the bell and the app icon show it; `more` adds "+" when further notifications were not loaded. */
export function countLabel(count: number, more: boolean): string {
  return count > 9 ? '9+' : more ? `${count || ''}+` : String(count)
}
