# REGISTRACE — Project Memory for Claude Code

Bilingual (CZ/EN) web app for registering to meditation / community events run by
Buddhismus Diamantové cesty (BDC) centres. Public users register themselves + fellow
participants; the app prices the stay and emails a confirmation. Admins manage events,
registrations, and exports.

> This file is the always-loaded **constitution**: stable rules + navigation only.
> Point-in-time status, milestone logs, and deep reference live in `local/` and
> `DEVELOPMENT_HISTORY*.md` (see below). Do not paste build status into this file.

## Session Start Protocol
At the start of every new session, before any other action:
1. Read `local/SESSION_BOOTSTRAP.md` fully (current state, phase, invariants, progress).
3. Check whether the user has left notes or updated the bootstrap since last session.
4. Confirm the current active prompt with the user before executing it.
5. Consult other `local/` files only when you need deeper detail (index below).

## Memory directory (OVERRIDE — project-local, not user-profile)
All memory files for this project live in **`local/wiki/`** (gitignored, copied manually
when moving to a new machine). This overrides the default Claude Code auto-memory path
(`C:\Users\…\.claude\projects\…\memory\`).

- **Index:** `local/wiki/MEMORY.md` — one-line pointer per memory file.
- **Reads:** always look up memories from `local/wiki/`.
- **Writes:** always write new memory files to `local/wiki/` and update `local/wiki/MEMORY.md`.
- Never write project memory to the user-profile path (`C:\Users\svobo\.claude\…`).

## Where things live (`local/` — gitignored, never pushed)
`local/` is Claude Code's internal workspace (notes, wiki, session state).
- `SESSION_BOOTSTRAP.md` — **read every session**: current state, invariants, build progress.
- `architecture.md` — data model, API route map, auth/roles (read before schema/API work).
- `visual-identity.md` — BDC design tokens, fonts, component classes (read before UI work).
- `CLAUDE - ALL PROMPTS.md` — canonical build guide B1–B8 + P1–P8 (source of the next prompt).
- `Prompts requirements.md` — how prompts must be structured (5 blocks, definition-of-done).
- `Step B*.md` — finalized, ready-to-run prompts per phase (incl. full B4.5 token spec).
- `wiki/` — project memory files (MEMORY.md index + individual memory files).

Build history (committed, repo root): `DEVELOPMENT_HISTORY.md` (CZ) + `DEVELOPMENT_HISTORY_en.md`
(EN) — full chronological per-milestone log.

## Tech stack
Next.js 16 App Router · TypeScript strict · Prisma 7 ORM · Supabase (Postgres hosting + Auth) ·
next-intl 4 (i18n) · Zod 4 (validation — only lib) · React Hook Form · Resend (email) · Vercel.
**No Docker.** Exact versions → `package.json`; deeper stack notes → SESSION_BOOTSTRAP §A.

## Mandatory architecture rules (non-negotiable)
1. Auth = Supabase Auth. Data = Prisma. Never mix.
2. Pricing engine = /modules/pricing, pure functions, server-only, no DB access.
3. Frontend prices are informational only. Backend prices are authoritative.
4. Final prices always recalculated server-side before DB write.
5. UI texts = next-intl JSON files. Event content = bilingual DB columns (title_cs/title_en).
6. Email = Resend only. Email failure is non-blocking (never rollback DB transaction).
7. Hosting = Vercel + Supabase. No Docker.
8. No fat route handlers. Business logic in /modules/* services.
9. Soft delete (deletedAt) on all audit-relevant entities. No permanent deletion.
10. Monetary values = whole CZK integers (80 CZK stored as 80, not 8000).
11. Datetimes = UTC in DB, displayed in Europe/Prague timezone in UI.
12. User.id = @db.Uuid (matches Supabase Auth auth.users.id UUID format).
13. Supabase needs two connection strings: pooled DATABASE_URL (port 6543) and direct DIRECT_URL (port 5432).
14. Registration submission = idempotent (client sends UUID v4 idempotencyKey).
15. PricingType applies only to AGE_15_PLUS. Age 0–14 always dailyRate = 0.
16. User cancellation not supported — admins only. Deliberate product decision.
17. Export endpoint = POST (not GET), filters in body.
18. Honeypot field on registration form, validated server-side.
19. Max 10 participants per registration.
20. SUPER_ADMIN sees all. ADMIN is scoped to their center(s) only.
- Fields named `*Discount` are **subtracted** from the total, not added
  (morningArrivalDiscount, afternoonArrivalDiscount, eveningArrivalDiscount, earlyDepartureDiscount).

## Roles
- **SUPER_ADMIN** (Martin) — full access to everything; assigns center admins via User
  Management; can manage events for any center.
- **ADMIN** — center-scoped; can create/manage events of their assigned centre(s)
  (`Event.centerId ∈ their UserCenter`). A centre may have several admins who all manage its
  events. `Event.createdBy` is kept only as a record of who created it, not for access control (M27).

Deeper detail (session vs. body, ownership 403): architecture.md §Auth/roles.

## Folder structure
```
app/[locale]/        public pages (CZ/EN)        app/api/           API routes
components/{public,admin,shared}                 locales/{cs,en}.json
modules/{events,registrations,pricing,auth}      lib/{db,validation,utils,email}
prisma/{schema.prisma,seed.ts,migrations}        prisma.config.ts   generated/prisma (gitignored)
proxy.ts (i18n)      i18n/request.ts             lib/mock/events.ts (presentation scaffold)
```
Full map with model relations: architecture.md.

## Translation key conventions
All keys are nested — no flat root-level keys. Namespaces: `form` (registration form),
`home` (homepage), `event` (event detail page), `badge` (status badges).
Keep these distinct — different UI elements, never merge one into the other:
- `form.pricing_info` — section label **inside** the registration form
- `event.pricingInfo` — button label on the event **detail page**

## Current status & frozen files
- Build phase, progress, and the milestone log are owned by `local/SESSION_BOOTSTRAP.md` (§B)
  and `DEVELOPMENT_HISTORY*.md`. Read them for current state — **do not restate status here.**
- **Schema/validation/API unfrozen as of B7** — `prisma/schema.prisma`, `lib/validation/*`,
  and `app/api/*` are now live and editable. Change the schema only via a Prisma migration
  (driver-adapter pattern; `DIRECT_URL` for migrate). (`lib/mock/*` is presentation scaffolding
  still imported by the not-yet-wired admin pages — left until their P-phase wiring.)
