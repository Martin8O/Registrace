import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: false });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  migrations: {
    seed: "tsx --env-file .env.local prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL!,
  },
});
