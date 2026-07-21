-- Enable Row Level Security, deny-all, on every table in the public schema.
--
-- WHY THIS EXISTS AT ALL: RLS was originally turned on by hand in the Supabase
-- dashboard, on the tables that existed at that moment. That worked right up until
-- a migration created a new one. `MealPricingRule` (M37, 2026-07-16) arrived
-- through Prisma, which knows nothing about a dashboard click, so it landed with
-- RLS off — and Supabase's default privileges grant `anon` full
-- SELECT/INSERT/UPDATE/DELETE on new public tables, which PostgREST exposes to
-- anyone holding the anon key. The anon key ships in the browser bundle. For five
-- days the meal price list was world-writable; Supabase's Security Advisor caught
-- it on 2026-07-20. Nothing in the data had been touched.
--
-- The lesson is not "remember to click it next time" — it is that the setting has
-- to live where the tables are created. From here on RLS is repo state, applied by
-- `prisma migrate deploy` like anything else, and `prisma/rls.test.ts` fails the
-- build if a model is ever added without a line here.
--
-- NO POLICIES ARE DEFINED, deliberately. RLS with zero policies denies everything,
-- which is exactly the intent: nothing in this app is meant to be reachable through
-- the anon key. Every read and write goes through Prisma on the server, which
-- connects as the table owner and is therefore not subject to RLS. This is a
-- backstop behind the role/ownership gate in the handlers and services, not a
-- replacement for it. Supabase's advisor will report "RLS Enabled No Policy" as
-- informational — that is the intended end state, not a leftover to fix.
--
-- ENABLE ROW LEVEL SECURITY is idempotent, so re-running this on the twelve tables
-- that were already covered is a no-op and the statements are listed in full rather
-- than filtered down to the one that was missing. The point is that this file, read
-- on its own, states the complete intended state of the schema.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserCenter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Center" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventDate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MealPricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventMeal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Registration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParticipantMeal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- Prisma's own bookkeeping table. It holds no application data, but it is in the
-- public schema and carries the same default grants, so it gets the same backstop.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
