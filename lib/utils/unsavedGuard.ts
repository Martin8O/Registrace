// One screen at a time may hold unsaved work (the admin registration editor or
// the event wizard).
// A control that navigates WITHOUT a link — the language switch and the logout,
// both buttons calling router.push — cannot be caught by the editor's own click
// interceptor, so it asks here first. Client-only module state: it lives for the
// page, and the screen clears it on unmount and as soon as nothing is unsaved.

import { useEffect } from 'react'

let message: string | null = null

/** Set while there are unsaved changes (the confirm text), null once there are none. */
export function setUnsavedGuard(next: string | null): void {
  message = next
}

/** True when it is fine to navigate away — nothing unsaved, or the user agreed. */
export function confirmLeave(): boolean {
  return message === null || window.confirm(message)
}

/**
 * While `active`, leaving the screen asks first: closing the tab (beforeunload),
 * any same-origin in-app link (caught in the capture phase, before Next's own
 * click handler runs — its <Link> navigates client-side, which beforeunload never
 * sees) and the two button exits, language switch and logout, through the shared
 * guard above. The browser's Back button is covered by none of them.
 */
export function useLeaveGuard(active: boolean, leaveMessage: string): void {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      // A click that opens another tab or window leaves this screen where it is.
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return
      if (!window.confirm(leaveMessage)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    setUnsavedGuard(leaveMessage)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      setUnsavedGuard(null)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, leaveMessage])
}
