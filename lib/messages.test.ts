// The translation files as a whole: the two languages carry the same keys, and
// the Czech-only admin help (a product decision — there is no English help) is
// complete, well-formed and internally linked.
//
// WHY: a key missing from one language renders as a raw key in front of that
// language's users, and nothing else notices until someone clicks there. The
// help is long rich text with tags; one malformed tag or a hint linking to a
// section that does not exist would only show up on that one screen.

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { HELP_HINTS } from "@/components/admin/HelpHint";

type Tree = { [key: string]: unknown };

// Every leaf path of a message tree; arrays are indexed like objects.
function leaves(node: unknown, prefix = ""): string[] {
  if (node !== null && typeof node === "object") {
    return Object.entries(node as Tree).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

// Arrays are content (the help's lists), not key structure.
function keyPaths(node: unknown, prefix = ""): string[] {
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    return Object.entries(node as Tree).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe("the two languages", () => {
  it("carry the same keys, except the help, which exists in Czech only", () => {
    const csKeys = keyPaths(cs).filter((k) => !k.startsWith("help."));
    expect(csKeys.filter((k) => !keyPaths(en).includes(k))).toEqual([]);
    expect(keyPaths(en).filter((k) => !csKeys.includes(k))).toEqual([]);
    expect(en).not.toHaveProperty("help");
  });
});

describe("the Czech-only admin help", () => {
  const tag = (chunks: unknown) => String(chunks);
  const t = createTranslator({
    locale: "cs",
    messages: cs,
    onError: (error) => {
      throw error;
    },
  });

  it("formats every string with the tags the page and the hints provide", () => {
    const paths = leaves(cs.help, "help").filter((p) => typeof pick(p) === "string");
    expect(paths.length).toBeGreaterThan(100);
    for (const path of paths) {
      const out = t.rich(path as never, { b: tag, i: tag, k: tag, mail: tag, topic: "x" } as never);
      expect(String(out)).not.toMatch(/<\/?[a-z]+>/);
    }
  });

  it("has every hint the screens ask for, and each links only to a section that exists", () => {
    const sections = cs.help.page.recipes.map((r) => r.id);
    expect(new Set(sections).size).toBe(sections.length);
    for (const topic of HELP_HINTS) {
      const hint = cs.help.hints[topic] as { topic: string; body: string[]; more?: { anchor: string } };
      expect(hint.topic).toBeTruthy();
      expect(hint.body.length).toBeGreaterThan(0);
      if (hint.more) expect(sections).toContain(hint.more.anchor);
    }
  });
});

function pick(path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Tree)?.[key], cs);
}
