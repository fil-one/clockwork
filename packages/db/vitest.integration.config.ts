import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    passWithNoTests: true,
    // These files share one reset local Supabase instance and several seeded
    // legal/financial aggregates. Keep files serial; individual tests still
    // exercise explicit concurrent claims, reservations, and transitions.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
