import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Guards that every table Prisma creates has RLS enabled in a migration.
//
// WHY: RLS used to be turned on by hand in the Supabase dashboard. That is a
// setting on the tables that existed at the moment of the click, and it does not
// extend to the next one. `MealPricingRule` was created by the M37 migration and
// arrived with RLS off, `anon` holding full read/write on it through PostgREST,
// and the anon key sitting in the browser bundle. It stayed that way until
// Supabase's advisor mailed about it five days later.
//
// A checklist item would have failed the same way the click did, so the check has
// to be mechanical: add a model, and this fails until the migration that creates
// its table also enables RLS on it.
//
// It reads files, not the database — `npm test` needs no connection, and a passing
// run here means the repo is right, not that production is. The live state is
// verified separately with:
//   select tablename, rowsecurity from pg_tables where schemaname = 'public';

const PRISMA_DIR = import.meta.dirname;

const schema = readFileSync(join(PRISMA_DIR, "schema.prisma"), "utf8");

/** Table name per model, honouring @@map. */
function modelTables(): string[] {
  const tables: string[] = [];
  // A model block runs from `model X {` to the first `}` at column 0.
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, model, body] = match;
    const mapped = /^\s*@@map\("([^"]+)"\)/m.exec(body!)?.[1];
    tables.push(mapped ?? model!);
  }
  return tables;
}

function migrationSql(): string {
  const dir = join(PRISMA_DIR, "migrations");
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith("."))
    .map((entry) => {
      try {
        return readFileSync(join(dir, entry, "migration.sql"), "utf8");
      } catch {
        return ""; // migration_lock.toml and friends
      }
    })
    .join("\n");
}

const sql = migrationSql();

/** Tables the migrations enable RLS on. */
function rlsEnabledTables(): Set<string> {
  const found = new Set<string>();
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+(?:public\.)?"?(\w+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
  )) {
    found.add(match[1]!);
  }
  return found;
}

describe("Row Level Security", () => {
  it("parses the schema at all (a silent 0 models would pass everything else)", () => {
    const tables = modelTables();
    expect(tables.length).toBeGreaterThan(10);
    expect(tables).toContain("MealPricingRule");
  });

  it("enables RLS in a migration for every model's table", () => {
    const enabled = rlsEnabledTables();
    const missing = modelTables().filter((t) => !enabled.has(t));
    expect(
      missing,
      `No migration enables RLS on: ${missing.join(", ")}. A new table is reachable ` +
        `through the public anon key until it does — add ` +
        `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY; to the migration that creates it.`,
    ).toEqual([]);
  });

  it("defines no policies — RLS here is deny-all, not access control", () => {
    // A policy would quietly turn the backstop into a permission grant. Real
    // authorization is the role/ownership gate in the handlers and services;
    // Prisma connects as the table owner and bypasses RLS entirely.
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    // FORCE would apply RLS to the owner too, i.e. to Prisma — every query would
    // return nothing, since there are no policies.
    expect(sql).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
