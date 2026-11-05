/** Text input keeps its own keys, so letter shortcuts and list movement leave these alone. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}

/** An open menu or listbox owns letter keys (MUI only consumes letters that match an item). */
export function isInsideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"], [role="menubar"], [role="listbox"]') !== null
}
