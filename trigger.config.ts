import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_clockwork_local",
  runtime: "node",
  logLevel: "info",
  maxDuration: 3600,
  dirs: ["./packages/workflows/src"],
});
