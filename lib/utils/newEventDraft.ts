// A new event exists only in the wizard until it is saved. When a save once went
// wrong with nothing on screen to say so, the whole form was gone and had to be
// typed again. So the create wizard keeps its work in this browser as it is typed
// and brings it back when the wizard opens again (a reload, a language switch, a
// closed tab), until the event is saved or the admin starts afresh. Per browser
// only, and storage may be unavailable (private window, blocked site data) — the
// wizard then simply works as before.
//
// The draft belongs to the admin who typed it. The logout drops it, but a session
// can also end without the logout button (it expires, or an invite or reset link
// signs this browser in as someone else), so every draft carries its author's id
// and is discarded unread when another admin opens the wizard: the next admin on a
// shared computer must never see someone else's event and contact details.

const DRAFT_KEY = 'registrace:new-event-draft:v2'
// Drafts written before they carried an author. Whose they are cannot be told, so
// they are dropped.
const OWNERLESS_KEYS = ['registrace:new-event-draft:v1']

export type NewEventDraft = { ownerId: string; savedAt: string; step: number; data: string }

/** The stored draft if it is `ownerId`'s; anything else stored is removed. */
export function readNewEventDraft(ownerId: string): NewEventDraft | null {
  try {
    for (const key of OWNERLESS_KEYS) window.localStorage.removeItem(key)
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<NewEventDraft>
    const valid =
      typeof d.ownerId === 'string' &&
      typeof d.savedAt === 'string' &&
      typeof d.step === 'number' &&
      typeof d.data === 'string'
    if (valid && d.ownerId === ownerId) return d as NewEventDraft
    window.localStorage.removeItem(DRAFT_KEY)
    return null
  } catch {
    clearNewEventDraft()
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

/**
 * Whether a restored wizard state has the shape of a fresh one: every key the
 * fresh state has is present with a value of the same kind (object, array,
 * number, string, boolean), recursively. A key the fresh state lacks is not
 * checked, so maps that grow as the admin types (one entry per meal day) pass.
 * The wizard renders straight from this state, so a draft written by an older
 * version of it, or edited by hand, would otherwise crash every later visit to
 * "Nová akce" — with the button that discards the draft inside the crashed screen.
 */
export function matchesShape(candidate: unknown, fresh: unknown): boolean {
  const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
  if (kind(candidate) !== kind(fresh)) return false
  if (kind(fresh) !== 'object') return true
  const c = candidate as Record<string, unknown>
  return Object.entries(fresh as Record<string, unknown>).every(
    ([key, value]) => key in c && matchesShape(c[key], value),
  )
}
