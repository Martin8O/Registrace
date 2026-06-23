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
    include: ["modules/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
