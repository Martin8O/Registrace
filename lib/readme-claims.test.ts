import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// Guards the test counts the README and AGENTS.md state out loud.
//
// WHY: the README claimed the pricing suite was "a 22-scenario matrix" long after
// it had become 29 plain it() cases. Two audits missed it, because both checked
// the TOTAL (which was right) and took the prose beside it on trust. Numbers in
// prose drift silently; this makes them fail loudly instead.
//
// HOW: a test cannot ask Vitest how many tests the run contains without running
// it again, so the counts come from parsing the test files — with the TypeScript
// compiler's own parser, not a regex. That is not fussiness. The first version of
// this file stripped comments and strings with regexes, and returned 0 for its own
// source: a file about parsing is full of regex literals like /"(?:\\.|[^"\\])*"/,
// and a regex "string stripper" reads the quotes inside them as real quotes and
// eats the file. It failed silently — the exact quiet miscount this guard exists
// to prevent. The AST tokenises properly, so comments, strings and regex literals
// cannot be confused for code.
//
// The parser models plain `it(` and `it.each([<literal array>])` and THROWS on any
// other test-defining form rather than guessing: an unsupported pattern must be a
// loud failure telling you to teach it, never a quiet undercount.
//
// This file counts ITSELF — it is a test file that `npm test` runs, so the
// README's totals include it. Adding a case here means updating the README, which
// is the point rather than a snag.

const ROOT = join(import.meta.dirname, "..");

function findTestFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "generated", ".git", "local"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findTestFiles(full, found);
    else if (entry.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

const UNSUPPORTED = new Set([
  "it.only",
  "it.skip",
  "it.todo",
  "it.fails",
  "it.concurrent",
  "it.sequential",
  "it.for",
  "test",
  "test.each",
  "test.only",
  "test.skip",
  "test.todo",
  "describe.each",
]);

/** How many cases Vitest will run from this source. Throws rather than guess. */
export function countTests(src: string, label: string): number {
  const sf = ts.createSourceFile(label, src, ts.ScriptTarget.Latest, true);
  let count = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      // `it(...)` / `it.each([...])(...)` / `describe.each(...)` — the callee text
      // as written, which for it.each([..])("name") is the inner call.
      const head = node.expression;
      const text = head.getText(sf);

      if (UNSUPPORTED.has(text)) {
        throw new Error(
          `${label}: uses \`${text}\`, a test form this counter does not model. ` +
            `Teach lib/readme-claims.test.ts about it — do not loosen the check.`,
        );
      }

      if (text === "it") count += 1;

      if (ts.isCallExpression(head) && head.expression.getText(sf) === "it.each") {
        const arg = head.arguments[0];
        if (!arg || !ts.isArrayLiteralExpression(arg)) {
          throw new Error(
            `${label}: it.each over something other than a literal array — the ` +
              `counter cannot know how many cases that is.`,
          );
        }
        if (arg.elements.length === 0) throw new Error(`${label}: it.each with an empty array`);
        count += arg.elements.length;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return count;
}

const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

// "- **Pricing engine** (29) — …" and "- **Export & auth** (7 + 4) — …" (one
// bullet can cover two files, so sum every number inside the parens).
function statedSuiteCounts(): { label: string; count: number }[] {
  const section = readme.split("## Testing")[1]?.split("\n---")[0] ?? "";
  return [...section.matchAll(/^- \*\*(.+?)\*\* \(([\d\s+]+)\)/gm)].map((m) => ({
    label: m[1]!,
    count: m[2]!.split("+").reduce((sum, n) => sum + Number(n.trim()), 0),
  }));
}

const statedTotal = Number(/runs \*\*(\d+) Vitest tests\*\*/.exec(readme)?.[1]);
const statedFiles = Number(/Vitest tests\*\* across (\d+) files/.exec(readme)?.[1]);

describe("the counter itself", () => {
  it("counts plain it() and expands it.each the way Vitest does", () => {
    expect(countTests(`it("a", () => {}); it("b", () => {})`, "x")).toBe(2);
    expect(countTests(`it.each(["cs", "en"])("%s", () => {})`, "x")).toBe(2);
    expect(countTests(`it("a", () => {}); it.each([1, 2, 3])("%s", () => {})`, "x")).toBe(4);
  });

  it("is not fooled by it( inside comments, strings or regex literals", () => {
    expect(countTests(`// it("commented out", () => {})\nit("real", () => {})`, "x")).toBe(1);
    expect(countTests(`const s = "it(";\nit("real", () => {})`, "x")).toBe(1);
    expect(countTests(`if (/x/.test(v)) {}\nit("real", () => {})`, "x")).toBe(1);
    // The case that broke the regex-based version: a regex literal containing the
    // quote characters a naive stripper would treat as string delimiters.
    expect(countTests(`const r = /"(?:\\\\.|[^"\\\\])*"/g;\nit("real", () => {})`, "x")).toBe(1);
  });

  it("throws rather than guess on a form it does not model", () => {
    expect(() => countTests(`it.skip("x", () => {})`, "f")).toThrow(/does not model/);
    expect(() => countTests(`describe.each([1])("x", () => {})`, "f")).toThrow(/does not model/);
    expect(() => countTests(`it.each(CASES)("x", () => {})`, "f")).toThrow(/literal array/);
  });
});

describe("README test claims", () => {
  const files = findTestFiles(ROOT);
  const realTotal = files.reduce(
    (sum, f) => sum + countTests(readFileSync(f, "utf8"), relative(ROOT, f)),
    0,
  );

  it("states the real number of test files", () => {
    expect(statedFiles).toBe(files.length);
  });

  it("states the real total", () => {
    expect(statedTotal).toBe(realTotal);
  });

  it("lists per-suite counts that add up to the stated total", () => {
    const suites = statedSuiteCounts();
    expect(suites.length).toBeGreaterThan(0);
    expect(suites.reduce((sum, s) => sum + s.count, 0)).toBe(statedTotal);
  });

  it("agrees with itself: badge, tech-stack row and Testing heading", () => {
    expect(/tests-(\d+)%20passing/.exec(readme)?.[1]).toBe(String(statedTotal));
    expect(/\| (\d+) unit \/ integration tests \|/.exec(readme)?.[1]).toBe(String(statedTotal));
  });

  it("agrees with AGENTS.md", () => {
    expect(/Vitest \((\d+) tests/.exec(agents)?.[1]).toBe(String(statedTotal));
  });
});
