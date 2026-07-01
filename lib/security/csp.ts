// lib/security/csp — Content-Security-Policy builder (P8 hardening, revised). The
// original static policy in next.config.ts shipped `script-src 'self'
// 'unsafe-inline'`, which let ANY inline <script> run and so gave CSP no real XSS
// mitigation. This builds a PER-REQUEST nonce policy for PRODUCTION instead (the
// nonce is generated in proxy.ts and Next tags its own scripts with it), dropping
// 'unsafe-inline' from script-src. Edge- and Node-safe: pure string building.
//
// DEV keeps the permissive policy (unsafe-inline + unsafe-eval, no nonce) so HMR /
// React Refresh are untouched — dev is not a security boundary, and a nonce would
// force every dev-injected inline script to be nonced or break. Prod is strict.

// Resolve the Supabase origin for connect-src (the browser talks DIRECTLY to
// Supabase Auth on login/logout/profile — a bare default-src 'self' would 403
// every auth call). Falls back to a wildcard if the env var is momentarily unset
// so auth can never be locked out. `wss:` covers Supabase realtime.
export function supabaseOriginForCsp(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "https://*.supabase.co";
  try {
    return new URL(url).origin;
  } catch {
    return "https://*.supabase.co";
  }
}

// Build the CSP header value for one request.
//   • With a nonce (production): script-src = nonce + 'strict-dynamic'. CSP3
//     browsers then trust scripts loaded by the nonce'd bootstrap and IGNORE
//     'self'/host allowlists — the modern robust policy. NO 'unsafe-inline'.
//   • Without a nonce (dev): script-src = 'self' 'unsafe-inline' 'unsafe-eval' so
//     HMR keeps working; connect-src also allows ws:.
//   • style-src always keeps 'unsafe-inline' — Next/Tailwind inject inline <style>,
//     which carries no script-grade XSS risk; nonce-ing every style is impractical.
export function buildCsp(opts: { nonce?: string; isDev: boolean }): string {
  const { nonce, isDev } = opts;
  const supabaseOrigin = supabaseOriginForCsp();
  const wss = supabaseOrigin.replace("https://", "wss://");
  const scriptSrc = nonce
    ? `script-src 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`;
  return [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin} ${wss}${isDev ? " ws:" : ""}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");
}

// Edge-safe base64 nonce (16 random bytes). Web Crypto + btoa are globals in both
// the edge and node runtimes.
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
