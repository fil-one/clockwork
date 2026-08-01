import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../../../packages/ui/src/stories/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-vitest",
  ],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  staticDirs: [],
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    build: {
      ...viteConfig.build,
      // The preview is an internal verification bundle that intentionally keeps
      // Storybook, Axe, and the component catalog together. Its largest emitted
      // chunk is currently below this reviewed ceiling.
      chunkSizeWarningLimit: 1_400,
    },
  }),
};

export default config;
