import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF?.trim();
if (!project) throw new Error("TRIGGER_PROJECT_REF is required");

export default defineConfig({
  project,
  runtime: "node",
  logLevel: "info",
  maxDuration: 3600,
  dirs: ["./packages/workflows/src/trigger"],
});
