// A new event exists only in the wizard until it is saved. When a save once went
// wrong with nothing on screen to say so, the whole form was gone and had to be
// typed again. So the create wizard keeps its work in this browser as it is typed
// and brings it back when the wizard opens again (a reload, a language switch, a
// closed tab), until the event is saved or the admin starts afresh. The logout
// drops it, so the next admin on a shared computer does not open someone else's
// event. Per browser only, and storage may be unavailable (private window,
// blocked site data) — the wizard then simply works as before.

const DRAFT_KEY = 'registrace:new-event-draft:v1'

export type NewEventDraft = { savedAt: string; step: number; data: string }

export function readNewEventDraft(): NewEventDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<NewEventDraft>
    return typeof d.savedAt === 'string' && typeof d.step === 'number' && typeof d.data === 'string'
      ? (d as NewEventDraft)
      : null
  } catch {
    return null
  }
}

export function writeNewEventDraft(draft: NewEventDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable — the wizard still works, it just cannot remember.
  }
}

export function clearNewEventDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing stored, or nothing reachable — either way there is nothing to clear.
  }
}
