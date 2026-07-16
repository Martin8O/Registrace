// lib/auth-errors — map a Supabase AuthError to a next-intl key.
//
// WHY: AuthError carries two things — `message`, which is an English-only human
// string produced by GoTrue, and `code`, a stable machine-readable identifier
// (the union in @supabase/auth-js/lib/error-codes). Showing `message` raw would
// put English in front of a Czech admin and break the bilingual guarantee (UI
// text belongs in locales/*.json, never inlined). So we branch on `code` and let
// the caller translate.
//
// Returns null for codes we have no wording for. Callers must then fall back to
// their generic message — optionally appending the raw `message`, which is worse
// than a translation but far better than silently swallowing the reason.
//
// Keys live under `admin.authErrors.*` in locales/{cs,en}.json.

// Client-safe: no Prisma, no server-only imports.
export function authErrorKey(code: string | undefined): string | null {
  switch (code) {
    // --- password change (updateUser({ password })) ---
    case "weak_password":
      // Auth rejected the password as too weak — length, character classes, or
      // (on plans that offer it) a leaked-password check.
      return "weakPassword";
    case "same_password":
      return "samePassword";

    // --- throttling ---
    case "over_request_rate_limit":
      return "rateLimited";
    case "over_email_send_rate_limit":
      return "emailRateLimited";

    // --- the session backing this change is gone ---
    case "session_expired":
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "sessionExpired";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
    case "reauth_nonce_missing":
      return "reauthNeeded";

    // --- email change (updateUser({ email })) ---
    case "email_exists":
    case "user_already_exists":
    case "identity_already_exists":
      return "emailExists";
    case "email_address_invalid":
      return "emailInvalid";
    case "email_address_not_authorized":
      return "emailNotAuthorized";

    case "user_banned":
      return "userBanned";
    case "validation_failed":
      return "validationFailed";

    default:
      return null;
  }
}
