// lib/validation/password — the admin password policy.
//
// SCOPE — read this before trusting it. Admin passwords are set by the browser
// calling Supabase Auth DIRECTLY (`auth.updateUser({ password })` in
// set-password / profile). None of our own server routes sit in that path, so
// this module CANNOT enforce anything: it is the informational half, exactly like
// frontend pricing (invariant 3). It exists to tell an admin what is required and
// to show them, live, what is still missing — not to be the gate.
//
// The authoritative gate is Supabase's own policy, configured in the project
// dashboard (Authentication → Providers → Email):
//   • Minimum password length      → MIN_LENGTH below
//   • Password Requirements        → "Lowercase, uppercase letters, digits and symbols"
// KEEP THE TWO IN SYNC. If the dashboard is laxer, a password this module rejects
// can still be set by anyone who skips the UI; if it is stricter, Supabase rejects
// a password this checklist showed as complete (which the admin then sees via the
// weak_password wording in lib/auth-errors).
//
// Client-safe: no Prisma, no server-only imports (validation convention).

export const MIN_LENGTH = 12;

export type PasswordRuleId = "length" | "lowercase" | "uppercase" | "digit" | "symbol";

// Order is the display order of the checklist.
export const PASSWORD_RULES: readonly {
  id: PasswordRuleId;
  test: (value: string) => boolean;
}[] = [
  { id: "length", test: (v) => v.length >= MIN_LENGTH },
  { id: "lowercase", test: (v) => /\p{Ll}/u.test(v) },
  { id: "uppercase", test: (v) => /\p{Lu}/u.test(v) },
  { id: "digit", test: (v) => /\p{Nd}/u.test(v) },
  // "Symbol" = anything that is not a letter, a digit or whitespace. Defined by
  // exclusion rather than a fixed ASCII set so that punctuation outside ASCII
  // (and Czech keyboard symbols) counts too.
  { id: "symbol", test: (v) => /[^\p{L}\p{N}\s]/u.test(v) },
] as const;

export type PasswordRuleState = { id: PasswordRuleId; met: boolean };

/** Per-rule state for the live checklist. Always returns every rule, in order. */
export function checkPassword(value: string): PasswordRuleState[] {
  return PASSWORD_RULES.map((r) => ({ id: r.id, met: r.test(value) }));
}

/** True when every rule passes — gates the submit button (UX only, see header). */
export function isPasswordValid(value: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(value));
}
