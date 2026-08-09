import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./src/adapters/postgres/migrations",
  schema: "./src/adapters/postgres/schema/index.ts",
  strict: true,
  verbose: true,
});
