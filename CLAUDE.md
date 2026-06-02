# TENOVICE — Project Memory for Claude Code

## What this project is
Bilingual (CZ/EN) web application for registration to meditation and community events.

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

## Folder structure
/app/[locale]/ — public pages (CZ/EN routing)
/app/api/ — API routes
/components/public/ + /admin/ + /shared/
/locales/cs.json + en.json
/modules/events/ + registrations/ + pricing/ + auth/
/lib/db/ + validation/ + utils/ + email/
/prisma/schema.prisma

## Pricing discount field naming
Fields named *Discount are subtracted from total (not added).
morningArrivalDiscount, afternoonArrivalDiscount, eveningArrivalDiscount, earlyDepartureDiscount

## Current build status

### Milestone: Project foundation complete (commit a430c62 — chore: setup project foundation)

**Installed libraries**
- @prisma/client 7.8.0 + prisma 7.8.0
- @supabase/supabase-js 2.106.2 + @supabase/ssr 0.10.3
- next-intl 4.13.0
- zod 4.4.3
- react-hook-form 7.77.0 + @hookform/resolvers 5.4.0
- resend 6.12.4

**i18n routing**
- Locale routing via proxy.ts (Next.js 16 convention, named `proxy` export)
- Locales: cs (default) and en, prefix-always mode
- `X-NEXT-INTL-LOCALE` header read in root layout for correct `<html lang>`
- Translation keys: 20 keys in locales/cs.json and locales/en.json

**Env files**
- .env.local — placeholder values, gitignored
- .env.example — empty values, committed (safe)

**Last verified**
- `npx tsc --noEmit` → 0 errors
- `npm run build` → clean, no warnings (Next.js 16.2.7 Turbopack)