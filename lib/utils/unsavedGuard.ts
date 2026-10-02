// One screen at a time may hold unsaved work (the admin registration editor).
// A control that navigates WITHOUT a link — the language switch and the logout,
// both buttons calling router.push — cannot be caught by the editor's own click
// interceptor, so it asks here first. Client-only module state: it lives for the
// page, and the editor clears it on unmount and as soon as nothing is unsaved.

let message: string | null = null

/** Set while there are unsaved changes (the confirm text), null once there are none. */
export function setUnsavedGuard(next: string | null): void {
  message = next
}

/** True when it is fine to navigate away — nothing unsaved, or the user agreed. */
export function confirmLeave(): boolean {
  return message === null || window.confirm(message)
}
