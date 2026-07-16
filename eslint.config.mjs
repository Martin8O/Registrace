import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Prisma client is generated code (gitignored, regenerated on every
    // install). Linting it produced ~400 errors that no one can act on and that
    // drowned out real findings in `npm run lint`.
    "generated/**",
  ]),
]);

export default eslintConfig;
