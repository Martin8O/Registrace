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
// dashboard (Authentication → Providers → Email) and currently set to:
//   • Minimum password length → 12                        (mirrored by MIN_LENGTH)
//   • Password Requirements   → "Lowercase, uppercase letters, digits and symbols"
//                                                         (mirrored by the sets below)
// KEEP THE TWO IN SYNC, and mind the DIRECTION of any drift:
//   • client laxer than GoTrue  → the checklist goes all-ticks, the button enables,
//     and Supabase still refuses. The admin is told "weak password" by a form that
//     just said the password was fine. This is the bug to avoid.
//   • client stricter than GoTrue → the button simply stays disabled until the
//     stricter rule is met. Harmless, and the deliberate choice for length.
//
// Client-safe: no Prisma, no server-only imports (validation convention).

export const MIN_LENGTH = 12;

// ── Mirror of the GoTrue character sets ──────────────────────────────────────
// GoTrue validates with `strings.ContainsAny(password, characterSet)` against
// LITERAL sets configured as GOTRUE_PASSWORD_REQUIRED_CHARACTERS (colon-separated).
// It is not a Unicode-category check, so these sets are ASCII and must stay that
// way. Widening any of them re-introduces the bug this replaced: Unicode classes
// (\p{Ll} etc.) tick "lowercase" for ř and "uppercase" for Ž, which GoTrue does
// not accept — the checklist would go all-green and Supabase would still refuse
// the password. A Czech keyboard walks straight into that: ř/Ž/§ are on the main
// rows while @ and # need AltGr.
//   Source: supabase/auth internal/api/password.go + conf/configuration.go
//   Docs:   https://supabase.com/docs/guides/auth/password-security
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
export const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

const containsAny = (value: string, set: string) => [...value].some((ch) => set.includes(ch));

export type PasswordRuleId = "length" | "lowercase" | "uppercase" | "digit" | "symbol";

// Order is the display order of the checklist.
export const PASSWORD_RULES: readonly {
  id: PasswordRuleId;
  test: (value: string) => boolean;
}[] = [
  // Deliberately counts CHARACTERS while GoTrue's MinLength counts BYTES
  // (Go's len() on a UTF-8 string). For ASCII the two agree; for Czech text a
  // character is 2 bytes, so this is the stricter of the pair. That direction is
  // the safe one — the admin is simply held to 12 real characters and never sees
  // a password the checklist approved get rejected.
  { id: "length", test: (v) => [...v].length >= MIN_LENGTH },
  { id: "lowercase", test: (v) => containsAny(v, LOWERCASE) },
  { id: "uppercase", test: (v) => containsAny(v, UPPERCASE) },
  { id: "digit", test: (v) => containsAny(v, DIGITS) },
  { id: "symbol", test: (v) => containsAny(v, SYMBOLS) },
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
