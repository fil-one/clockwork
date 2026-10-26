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
    // AuthKit's extensionless Next imports need the same bundling as the app.
    server: { deps: { inline: ["@workos-inc/authkit-nextjs"] } },
    environment: "jsdom",
    include: ["{src,app}/**/*.test.{ts,tsx}"],
    exclude: [
      "src/storybook/**",
      "**/*.integration.test.*",
      "**/node_modules/**",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
});
