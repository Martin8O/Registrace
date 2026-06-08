# REGISTRACE — Project Memory for Claude Code

## What this project is
Bilingual (CZ/EN) web application for registration to meditation and community events.

## Session Start Protocol
At the start of every new session:

1. Read `local/SESSION_BOOTSTRAP.md` fully before any other action
2. Check if the user has left any notes or updated the bootstrap since last session
3. Confirm the current active prompt with the user before executing it
4. Consult other files in `local/` only when you need deeper detail on a specific topic

## `local/` directory
This directory is Claude Code's internal workspace — notes, wiki, session state. It is in
`.gitignore` and must never be pushed to GitHub.

Contents:
- `SESSION_BOOTSTRAP.md` — read every session (current state, invariants, progress)
- `architecture.md` — data model, API route map, auth/roles (read before schema/API work)
- `visual-identity.md` — BDC design tokens, fonts, component classes (read before UI work)
- `CLAUDE - ALL PROMPTS.md` — full canonical build guide B1–B8 + P1–P8 (source of the next prompt)
- `Prompts requirements.md` — how prompts must be structured (5 blocks, definition-of-done)
- `Step B4.5 - prompt 1-3.md` — design prompts + full B4.5 spec with all token values

## Tech stack
- Next.js App Router, TypeScript strict
- Prisma ORM (schema manager + ORM for all DB operations)
- Supabase (PostgreSQL hosting only + Supabase Auth for admin login)
- next-intl (i18n for static UI texts)
- Zod (validation — only library used)
- React Hook Form (forms)
- Resend (email)
- Vercel (hosting, serverless)
- No Docker

## Mandatory architecture rules
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

## Roles
- SUPER_ADMIN: full access to everything (Martin only)
- ADMIN: center-scoped; can only create and manage events where `Event.createdBy = their userId`

Super-admin assigns center admins via User Management in admin panel.
Super-admin can manage events for any center.

## Folder structure
/app/[locale]/ — public pages (CZ/EN routing)
/app/api/ — API routes
/components/public/ + /admin/ + /shared/
/locales/cs.json + en.json
/modules/events/ + registrations/ + pricing/ + auth/
/lib/db/ + validation/ + utils/ + email/
/prisma/schema.prisma + seed.ts + migrations/
/prisma.config.ts — Prisma 7 CLI config (root level)
/generated/prisma — generated Prisma client (gitignored)

## Pricing discount field naming
Fields named *Discount are subtracted from total (not added).
morningArrivalDiscount, afternoonArrivalDiscount, eveningArrivalDiscount, earlyDepartureDiscount

## Translation key conventions
All keys are nested — no flat root-level keys.
Namespaces: `form` (registration form), `home` (homepage),
`event` (event detail page), `badge` (status badges)

Key distinction to preserve:
- `form.pricing_info` — section label inside the registration form
- `event.pricingInfo` — button label on the event detail page
These are different UI elements; do not merge or replace one with the other.

## Current build status

### Milestones complete (2026-06-03 – 2026-06-05)

**Database foundation**
- Prisma schema: 8 enums, 11 models, migration `20260603120610_init` applied (Supabase, eu-west-1)
- `UserRole` enum: `SUPER_ADMIN` + `ADMIN` (default remains `ADMIN`)
- `UserCenter` join table: links users to their assigned centres; `@@unique([userId, centerId])`
- `Event.createdBy` — nullable UUID FK to `User`; scopes each event to its creator (ADMIN sees only their own events; SUPER_ADMIN sees all)
- Generator `output = "../generated/prisma"` (required in Prisma 7); datasource has no url/directUrl
- `prisma.config.ts` — CLI config; loads `.env.local` via dotenv, passes `DIRECT_URL` for migrate
- `lib/db/index.ts` — singleton via `@prisma/adapter-pg` with pooled `DATABASE_URL`
- Center table seeded with 25 records

**Validation layer** (`lib/validation/`)
- `registrations.ts` — `calculatePriceSchema`, `registrationSubmitSchema`
- `events.ts` — `eventCreateSchema` (status required), `eventUpdateSchema`, `eventStatusSchema`
- Refinements: honeypot must be empty, participants min 1 / max 10, pricingType rejected for non-AGE_15_PLUS
- `index.ts` — barrel re-export only
- No Prisma imports; enum values declared as local `as const` tuples

**API route stubs** (`app/api/`)
- Public: `GET /events`, `GET /events/[id]`, `POST /registration/calculate-price`, `POST /registration/submit`
- Admin: events (GET list, POST create, GET/PUT by id, PATCH status), registrations (GET list, GET/PUT by id, POST export, POST resend-confirmation), centers (GET/POST), audit-log (GET)
- Auth: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Stub auth guard: `app/api/_lib/guard.ts` — checks Authorization header; TODO: swap for Supabase session
- Stubs only: no DB writes, no pricing logic, no email sending

**Installed libraries**
- @prisma/client 7.8.0 + prisma 7.8.0
- @prisma/adapter-pg 7.8.0 + pg 8.21.0 + @types/pg 8.20.0
- @supabase/supabase-js 2.106.2 + @supabase/ssr 0.10.3
- next-intl 4.13.0
- zod 4.4.3
- react-hook-form 7.77.0 + @hookform/resolvers 5.4.0
- resend 6.12.4
- tsx 4.22.4 (dev) + dotenv 17.4.2 (dev)

**i18n routing**
- Locale routing via proxy.ts (Next.js 16 convention, named `proxy` export)
- Locales: cs (default) and en, prefix-always mode
- `X-NEXT-INTL-LOCALE` header read in root layout for correct `<html lang>`
- Translation keys: 39 keys in 4 namespaces — `form` (20), `home` (2), `badge` (1), `event` (16)

**Env files**
- .env.local — real values, gitignored
- .env.example — empty values, committed (safe)

**Public-facing pages** (`app/[locale]/`, `components/`)
- `lib/mock/events.ts` — typed `MockEvent[]` with 4 statuses; DRAFT never shown publicly
- `components/shared/LanguageSwitcher.tsx` — client component; segment-split pathname, preserves path on switch
- `components/public/PricingModal.tsx` — full-screen overlay, 12 hardcoded pricing rows, closes on button or overlay click
- `components/public/PricingInfoButton.tsx` — client island that owns modal `useState`, usable from server-component pages
- `app/[locale]/page.tsx` — lists PUBLISHED events only (DRAFT/CLOSED/ARCHIVED all hidden)
- `app/[locale]/events/[id]/page.tsx` — localized title/subtitle, PricingInfoButton, registration placeholder; `notFound()` on unknown id
- `app/[locale]/layout.tsx` — extended with `min-h-screen bg-white` wrapper

**Translation key refactor**
- All 20 original flat root-level keys moved under `form` namespace
- No flat string keys remain at root level; all keys are nested
- Total: 39 keys across 4 namespaces (`form`, `home`, `badge`, `event`)

**Schema addendum — Event.createdBy** (`prisma/schema.prisma`)
- `Event.createdBy String? @db.Uuid` — FK to `User`, nullable (existing events → NULL)
- `Event.creator User?` — relation field; `@@index([createdBy])` added
- `User.createdEvents Event[]` — back-relation
- Migration not yet applied (pending with UserRole/UserCenter in B7)

**Last verified** (2026-06-05)
- `npx tsc --noEmit` → 0 errors
- `npm run build` → clean, no warnings (Next.js 16.2.7 Turbopack)

### Design system (B4.5) — standing rules

(Full implementation log in `DEVELOPMENT_HISTORY.md`, Milestone 9.)

- **Tailwind v4** (4.3.0), **no `tailwind.config.ts`**. Design tokens live in
  `app/globals.css` via `@theme` (not a JS config); component classes under
  `@layer components`.
- **Fonts** load through `next/font/google` exposed as `@theme inline` variables on
  `<html>`: `--font-serif` (Crimson Pro), `--font-sans` (Inter), `--font-mono` (JetBrains Mono).
- **Content width**: `max-w-public` (768px) for public page content; `max-w-admin` (1200px)
  for the header wrapper.
- **Header** (`app/[locale]/layout.tsx`): sticky, `bg-white`, `border-b-2 border-primary-500/90`,
  `h-[72px]`, inner wrapper `max-w-admin`, `justify-end`, no nav links.
- **`LanguageSwitcher`** lives only in the locale layout — right-aligned under the logo,
  just below the header's crimson rule (never duplicated in page bodies); pill style,
  active locale = `bg-primary-500 text-white`.
- **B5 registration form is NOT implemented yet** — the registration placeholder div must
  stay untouched.
- **Do NOT modify**: `prisma/schema.prisma`, `lib/validation/*`, `app/api/*`.
  (`lib/mock/events.ts` is presentation scaffolding and may evolve with the public UI.)
- **Event mock data carries a `center`** (`{ name, city, email, phone }`) and bilingual
  `description_cs` / `description_en`. Event `title_*` holds the clean name only — no
  embedded season/year (that lives in the dates).
- **Composed first line** (homepage cards + event detail heading):
  `{center.name} — {title} — {date range}`. Homepage card then shows the short subtitle +
  status badge; the event detail shows the admin description + status badge + pricing button.
- **No registration button or center-contact card on the event detail yet** — those arrive
  with the B5 form / richer description. Registration placeholder div stays untouched.