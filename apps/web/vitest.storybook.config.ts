import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./vitest.server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/storybook/**/*.a11y.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // Every test here renders a composed story and runs a full axe tree scan.
    // Those took 5-7s each when the release benchmark ran six suites at once,
    // so the whole project gets the headroom rather than each new story.
    testTimeout: 30_000,
  },
});
