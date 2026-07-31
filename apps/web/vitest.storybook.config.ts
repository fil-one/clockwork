import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/storybook/**/*.a11y.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
