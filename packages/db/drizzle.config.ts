import { defineConfig } from "drizzle-kit";

const migrationUrl = process.env.DIRECT_DATABASE_URL;
if (!migrationUrl)
  throw new Error("DIRECT_DATABASE_URL is required for migration tooling");

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/schema/index.ts"],
  out: "./drizzle",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true,
});
