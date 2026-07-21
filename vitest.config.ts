import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig `@/*` → `./*`. The regex matches only imports that begin with
// `@/` (the app alias) and deliberately NOT `@vitest/…` or other scoped packages.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${path.resolve(process.cwd())}/` }],
  },
  test: {
    environment: "node",
    // Keep in step with `lib/readme-claims.test.ts`, which counts every *.test.ts
    // in the repo: a file matched by one and not the other silently miscounts.
    include: ["modules/**/*.test.ts", "lib/**/*.test.ts", "prisma/**/*.test.ts"],
  },
});
