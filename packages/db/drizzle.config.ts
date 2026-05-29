/**
 * drizzle-kit config — generates SQL migrations from src/schema.ts.
 * The SQLite file path mirrors the runtime client (STRIDE_DB_PATH ?? ./stride.db).
 * Migrations are the preferred path for CI / the future Postgres move; the
 * runtime client also self-bootstraps via BOOTSTRAP_DDL for zero-ops deploys.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.STRIDE_DB_PATH ?? "./stride.db",
  },
});
